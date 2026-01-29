/**
 * @file WooCommerceCustomers.gs
 * @description Fetches all unique customer data by processing all WooCommerce orders.
 * This method captures both registered users and guest customers. It processes orders
 * in batches to avoid script timeouts and stores a unique list of customers based on
 * their email address.
 *
 * v4.2 - Scalable Data Cleaning
 * - Replaced the hardcoded email correction with a more scalable system using the
 * Levenshtein distance algorithm to detect and fix a wide variety of domain typos.
 * - Added a new helper function `_cust_levenshteinDistance` for the email correction logic.
 */

// --- Script-level Constants ---
const CUST_ALL_CUSTOMERS_SHEET_NAME = "WooCommerceCustomers"; // UPDATED Sheet Name
const CUST_CONFIG_SHEET_NAME = "Config";

// --- API Configuration ---
const CUST_ORDERS_PER_PAGE = 50;
const CUST_API_RETRIES = 3;
const CUST_MAX_EXECUTION_TIME_SECONDS = 270; // 4.5 minutes to be safe.

/**
 * Main orchestrator function to build the customer list from orders.
 * Handles both initial full syncs and subsequent incremental updates.
 */
function runCustomerReportFromOrders() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 0. Ensure Destination Sheet Exists Immediately ---
    const customerSheet = getOrCreateSheet(spreadsheet, CUST_ALL_CUSTOMERS_SHEET_NAME);
    const headers = ["First Name", "Last Name", "Email", "Phone", "Country", "Zip"];
    if (customerSheet.getLastRow() === 0) {
       customerSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center");
    }

    const scriptProperties = PropertiesService.getScriptProperties();
    const lastSyncDate = scriptProperties.getProperty('CUST_LAST_SUCCESSFUL_SYNC');
    
    // --- 1. Load Configuration ---
    const configSheet = spreadsheet.getSheetByName(CUST_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Configuration sheet "${CUST_CONFIG_SHEET_NAME}" does not exist.`);
    }

    // Use CommonUtilities to load config
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    
    let shopUrl = getConfigValue(SCRIPT_CONFIGS, "WooCommerce Domain", 'string');
    if (shopUrl && !shopUrl.startsWith("http")) {
      shopUrl = "https://" + shopUrl;
    }

    const consumerKey = getConfigValue(SCRIPT_CONFIGS, "WooCommerce API Key", 'string');
    const consumerSecret = getConfigValue(SCRIPT_CONFIGS, "WooCommerce API Secret", 'string');
    
    if (!shopUrl || !consumerKey || !consumerSecret) {
      throw new Error(`"WooCommerce Domain", "API Key", or "API Secret" missing in '${CUST_CONFIG_SHEET_NAME}'.`);
    }
    const authHeader = { "Authorization": "Basic " + Utilities.base64Encode(`${consumerKey}:${consumerSecret}`) };
    Logger.log(`Configuration loaded. Last successful sync: ${lastSyncDate || 'Never'}`);

    // --- 2. Fetch Orders & Build Unique Customer List ---
    const results = _cust_fetchOrdersAndBuildCustomerList(shopUrl, authHeader, scriptProperties, lastSyncDate);
    
    // --- 3. Save State or Write Final Results ---
    if (results.nextPageToFetch) {
      // In-progress: Save state for the next run.
      scriptProperties.setProperty('CUST_ORDERS_NEXT_PAGE', results.nextPageToFetch);
      scriptProperties.setProperty('CUST_TEMP_CUSTOMER_MAP', JSON.stringify(Array.from(results.customerMap.entries())));
      Logger.log(`Batch complete. Processed ${results.customerMap.size} customers. Next page: ${results.nextPageToFetch}. Run again.`);
    } else {
      // Finished a full sync or an update.
      Logger.log(`All orders processed. Found ${results.customerMap.size} unique customers.`);
      
      // If there are new customers, write them to the sheet.
      if (results.customerMap.size > 0) {
          _cust_writeCustomerListToSheet(results.customerMap, !lastSyncDate);
      } else {
          Logger.log("No new customers found in this run.");
      }
      
      // Clean up and set the sync date for the next update run.
      scriptProperties.deleteProperty('CUST_ORDERS_NEXT_PAGE');
      scriptProperties.deleteProperty('CUST_TEMP_CUSTOMER_MAP');
      scriptProperties.setProperty('CUST_LAST_SUCCESSFUL_SYNC', new Date().toISOString());
      Logger.log("SUCCESS: Sync complete. Last sync date has been updated.");
    }

  } catch (e) {
    Logger.log(`CRITICAL ERROR: ${e.message}\nStack: ${e.stack}`);
    throw e;
  }
}

/**
 * Resets the entire process, deleting the last sync date and clearing the sheet.
 * Run this to trigger a complete re-sync from the very first order.
 */
function resetCustomerFromOrdersProgress() {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.deleteProperty('CUST_ORDERS_NEXT_PAGE');
  scriptProperties.deleteProperty('CUST_TEMP_CUSTOMER_MAP');
  scriptProperties.deleteProperty('CUST_LAST_SUCCESSFUL_SYNC'); // Critical for re-sync
  Logger.log('Full reset complete. The next run will be a full sync from the beginning.');
  getOrCreateSheet(SpreadsheetApp.getActiveSpreadsheet(), CUST_ALL_CUSTOMERS_SHEET_NAME).clear();
  Logger.log(`Sheet "${CUST_ALL_CUSTOMERS_SHEET_NAME}" has been cleared.`);
}

/**
 * Fetches orders in batches and builds a unique map of customers.
 * @param {string} lastSyncDate - An ISO date string. If provided, only fetches orders after this date.
 */
function _cust_fetchOrdersAndBuildCustomerList(shopUrl, authHeader, scriptProperties, lastSyncDate) {
  const startTime = new Date().getTime();
  let page = parseInt(scriptProperties.getProperty('CUST_ORDERS_NEXT_PAGE')) || 1;
  const savedCustomers = scriptProperties.getProperty('CUST_TEMP_CUSTOMER_MAP');
  const customerMap = savedCustomers ? new Map(JSON.parse(savedCustomers)) : new Map();
  
  while (true) {
    if ((new Date().getTime() - startTime) / 1000 > CUST_MAX_EXECUTION_TIME_SECONDS) {
      Logger.log('Execution time limit approaching. Pausing process.');
      return { customerMap: customerMap, nextPageToFetch: page };
    }
    
    let endpoint = `${shopUrl}/wp-json/wc/v3/orders?page=${page}&per_page=${CUST_ORDERS_PER_PAGE}&_fields=id,billing`;
    if(lastSyncDate) {
        endpoint += `&after=${lastSyncDate}`;
    }
    Logger.log(`Fetching orders: ${endpoint}`);
    
    const orderBatch = _cust_fetchWooDataWithRetries(endpoint, { headers: authHeader });

    if (!orderBatch || orderBatch.length === 0) {
      Logger.log('No more orders found. Finalizing customer list.');
      return { customerMap: customerMap, nextPageToFetch: null };
    }
    Logger.log(`Processing ${orderBatch.length} orders from page ${page}.`);

    orderBatch.forEach(order => {
      const billing = order.billing;
      if (billing && billing.email) {
        // Correct the email BEFORE using it as a key
        const correctedEmail = _cust_correctEmailTypos(billing.email);
        
        if (!customerMap.has(correctedEmail)) {
          customerMap.set(correctedEmail, {
            first_name: billing.first_name,
            last_name: billing.last_name,
            email: correctedEmail, // Use the corrected email
            phone: _cust_formatPhoneE164(billing.phone, billing.country),
            country: billing.country,
            postcode: billing.postcode,
          });
        }
      }
    });

    if (orderBatch.length < CUST_ORDERS_PER_PAGE) {
      Logger.log('This was the last page of orders for this run.');
      return { customerMap: customerMap, nextPageToFetch: null };
    }
    page++;
  }
}

/**
 * Writes or appends the customer list to the spreadsheet.
 * @param {Map} customerMap - A map of unique customers.
 * @param {boolean} isFullSync - If true, clears the sheet. If false, appends data.
 */
function _cust_writeCustomerListToSheet(customerMap, isFullSync) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(spreadsheet, CUST_ALL_CUSTOMERS_SHEET_NAME);
  
  if (isFullSync) {
    sheet.clear();
    const headers = ["First Name", "Last Name", "Email", "Phone", "Country", "Zip"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center");
  }
  
  if (customerMap.size === 0) return;

  const customerData = Array.from(customerMap.values()).map(c => [
    c.first_name || "N/A", c.last_name || "N/A", c.email || "N/A",
    c.phone || "N/A", c.country || "N/A", c.postcode || "N/A"
  ]);
  
  sheet.getRange(sheet.getLastRow() + 1, 1, customerData.length, customerData[0].length).setValues(customerData);
  if (isFullSync) sheet.autoResizeColumns(1, customerData[0].length);
}

// --- HELPER FUNCTIONS ---

/**
 * Corrects common typos in email domains using Levenshtein distance.
 * @param {string} email The original email address.
 * @returns {string} The corrected email address.
 */
function _cust_correctEmailTypos(email) {
    if (!email) return email;

    const parts = email.split('@');
    if (parts.length !== 2) return email; // Not a valid email format

    let local = parts[0];
    let domain = parts[1].toLowerCase();

    // List of common, correct domains to check against.
    const COMMON_VALID_DOMAINS = ["gmail.com", "yahoo.com", "icloud.com", "outlook.com", "hotmail.com", "aol.com"];
    const SIMILARITY_THRESHOLD = 2; // Allow up to 2 "edits" (e.g., gamil.com -> gmail.com is 1 edit)

    let bestMatch = { domain: domain, distance: 99 };

    for (const validDomain of COMMON_VALID_DOMAINS) {
        const distance = _cust_levenshteinDistance(domain, validDomain);
        if (distance < bestMatch.distance) {
            bestMatch = { domain: validDomain, distance: distance };
        }
    }

    // If we found a very close match, use it for correction.
    if (bestMatch.distance > 0 && bestMatch.distance <= SIMILARITY_THRESHOLD) {
        Logger.log(`Corrected email domain typo: '${domain}' to '${bestMatch.domain}' for user ${local}`);
        domain = bestMatch.domain;
    }
    
    return `${local}@${domain}`;
}

/**
 * Calculates the Levenshtein distance between two strings.
 * This measures the number of edits needed to change one string into the other.
 * @param {string} s1 The first string.
 * @param {string} s2 The second string.
 * @returns {number} The Levenshtein distance.
 */
function _cust_levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }
    return costs[s2.length];
}


function _cust_formatPhoneE164(phone, country) {
  if (!phone || !country) return phone;
  const countryCodes = { "RO":"40", "US":"1", "GB":"44", "DE":"49", "FR":"33", "IT":"39", "ES":"34" };
  const dialingCode = countryCodes[country.toUpperCase()];
  if (!dialingCode) return phone;
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith(dialingCode)) return `+${cleanPhone}`;
  if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
  return `+${dialingCode}${cleanPhone}`;
}

function _cust_fetchWooDataWithRetries(endpoint, options) {
  options.muteHttpExceptions = true;
  for (let i = 0; i < CUST_API_RETRIES; i++) {
    try {
      const response = UrlFetchApp.fetch(endpoint, options);
      if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) return JSON.parse(response.getContentText());
      Logger.log(`API Error (Attempt ${i + 1}): Code ${response.getResponseCode()} for ${endpoint}`);
      if (i < CUST_API_RETRIES - 1) Utilities.sleep(2000 * (i + 1));
    } catch (e) {
      Logger.log(`Fetch Exception (Attempt ${i + 1}): ${e.message}`);
      if (i === CUST_API_RETRIES - 1) throw e;
    }
  }
  throw new Error(`Failed to fetch data from ${endpoint} after all retries.`);
}
