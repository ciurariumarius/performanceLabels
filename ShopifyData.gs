/** 23.09.2025
 * @file ShopifyData.gs
 * @description Fetches product variant and order data from a Shopify store via its REST API.
 * Optimized for daily background execution, it processes the data and writes a detailed report
 * and an account summary to the spreadsheet.
 * Relies on CommonUtilities.gs for all shared utility functions.
 *
 * Changelog (v2.2 - Parent ID Column):
 * - Added a separate "Parent Product ID" column to the Shopify sheet for improved clarity and filtering.
 * - Renamed the original concatenated ID column to "Formatted ID".
 *
 * Changelog (v2.1 - Config Fix):
 * - Corrected config lookup to use the general "Timeframe" setting.
 * - Set the default country code to "RO" directly as per user feedback.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for config, fetching, processing, and writing.
 * - Added a main try-catch block for robust error handling.
 * - Centralized paginated API call logic with rate limit handling.
 */

// --- Script-level Constants ---
const SHOPIFY_CONFIG_SHEET_NAME = "Config";
const SHOPIFY_SUMMARY_DATA_SHEET_NAME = "AccountData";
const SHOPIFY_PRODUCT_DATA_SHEET_NAME = "Shopify";

// --- API Configuration ---
const SHOPIFY_API_VERSION = '2024-04';
const SHOPIFY_ITEMS_PER_PAGE = 50;
const SHOPIFY_API_RETRIES = 3;

/**
 * Main orchestrator function to run the Shopify report generation process.
 */
function runShopifyReport() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // --- 1. Load and Validate Configuration ---
    const config = getShopifyConfig_(spreadsheet);
    Logger.log(`Shopify Report Config: Domain ${config.domain}, Timeframe ${config.days} days, API Version ${SHOPIFY_API_VERSION}.`);

    // --- 2. Fetch and Process Data ---
    const productDataMap = fetchAndProcessProducts_(config);
    const orderProcessingResults = processOrders_(config, productDataMap);
    
    // --- 3. Write Results to Sheets ---
    writeResultsToSheets_(spreadsheet, orderProcessingResults.productDataMap, orderProcessingResults.summary);

    Logger.log("Shopify report generation completed successfully!");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runShopifyReport: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Loads and validates all necessary configuration from the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet object.
 * @return {object} A configuration object with domain, accessToken, and days.
 */
function getShopifyConfig_(spreadsheet) {
  const configSheet = spreadsheet.getSheetByName(SHOPIFY_CONFIG_SHEET_NAME);
  if (!configSheet) {
    throw new Error(`Configuration sheet "${SHOPIFY_CONFIG_SHEET_NAME}" does not exist.`);
  }

  // Assumes CommonUtilities.gs is available
  const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
  const config = {
    domain: getConfigValue(SCRIPT_CONFIGS, "Shopify Domain", 'string'),
    accessToken: getConfigValue(SCRIPT_CONFIGS, "Shopify accessToken", 'string'),
    days: getConfigValue(SCRIPT_CONFIGS, "Timeframe", 'int', 30), // Uses the general "Timeframe" config
    countryCode: 'RO' // Set default country code directly
  };

  if (!config.domain || !config.accessToken || !config.domain.includes('.myshopify.com')) {
    throw new Error(`"Shopify Domain" or "accessToken" is missing or invalid in '${SHOPIFY_CONFIG_SHEET_NAME}'.`);
  }
  if (config.days <= 0) {
    throw new Error(`"Timeframe" must be a positive number in '${SHOPIFY_CONFIG_SHEET_NAME}'.`);
  }
  return config;
}

/**
 * Fetches all products and their variants from Shopify and initializes a map for data processing.
 * @private
 * @param {object} config The configuration object from getShopifyConfig_.
 * @return {Map<number, object>} A map where keys are variant IDs and values are product data objects.
 */
function fetchAndProcessProducts_(config) {
  const productDataMap = new Map();
  const endpoint = `https://${config.domain}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=${SHOPIFY_ITEMS_PER_PAGE}&fields=id,title,variants,created_at`;
  
  Logger.log("Fetching Shopify products and variants...");
  const allProducts = fetchShopifyDataWithPagination_(endpoint, config.accessToken);

  allProducts.forEach(product => {
    product.variants?.forEach(variant => {
      const formattedProductId = `shopify_${config.countryCode}_${product.id}_${variant.id}`;
      const formattedDateCreated = product.created_at ? formatDisplayDateTime(new Date(product.created_at)) : null;

      productDataMap.set(variant.id, {
        formattedId: formattedProductId,
        variantId: variant.id,
        productId: product.id,
        productName: product.title,
        variantTitle: variant.title,
        price: parseFloatSafe(variant.price, 0.0),
        dateCreated: formattedDateCreated,
        stockStatus: determineStockStatus_(variant),
        stockQuantity: parseIntSafe(variant.inventory_quantity, 0),
        totalRevenue: 0,
        uniqueOrderIds: new Set(),
        totalItemsSold: 0,
        revenueLast14Days: 0,
      });
    });
  });

  Logger.log(`Fetched and initialized ${productDataMap.size} product variants.`);
  return productDataMap;
}

/**
 * Determines the stock status string for a Shopify variant.
 * @private
 * @param {object} variant The Shopify variant object.
 * @return {string} The calculated stock status.
 */
function determineStockStatus_(variant) {
  if (variant.inventory_management !== 'shopify') {
    return "not managed";
  }
  const stockQuantity = parseIntSafe(variant.inventory_quantity, 0);
  if (stockQuantity > 0) {
    return "in stock";
  }
  if (variant.inventory_policy === 'continue') {
    return "allows backorders";
  }
  return "out of stock";
}

/**
 * Fetches orders and updates the product data map with revenue and sales data.
 * @private
 * @param {object} config The configuration object from getShopifyConfig_.
 * @param {Map<number, object>} productDataMap The map of product data to be updated.
 * @return {{productDataMap: Map<number, object>, summary: object}} The updated product map and summary totals.
 */
function processOrders_(config, productDataMap) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - config.days * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(endDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  const endpoint = `https://${config.domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${SHOPIFY_ITEMS_PER_PAGE}&status=any&created_at_min=${startDate.toISOString()}&fields=id,line_items,created_at,financial_status,cancelled_at`;
  
  Logger.log(`Fetching Shopify orders from ${startDate.toISOString()}...`);
  const allOrders = fetchShopifyDataWithPagination_(endpoint, config.accessToken);
  const uniqueOrdersOverall = new Set();

  allOrders.forEach(order => {
    if (order.cancelled_at || order.financial_status === 'voided') return;

    uniqueOrdersOverall.add(order.id);
    const orderCreatedAt = new Date(order.created_at);

    order.line_items?.forEach(item => {
      const productInfo = productDataMap.get(item.variant_id);
      if (productInfo) {
        const itemRevenue = parseFloatSafe(item.price, 0.0) * parseIntSafe(item.quantity, 0);
        
        productInfo.totalRevenue += itemRevenue;
        productInfo.totalItemsSold += parseIntSafe(item.quantity, 0);
        productInfo.uniqueOrderIds.add(order.id);

        if (orderCreatedAt >= fourteenDaysAgo) {
          productInfo.revenueLast14Days += itemRevenue;
        }
      }
    });
  });

  Logger.log(`Processed ${uniqueOrdersOverall.size} valid, unique orders.`);

  // Calculate final summary totals
  const summary = {
    domain: config.domain, // Added for logging context
    totalRevenue: 0,
    totalItemsSold: 0,
    totalUniqueOrders: uniqueOrdersOverall.size,
    totalVariants: productDataMap.size,
    timeframeText: formatDisplayDateRange(config.days),
    lastRunText: formatDisplayDateTime(new Date()),
  };
  
  for (const product of productDataMap.values()) {
    summary.totalRevenue += product.totalRevenue;
    summary.totalItemsSold += product.totalItemsSold;
  }

  return { productDataMap, summary };
}

/**
 * Fetches all pages of data from a given Shopify REST API endpoint.
 * This function is designed to be robust, handling pagination by parsing the 'Link' header,
 * respecting API rate limits (HTTP 429 status) by using the 'Retry-After' header,
 * and retrying transient network errors with an exponential backoff strategy. A small delay
 * is added between page fetches to prevent hitting rate limits.
 *
 * @private
 * @param {string} initialUrl The complete, initial URL for the API endpoint. This should include
 * any query parameters like 'limit' or 'fields'.
 * @param {string} accessToken The Shopify private app access token, which is sent in the
 * 'X-Shopify-Access-Token' header for authentication.
 * @return {Array<object>} A flattened array containing all items retrieved from all pages of the API response.
 * @throws {Error} If the API request fails to return a successful status code (2xx) after
 * all configured retries have been exhausted.
 */
function fetchShopifyDataWithPagination_(initialUrl, accessToken) {
  const allItems = [];
  let nextUrl = initialUrl;

  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'X-Shopify-Access-Token': accessToken }
  };

  while (nextUrl) {
    let response;
    for (let i = 0; i < SHOPIFY_API_RETRIES; i++) {
      try {
        response = UrlFetchApp.fetch(nextUrl, options);
        const responseCode = response.getResponseCode();
        
        if (responseCode === 429) { // Rate limited
          const retryAfter = response.getHeaders()['Retry-After'] || (5 * (i + 1));
          Logger.log(`API Rate Limit (429). Retrying after ${retryAfter} seconds...`);
          Utilities.sleep(parseInt(retryAfter) * 1000);
          continue; // Retry the same request
        }
        
        if (responseCode >= 200 && responseCode < 300) {
          const responseData = JSON.parse(response.getContentText());
          const dataKey = Object.keys(responseData)[0]; // e.g., 'products' or 'orders'
          if (responseData[dataKey]) {
            allItems.push(...responseData[dataKey]);
          }

          const linkHeader = response.getHeaders()['Link'];
          const links = linkHeader ? linkHeader.split(',') : [];
          const nextLink = links.find(link => link.includes('rel="next"'));
          nextUrl = nextLink ? nextLink.match(/<([^>]+)>/)[1] : null;
          break; // Success, exit retry loop
          
        } else {
          throw new Error(`API Error: ${responseCode} - ${response.getContentText().substring(0, 200)}`);
        }
      } catch (e) {
        Logger.log(`Fetch Exception (Attempt ${i + 1}/${SHOPIFY_API_RETRIES}): ${e.message}`);
        if (i === SHOPIFY_API_RETRIES - 1) throw e; // Rethrow on last attempt
        Utilities.sleep(1000 * Math.pow(2, i)); // Exponential backoff
      }
    }
    if (!response) throw new Error(`Failed to fetch data from ${nextUrl} after all retries.`);
    if(nextUrl) Utilities.sleep(500); // Pause between successful page fetches
  }
  return allItems;
}

/**
 * Writes all fetched and processed data to the respective sheets.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet object.
 * @param {Map<number, object>} productDataMap The final map of processed product data.
 * @param {object} summary The final summary data for the account.
 */
function writeResultsToSheets_(spreadsheet, productDataMap, summary) {
  // --- Write to Shopify Sheet ---
  const productSheet = getOrCreateSheet(spreadsheet, SHOPIFY_PRODUCT_DATA_SHEET_NAME);
  productSheet.clear();

  const productHeaders = [
    "Product ID", "Parent ID", "Variant ID", "Product Name", "Variant Title", "Product Price", "Date Created",
    "Total Orders", "Total Items Sold", "Total Revenue", "Revenue last 14 days", "Stock Status", "Stock Quantity"
  ];
  productSheet.getRange(1, 1, 1, productHeaders.length).setValues([productHeaders]).setFontWeight("bold").setHorizontalAlignment("center");

  const productList = Array.from(productDataMap.values()).map(p => [
    p.formattedId, p.productId, p.variantId, p.productName, p.variantTitle, p.price, p.dateCreated,
    p.uniqueOrderIds.size, p.totalItemsSold, p.totalRevenue, p.revenueLast14Days,
    p.stockStatus, p.stockQuantity
  ]).sort((a, b) => b[9] - a[9]); // Sort by Total Revenue (index 9)

  if (productList.length > 0) {
    const range = productSheet.getRange(2, 1, productList.length, productHeaders.length);
    range.setValues(productList);
    productSheet.getRange(2, 6, productList.length, 1).setNumberFormat('#,##0.00'); // Price (Column F)
    productSheet.getRange(2, 10, productList.length, 2).setNumberFormat('#,##0.00'); // Revenues (Columns J, K)
  } else {
    productSheet.getRange(2, 1).setValue("No product variant data to display.");
  }
  
  // --- Write to AccountData Sheet ---
  // Calculates OOS items with sales
  let oosWithSalesCount = 0;
  let totalWithSalesCount = 0;
  
  for (const product of productDataMap.values()) {
    if (product.totalRevenue > 0) {
      totalWithSalesCount++;
      if (product.stockStatus !== "in stock") {
        oosWithSalesCount++;
      }
    }
  }
  
  const oosPercent = totalWithSalesCount > 0 
    ? ((oosWithSalesCount / totalWithSalesCount) * 100).toFixed(1) + "%" 
    : "0%";

  upsertAccountDataRow(spreadsheet, SHOPIFY_SUMMARY_DATA_SHEET_NAME, {
    source: `Shopify - ${summary.domain}`,
    timeframe: summary.timeframeText,
    revenue: summary.totalRevenue,
    orders: summary.totalUniqueOrders,
    cost: "-", // Cost not fetched from Shopify
    oosCount: oosWithSalesCount,
    oosPercent: oosPercent
  });
}
