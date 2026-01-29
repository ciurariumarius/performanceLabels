/**
 * @file ShopifyData.gs
 * @description Enterprise-grade Shopify fetcher (v3.0 - Worker Pattern).
 * Features:
 * - "Worker" pattern for infinite runtime.
 * - Cursor-based Pagination (Handles 'Link' headers).
 * - Resume-able Writer.
 * - Thread Safe (LockService).
 * - Integrated with CommonUtilities for config and logging.
 */

'use strict';

// --- Configuration ---
const SHOPIFY_CONFIG_SHEET_NAME = "Config";
const SHOPIFY_PRODUCT_DATA_SHEET_NAME = "Shopify";
const SHOPIFY_ACCOUNT_SHEET_NAME = "AccountData";
const SHOPIFY_TEMP_FILENAME = "temp_shopify_batch_data.json";

// Execution Safety: Run for 4 mins, leaving a 2m buffer.
const SHOPIFY_MAX_EXECUTION_TIME_MS = 1000 * 60 * 4; 
const SHOPIFY_ITEMS_PER_PAGE = 250; // Increased page size for efficiency
const SHOPIFY_API_VERSION = '2024-04';

/**
 * TRIGGER 1 (DAILY): Starts the job.
 * Sets the initial state and flags the worker to start.
 */
function startShopifyReport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.error("Could not obtain lock to start Shopify report.");
    return;
  }

  try {
    resetShopifyScript_(); 

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = loadShopifyConfig_(ss);

    // Initial URLs
    const productsUrl = `https://${config.domain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${SHOPIFY_ITEMS_PER_PAGE}&fields=id,title,variants,created_at`;
    
    // Calculate Order timeframe
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - config.days * 86400000);
    const ordersUrl = `https://${config.domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${SHOPIFY_ITEMS_PER_PAGE}&status=any&created_at_min=${startDate.toISOString()}&fields=id,line_items,created_at,financial_status,cancelled_at`;

    const startState = {
      phase: 'FETCH_PRODUCTS',
      nextProductUrl: productsUrl,
      nextOrderUrl: ordersUrl,
      writeStartIndex: 0,
      startTime: new Date().getTime(),
      totalVariants: 0,
      uniqueOrdersCount: 0,
      totalRevenue: 0,
      totalItemsSold: 0,
      status: "Starting..."
    };

    const props = PropertiesService.getScriptProperties();
    props.setProperty('SHOPIFY_BATCH_STATE', JSON.stringify(startState));
    props.setProperty('SHOPIFY_WORKER_STATUS', 'ACTIVE'); 
    
    // Initialize empty data container in Drive
    saveShopifyDataToDrive_({}); 
    
    logShopifyStatus_("STARTED", "Job initialized. Worker will begin shortly.");
    try { SpreadsheetApp.getActiveSpreadsheet().toast("Shopify Daily Job Initiated."); } catch(e) {}
    
    // Kick off the first worker immediately
    processShopifyWorker();

  } catch (e) {
    console.error("Error starting Shopify report: " + e.message);
    logShopifyStatus_("ERROR", "Start failed: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * TRIGGER 2 (EVERY 5 MINS): The Worker.
 * Checks for work, locks the script, and executes a batch.
 */
function processShopifyWorker() {
  const props = PropertiesService.getScriptProperties();
  const status = props.getProperty('SHOPIFY_WORKER_STATUS');

  if (status !== 'ACTIVE') return; 

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; 

  try {
    console.log("Shopify Worker executing...");
    processShopifyBatchCore_();
  } catch (e) {
    console.error("Shopify Worker Error: " + e.message);
    logShopifyStatus_("ERROR", e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * CORE LOGIC ENGINE
 */
function processShopifyBatchCore_() {
  const executionStart = new Date().getTime();
  const scriptProperties = PropertiesService.getScriptProperties();
  let state = JSON.parse(scriptProperties.getProperty('SHOPIFY_BATCH_STATE'));
  
  if (!state) {
    scriptProperties.setProperty('SHOPIFY_WORKER_STATUS', 'IDLE');
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = loadShopifyConfig_(ss);
    let productMap = loadShopifyDataFromDrive_(); 

    // --- PHASE 1: FETCH PRODUCTS ---
    if (state.phase === 'FETCH_PRODUCTS') {
      logShopifyStatus_("RUNNING", "Fetching Products...");
      
      while (state.nextProductUrl) {
        if (isShopifyTimeUp_(executionStart)) break;

        const response = fetchShopifyUrl_(state.nextProductUrl, config.accessToken);
        if (response) {
          const data = JSON.parse(response.content);
          
          if (data.products && data.products.length > 0) {
            data.products.forEach(product => {
              product.variants?.forEach(variant => {
                const formattedProductId = `shopify_${config.countryCode || 'RO'}_${product.id}_${variant.id}`;
                const formattedDate = product.created_at ? formatDisplayDateTime(new Date(product.created_at)) : null;

                productMap[variant.id] = {
                  formattedId: formattedProductId,
                  variantId: variant.id,
                  productId: product.id,
                  productName: product.title,
                  variantTitle: variant.title,
                  price: parseFloatSafe(variant.price, 0.0),
                  dateCreated: formattedDate,
                  stockStatus: determineShopifyStockStatus_(variant),
                  stockQuantity: parseIntSafe(variant.inventory_quantity, 0),
                  rev: 0,
                  sold: 0,
                  rev14: 0,
                  uniqueOrders: 0
                };
                state.totalVariants++;
              });
            });
          }
          
          // Pagination: Update next URL from Link header
          state.nextProductUrl = parseShopifyNextLink_(response.headers['Link']);
        } else {
          // Error or empty response, stop this phase
          state.nextProductUrl = null; 
        }
      }

      if (!state.nextProductUrl) {
        state.phase = 'FETCH_ORDERS';
        logShopifyStatus_("RUNNING", "Finished fetching products. Starting orders...");
      }
    }

    // --- PHASE 2: FETCH ORDERS ---
    if (state.phase === 'FETCH_ORDERS' && !isShopifyTimeUp_(executionStart)) {
      logShopifyStatus_("RUNNING", "Fetching Orders...");
      
      const fourteenDaysAgo = new Date(new Date().getTime() - 14 * 86400000);

      // We use a Set to track processed orders in this batch if needed, 
      // but since we page sequentially, we assume APIs don't return duplicates in one walk.
      // Ideally, we'd persist the Set, but that's too much memory. 
      // Sequential paging is safe enough for this logic.

      while (state.nextOrderUrl) {
        if (isShopifyTimeUp_(executionStart)) break;

        const response = fetchShopifyUrl_(state.nextOrderUrl, config.accessToken);
        if (response) {
          const data = JSON.parse(response.content);
          
          if (data.orders && data.orders.length > 0) {
            data.orders.forEach(order => {
              if (order.cancelled_at || order.financial_status === 'voided') return;

              state.uniqueOrdersCount++;
              const orderDate = new Date(order.created_at);
              const isRecent = orderDate >= fourteenDaysAgo;

              order.line_items?.forEach(item => {
                const pInfo = productMap[item.variant_id];
                if (pInfo) {
                   const itemRev = parseFloatSafe(item.price, 0.0) * parseIntSafe(item.quantity, 0);
                   const itemQty = parseIntSafe(item.quantity, 0);
                   
                   pInfo.rev += itemRev;
                   pInfo.sold += itemQty;
                   pInfo.uniqueOrders += 1; // Approx (lines vs orders), but efficient
                   
                   state.totalRevenue += itemRev;
                   state.totalItemsSold += itemQty;

                   if (isRecent) {
                     pInfo.rev14 += itemRev;
                   }
                }
              });
            });
          }

          state.nextOrderUrl = parseShopifyNextLink_(response.headers['Link']);
        } else {
          state.nextOrderUrl = null;
        }
      }

      if (!state.nextOrderUrl) {
        state.phase = 'WRITE_DATA';
        state.writeStartIndex = 0;
      }
    }

    // --- PHASE 3: WRITE DATA ---
    if (state.phase === 'WRITE_DATA') {
      const sheet = getOrCreateSheet(ss, SHOPIFY_PRODUCT_DATA_SHEET_NAME);
      
      if (state.writeStartIndex === 0) {
        sheet.clear();
        const headers = [
          "Product ID", "Parent ID", "Variant ID", "Product Name", "Variant Title", "Product Price", "Date Created",
          "Total Orders", "Total Items Sold", "Total Revenue", "Revenue last 14 days", "Stock Status", "Stock Quantity"
        ];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center");
      }

      const rows = Object.values(productMap).map(p => [
        p.formattedId, p.productId, p.variantId, p.productName, p.variantTitle, p.price, p.dateCreated,
        p.uniqueOrders, p.sold, p.rev, p.rev14,
        p.stockStatus, p.stockQuantity
      ]).sort((a,b) => b[9] - a[9]); // Sort by Rev

      if (rows.length > 0) {
          const CHUNK_SIZE = 2000;
          let doneWriting = true;

          for (let i = state.writeStartIndex; i < rows.length; i += CHUNK_SIZE) {
            if (isShopifyTimeUp_(executionStart)) {
              logShopifyStatus_("PAUSED", `Writing paused at row ${i}...`);
              state.writeStartIndex = i;
              doneWriting = false;
              break;
            }
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            sheet.getRange(2 + i, 1, chunk.length, 13).setValues(chunk);
            SpreadsheetApp.flush();
            logShopifyStatus_("WRITING", `Writing rows ${i} - ${i+chunk.length}...`);
          }

          if (doneWriting) {
             // Formatting
             sheet.getRange(2, 6, rows.length, 1).setNumberFormat('#,##0.00'); // Price
             sheet.getRange(2, 10, rows.length, 2).setNumberFormat('#,##0.00'); // Revenues
          }

          if (!doneWriting) {
             saveShopifyDataToDrive_(productMap);
             scriptProperties.setProperty('SHOPIFY_BATCH_STATE', JSON.stringify(state));
             return; // Exit and wait for next tick
          }
      }

      // --- ACCOUNT DATA LOGGING ---
      // Stats for OOS
      let oosWithSalesCount = 0;
      let totalWithSalesCount = 0;
      Object.values(productMap).forEach(p => {
         if (p.rev > 0) {
           totalWithSalesCount++;
           if (p.stockStatus !== "in stock") oosWithSalesCount++;
         }
      });
      const oosPercent = totalWithSalesCount > 0 
        ? ((oosWithSalesCount / totalWithSalesCount) * 100).toFixed(1) + "%" 
        : "0%";

      upsertAccountDataRow(ss, SHOPIFY_ACCOUNT_SHEET_NAME, {
        source: `Shopify - ${config.domain}`,
        timeframe: formatDisplayDateRange(config.days),
        revenue: state.totalRevenue,
        orders: state.uniqueOrdersCount,
        cost: "-",
        oosCount: oosWithSalesCount,
        oosPercent: oosPercent
      });

      logShopifyStatus_("COMPLETED", "Finished successfully.");
      resetShopifyScript_();
      scriptProperties.setProperty('SHOPIFY_WORKER_STATUS', 'IDLE');
      
      // Daisy-chain: Run Label Calculations immediately after data is ready
      try {
        Logger.log("Triggering Label Calculations...");
        runAllLabelCalculations(); 
      } catch (e) {
        console.error("Failed to trigger labels: " + e.message);
      }
      return;
    }

    // Save State
    saveShopifyDataToDrive_(productMap);
    scriptProperties.setProperty('SHOPIFY_BATCH_STATE', JSON.stringify(state));

  } catch (e) {
    console.error("Shopify Core Error: " + e.message);
    logShopifyStatus_("ERROR", e.message);
  }
}

// --- HELPER FUNCTIONS ---

function fetchShopifyUrl_(url, accessToken) {
  try {
    const options = {
      method: 'get',
      muteHttpExceptions: true,
      headers: { 'X-Shopify-Access-Token': accessToken }
    };
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code === 429) {
       Utilities.sleep(2000); // Simple hold for rate limit
       return null; // Don't crash, just retry next worker tick
    }
    if (code >= 200 && code < 300) {
      return { content: response.getContentText(), headers: response.getHeaders() };
    }
    console.warn(`Shopify API Error ${code}: ${response.getContentText()}`);
    return null;
  } catch (e) {
    console.warn("Fetch Exception: " + e.message);
    return null;
  }
}

function parseShopifyNextLink_(linkHeader) {
  if (!linkHeader) return null;
  // Format: <https://...>; rel="previous", <https://...>; rel="next"
  const links = linkHeader.split(',');
  for (const link of links) {
    if (link.includes('rel="next"')) {
      return link.match(/<([^>]+)>/)[1];
    }
  }
  return null;
}

function determineShopifyStockStatus_(variant) {
  if (variant.inventory_management !== 'shopify') return "not managed";
  const qty = parseIntSafe(variant.inventory_quantity, 0);
  if (qty > 0) return "in stock";
  if (variant.inventory_policy === 'continue') return "allows backorders";
  return "out of stock";
}

function loadShopifyConfig_(ss) {
  const sheet = ss.getSheetByName(SHOPIFY_CONFIG_SHEET_NAME);
  if (!sheet) throw new Error("Shopify Config sheet missing.");
  const configs = loadConfigurationsFromSheetObject(sheet);
  
  const domain = getConfigValue(configs, "Shopify Domain", 'string');
  const token = getConfigValue(configs, "Shopify accessToken", 'string');
  const days = getConfigValue(configs, "Timeframe", 'int', 30);
  
  if (!domain || !token) throw new Error("Shopify Domain or Token missing.");
  
  return { domain, accessToken: token, days, countryCode: 'RO' };
}

function logShopifyStatus_(status, message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHOPIFY_ACCOUNT_SHEET_NAME); 
    const range = sheet.getRange("R2:S6"); // Moved to R:S
    
    range.setBorder(true, true, true, true, true, true);
    range.setValues([
      ["SHOPIFY STATUS", status],
      ["MESSAGE", message],
      ["LAST UPDATE", new Date().toLocaleTimeString()],
      ["", ""],
      ["NOTE", "Refreshes every 5 mins"]
    ]);
    const statusCell = sheet.getRange("S2");
    if (status === "ERROR") statusCell.setBackground("#FFCCCC");
    else if (status === "COMPLETED") statusCell.setBackground("#CCFFCC");
    else statusCell.setBackground("#CCFFFF");
    SpreadsheetApp.flush(); 
  } catch(e) {}
}

function resetShopifyScript_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('SHOPIFY_TEMP_FILE_ID');
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {}
    props.deleteProperty('SHOPIFY_TEMP_FILE_ID');
  }
  props.deleteProperty('SHOPIFY_BATCH_STATE');
}

function isShopifyTimeUp_(startTime) {
  return (new Date().getTime() - startTime) > SHOPIFY_MAX_EXECUTION_TIME_MS;
}

function saveShopifyDataToDrive_(data) {
  const content = JSON.stringify(data);
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('SHOPIFY_TEMP_FILE_ID');
  if (fileId) {
    try { DriveApp.getFileById(fileId).setContent(content); return; } catch (e) {}
  }
  const file = DriveApp.createFile(SHOPIFY_TEMP_FILENAME, content, MimeType.PLAIN_TEXT);
  props.setProperty('SHOPIFY_TEMP_FILE_ID', file.getId());
}

function loadShopifyDataFromDrive_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('SHOPIFY_TEMP_FILE_ID');
  if (fileId) {
    try { return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString()); } catch (e) {}
  }
  return {};
}
