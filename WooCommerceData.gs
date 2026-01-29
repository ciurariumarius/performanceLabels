/**
 * @file WooCommerceData.gs
 * @description Enterprise-grade WooCommerce fetcher (v4.1 - Updated Headers).
 * Features: 
 * - "Worker" pattern for infinite runtime.
 * - Parallel Fetching (5 pages/batch).
 * - Resume-able Writer (Prevents timeouts).
 * - Thread Safe (LockService).
 * - Integrated with CommonUtilities for config and logging.
 */

'use strict';

// --- Configuration ---
const WOO_CONFIG_SHEET_NAME = "Config";
const WOO_DATA_SHEET_NAME = "WooCommerce";
const WOO_ACCOUNT_SHEET_NAME = "AccountData";
const TEMP_FILENAME = "temp_woo_batch_data.json"; 

// Execution Safety: Run for 4 mins, leaving a 2m buffer before the 6m limit.
const MAX_EXECUTION_TIME_MS = 1000 * 60 * 4; 
const WOO_PAGE_SIZE = 100;
const PARALLEL_REQUESTS = 5; 

/**
 * TRIGGER 1 (DAILY): Starts the job.
 * Sets the initial state and flags the worker to start.
 */
function startWooCommerceReport() {
  const lock = LockService.getScriptLock();
  // Wait up to 30s to ensure no worker is currently writing to the file
  if (!lock.tryLock(30000)) {
    console.error("Could not obtain lock to start report.");
    return;
  }

  try {
    resetScript_(); 

    const startState = {
      phase: 'FETCH_PRODUCTS',
      page: 1,
      writeStartIndex: 0, // Tracks writing progress for resume capability
      startTime: new Date().getTime(),
      uniqueOrdersCount: 0,
      totalRevenue: 0,
      totalItemsSold: 0,
      status: "Starting..."
    };

    const props = PropertiesService.getScriptProperties();
    props.setProperty('WOO_BATCH_STATE', JSON.stringify(startState));
    props.setProperty('WOO_WORKER_STATUS', 'ACTIVE'); 
    
    // Initialize empty data container
    saveDataToDrive_({}); 
    
    logStatus_("STARTED", "Job initialized. Worker will begin shortly.");
    try { SpreadsheetApp.getActiveSpreadsheet().toast("Daily Job Initiated."); } catch(e) {}
    
    // Kick off the first worker immediately
    processBatchWorker();

  } catch (e) {
    console.error("Error starting report: " + e.message);
    logStatus_("ERROR", "Start failed: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * TRIGGER 2 (EVERY 5 MINS): The Worker.
 * Checks for work, locks the script, and executes a batch.
 */
function processBatchWorker() {
  const props = PropertiesService.getScriptProperties();
  const status = props.getProperty('WOO_WORKER_STATUS');

  // Exit immediately if no job is active to save quota
  if (status !== 'ACTIVE') return; 

  // Prevent race conditions (Worker vs Worker)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; 

  try {
    console.log("Worker executing...");
    processBatchCore_();
  } catch (e) {
    console.error("Worker Error: " + e.message);
    logStatus_("ERROR", e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * MANUAL OVERRIDE: Forces the worker to run immediately.
 * useful for testing or unblocking a stuck job.
 */
function forceResumeWooCommerceReport() {
  PropertiesService.getScriptProperties().setProperty('WOO_WORKER_STATUS', 'ACTIVE');
  processBatchWorker();
}

/**
 * CORE LOGIC ENGINE
 * Handles the state machine: Fetch Products -> Fetch Orders -> Write Data
 */
function processBatchCore_() {
  const executionStart = new Date().getTime();
  const scriptProperties = PropertiesService.getScriptProperties();
  let state = JSON.parse(scriptProperties.getProperty('WOO_BATCH_STATE'));
  
  if (!state) {
    scriptProperties.setProperty('WOO_WORKER_STATUS', 'IDLE');
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = loadWooConfig_(ss);
    let productMap = loadDataFromDrive_(); 

    // --- PHASE 1: FETCH PRODUCTS (PARALLEL) ---
    if (state.phase === 'FETCH_PRODUCTS') {
      logStatus_("RUNNING", `Fetching Products (Page ${state.page})...`);
      
      let hasMore = true;
      while (hasMore) {
        if (isTimeUp_(executionStart)) break;

        const requests = [];
        for (let i = 0; i < PARALLEL_REQUESTS; i++) {
          const pageNum = state.page + i;
          const url = `${config.shopUrl}/wp-json/wc/v3/products?page=${pageNum}&per_page=${WOO_PAGE_SIZE}&_fields=id,name,price,stock_status,stock_quantity,categories,date_created_gmt`;
          requests.push({ url: url, method: "get", headers: config.authHeader, muteHttpExceptions: true });
        }

        const responses = UrlFetchApp.fetchAll(requests);
        let batchHasData = false;

        responses.forEach(res => {
          if (res.getResponseCode() === 200) {
            const products = JSON.parse(res.getContentText());
            if (products.length > 0) {
              batchHasData = true;
              products.forEach(p => {
                let cat = "N/A";
                if (p.categories && p.categories.length > 0) cat = p.categories[0].name;
                productMap[p.id] = {
                  id: p.id, name: p.name, category: cat, price: parseFloatSafe(p.price), // Use CommonUtilities
                  stockStatus: p.stock_status, stockQty: parseIntSafe(p.stock_quantity), // Use CommonUtilities
                  dateCreated: p.date_created_gmt,
                  rev: 0, sold: 0, orders: 0, rev14: 0
                };
              });
            }
          }
        });

        if (batchHasData) {
          state.page += PARALLEL_REQUESTS;
          logStatus_("RUNNING", `Fetched Products up to Page ${state.page}...`);
        } else {
          state.phase = 'FETCH_ORDERS';
          state.page = 1; 
          hasMore = false;
        }
      }
    }

    // --- PHASE 2: FETCH ORDERS (PARALLEL) ---
    if (state.phase === 'FETCH_ORDERS' && !isTimeUp_(executionStart)) {
      logStatus_("RUNNING", `Fetching Orders (Page ${state.page})...`);
      
      const startDate = new Date(new Date().getTime() - config.days * 86400000);
      const day14 = new Date(new Date().getTime() - 14 * 86400000);

      let hasMore = true;
      while (hasMore) {
        if (isTimeUp_(executionStart)) break;

        const requests = [];
        for (let i = 0; i < PARALLEL_REQUESTS; i++) {
          const pageNum = state.page + i;
          // Note: Using hardcoded 'completed,processing' as requested
          const url = `${config.shopUrl}/wp-json/wc/v3/orders?status=completed,processing&after=${startDate.toISOString()}&page=${pageNum}&per_page=${WOO_PAGE_SIZE}&_fields=id,date_created_gmt,line_items`;
          requests.push({ url: url, method: "get", headers: config.authHeader, muteHttpExceptions: true });
        }

        const responses = UrlFetchApp.fetchAll(requests);
        let batchHasData = false;

        responses.forEach(res => {
          if (res.getResponseCode() === 200) {
            const orders = JSON.parse(res.getContentText());
            if (orders.length > 0) {
              batchHasData = true;
              orders.forEach(order => {
                state.uniqueOrdersCount++;
                const orderDate = new Date(order.date_created_gmt + "Z");
                if (order.line_items) {
                  order.line_items.forEach(item => {
                    const pid = item.product_id;
                    if (productMap[pid]) {
                      const lineTotal = parseFloatSafe(item.total);
                      const qty = parseIntSafe(item.quantity);
                      productMap[pid].rev += lineTotal;
                      productMap[pid].sold += qty;
                      productMap[pid].orders += 1;
                      state.totalRevenue += lineTotal;
                      state.totalItemsSold += qty;
                      if (orderDate >= day14) productMap[pid].rev14 += lineTotal;
                    }
                  });
                }
              });
            }
          }
        });

        if (batchHasData) {
          state.page += PARALLEL_REQUESTS;
          logStatus_("RUNNING", `Fetched Orders up to Page ${state.page}...`);
        } else {
          state.phase = 'WRITE_DATA';
          state.writeStartIndex = 0; // Reset index for the writing phase
          hasMore = false;
        }
      }
    }

    // --- PHASE 3: WRITE DATA (RESUME-ABLE) ---
    if (state.phase === 'WRITE_DATA') {
      
      const sheet = getOrCreateSheet(ss, WOO_DATA_SHEET_NAME);
      
      // Initialize Headers only if starting from the beginning
      if (state.writeStartIndex === 0) {
        sheet.clear();
        const headers = [
          "Product ID", "Product Name", "Product Category", "Product Price", "Date Created",
          "Total Orders", "Total Items Sold", "Total Revenue", "Revenue last 14 days",
          "Stock Status", "Stock Quantity"
        ];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center");
      }

      // Convert Map to Array & Sort
      // Sorting is repeated on resume to ensure index consistency.
      const rows = Object.values(productMap).map(p => [
        p.id, p.name, p.category, p.price, p.dateCreated,
        p.orders, p.sold, p.rev, p.rev14, p.stockStatus, p.stockQty
      ]).sort((a,b) => b[7] - a[7]); // Sort by Revenue (Desc)

      // Only perform writing if there are rows
      if (rows.length > 0) {
          const CHUNK_SIZE = 1500; 
          let doneWriting = true;

          // Start loop from saved index
          for (let i = state.writeStartIndex; i < rows.length; i += CHUNK_SIZE) {
            
            // Check time remaining before writing the next chunk
            if (isTimeUp_(executionStart)) {
              logStatus_("PAUSED", `Writing paused at row ${i}. Resuming next tick...`);
              state.writeStartIndex = i; // Save progress
              doneWriting = false;
              break; // Exit loop to save state
            }

            const chunk = rows.slice(i, i + CHUNK_SIZE);
            // Calculate target range: Row 2 (headers) + i (current index)
            sheet.getRange(2 + i, 1, chunk.length, 11).setValues(chunk);
            SpreadsheetApp.flush(); // Commit changes immediately
            
            logStatus_("WRITING", `Writing rows ${i} - ${i+chunk.length}...`);
          }
          
          // Apply formatting once at the end (or we could do it incrementally, but end is safer for performance)
          if (doneWriting) {
             sheet.getRange(2, 4, rows.length, 1).setNumberFormat('#,##0.00'); // Price
             sheet.getRange(2, 8, rows.length, 2).setNumberFormat('#,##0.00'); // Revenues
          }
          
          if (!doneWriting) {
              // Save state and exit if not done
              saveDataToDrive_(productMap);
              props.setProperty('WOO_BATCH_STATE', JSON.stringify(state));
              return; 
          }
      }

      // --- ACCOUNT DATA LOGGING (Integrated Standard) ---
      // Calculates OOS items with sales
      let oosWithSalesCount = 0;
      let totalWithSalesCount = 0;
      
      const allProducts = Object.values(productMap);
      for (const product of allProducts) {
        if (product.rev > 0) {
          totalWithSalesCount++;
          if (product.stockStatus !== "in stock" && product.stockStatus !== "instock") { 
            oosWithSalesCount++;
          }
        }
      }
      
      const oosPercent = totalWithSalesCount > 0 
        ? ((oosWithSalesCount / totalWithSalesCount) * 100).toFixed(1) + "%" 
        : "0%";

      upsertAccountDataRow(ss, WOO_ACCOUNT_SHEET_NAME, {
        source: `WooCommerce - ${config.shopUrl}`,
        timeframe: formatDisplayDateRange(config.days),
        revenue: state.totalRevenue,
        orders: state.uniqueOrdersCount,
        cost: "-",
        oosCount: oosWithSalesCount,
        oosPercent: oosPercent
      });

      logStatus_("COMPLETED", `Finished at ${new Date().toLocaleTimeString()}`);
      resetScript_(); // Cleanup
      scriptProperties.setProperty('WOO_WORKER_STATUS', 'IDLE'); 
      return;
    }

    // --- PAUSE & SAVE STATE ---
    saveDataToDrive_(productMap);
    scriptProperties.setProperty('WOO_BATCH_STATE', JSON.stringify(state));

  } catch (e) {
    console.error("Core Process Error: " + e.message);
    logStatus_("ERROR", e.message);
  }
}

// --- UTILITIES ---

/**
 * Updates the 'AccountData' sheet with the live status of the script.
 * Places the status box to the right of the data table (Columns J:K).
 */
function logStatus_(status, message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // Move status logging to AccountData sheet as requested
    const sheet = ss.getSheetByName(WOO_ACCOUNT_SHEET_NAME); 
    if (sheet) {
      // Using range J2:K6 to sit to the right of standard columns (A-H)
      const range = sheet.getRange("J2:K6"); 
      range.setBorder(true, true, true, true, true, true);
      range.setValues([
        ["WOO WORKER STATUS", status],
        ["MESSAGE", message],
        ["LAST UPDATE", new Date().toLocaleTimeString()],
        ["", ""],
        ["NOTE", "Refreshes every 5 mins"]
      ]);
      const statusCell = sheet.getRange("K2");
      if (status === "ERROR") statusCell.setBackground("#FFCCCC");
      else if (status === "COMPLETED") statusCell.setBackground("#CCFFCC");
      else statusCell.setBackground("#CCFFFF");
      SpreadsheetApp.flush(); 
    }
  } catch(e) {
    console.warn("Failed to update status sheet: " + e.message);
  }
}

/**
 * Cleans up properties and temporary files after a successful run or reset.
 */
function resetScript_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('WOO_TEMP_FILE_ID');
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {}
    props.deleteProperty('WOO_TEMP_FILE_ID');
  }
  props.deleteProperty('WOO_BATCH_STATE');
}

/**
 * Checks if the script has exceeded the safe execution time window.
 */
function isTimeUp_(startTime) {
  return (new Date().getTime() - startTime) > MAX_EXECUTION_TIME_MS;
}

/**
 * Saves the product data map to Google Drive to persist between batches.
 * Uses ID-based retrieval to avoid duplicate file issues.
 */
function saveDataToDrive_(data) {
  const content = JSON.stringify(data);
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('WOO_TEMP_FILE_ID');
  if (fileId) {
    try { 
      DriveApp.getFileById(fileId).setContent(content); 
      return; 
    } catch (e) {
      console.warn("Could not write to existing file ID. Creating new file.");
    }
  }
  const file = DriveApp.createFile(TEMP_FILENAME, content, MimeType.PLAIN_TEXT);
  props.setProperty('WOO_TEMP_FILE_ID', file.getId());
}

/**
 * Loads the product data map from Google Drive.
 */
function loadDataFromDrive_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('WOO_TEMP_FILE_ID');
  if (fileId) {
    try { 
      return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString()); 
    } catch (e) {
      console.error("Failed to load/parse data from Drive: " + e.message);
    }
  }
  return {};
}

/**
 * Loads configuration from the Config sheet using CommonUtilities.
 */
function loadWooConfig_(ss) {
  const sheet = ss.getSheetByName(WOO_CONFIG_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${WOO_CONFIG_SHEET_NAME}" missing.`);
  
  const configs = loadConfigurationsFromSheetObject(sheet);
  const rawUrl = getConfigValue(configs, "WooCommerce Domain", 'string');
  const shopUrl = ensureHttps(rawUrl);
  const days = getConfigValue(configs, "Timeframe", 'int', 30);
  const key = getConfigValue(configs, "WooCommerce API Key", 'string');
  const secret = getConfigValue(configs, "WooCommerce API Secret", 'string');

  if (!shopUrl || !key || !secret) throw new Error("Missing config.");

  return {
    shopUrl: shopUrl,
    days: days,
    authHeader: { "Authorization": "Basic " + Utilities.base64Encode(key + ":" + secret) }
  };
}


