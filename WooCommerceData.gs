/**
 * @file WooCommerceData.gs
 * @description Fetches product and order data from a WooCommerce store via its REST API.
 * Optimized for daily background execution, it processes the data and writes detailed
 * product information and an account summary to the spreadsheet.
 * Relies on CommonUtilities.gs for all shared utility functions.
 *
 * Changelog (v2.1 - Bug Fix):
 * - Corrected a critical error where this script was incorrectly calling a function from ShopifyData.gs.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for fetching, processing, and writing.
 * - Added a main try-catch block for robust error handling.
 * - Centralized API call logic with retries and exponential backoff.
 */

// --- Script-level Constants ---
const WOO_CONFIG_SHEET_NAME = "Config";
const WOO_ACCOUNT_DATA_SHEET_NAME = "AccountData";
const WOOCOMMERCE_DATA_SHEET_NAME = "WooCommerce";

// --- API Configuration ---
const WOO_PRODUCTS_PER_PAGE = 100;
const WOO_ORDERS_PER_PAGE = 100;
const WOO_API_RETRIES = 3;


/**
 * Main orchestrator function to run the WooCommerce report generation process.
 */
function runWooCommerceReport() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(WOO_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Configuration sheet "${WOO_CONFIG_SHEET_NAME}" does not exist.`);
    }

    // Assumes CommonUtilities.gs is available
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const rawShopUrl = getConfigValue(SCRIPT_CONFIGS, "WooCommerce Domain", 'string');
    const shopUrl = rawShopUrl && !rawShopUrl.startsWith("http") ? "https://" + rawShopUrl : rawShopUrl;
    const days = getConfigValue(SCRIPT_CONFIGS, "Timeframe", 'int', 30);
    const consumerKey = getConfigValue(SCRIPT_CONFIGS, "WooCommerce API Key", 'string');
    const consumerSecret = getConfigValue(SCRIPT_CONFIGS, "WooCommerce API Secret", 'string');

    if (!shopUrl || !consumerKey || !consumerSecret) {
      throw new Error(`"WooCommerce Domain", "API Key", or "API Secret" is missing in '${WOO_CONFIG_SHEET_NAME}'.`);
    }
    if (days <= 0) {
      throw new Error(`"Timeframe" must be a positive number in '${WOO_CONFIG_SHEET_NAME}'.`);
    }
    
    Logger.log(`WooCommerce Report Config: Domain ${shopUrl}, Timeframe ${days} days.`);
    const authHeader = { "Authorization": "Basic " + Utilities.base64Encode(consumerKey + ":" + consumerSecret) };

    // --- 2. Fetch and Process Data ---
    const productDataMap = fetchAndProcessProducts_Woo_(shopUrl, authHeader);
    const orderProcessingResults = processOrders_Woo_(shopUrl, authHeader, days, productDataMap);
    
    // --- 3. Write Results to Sheets ---
    writeResultsToSheets_Woo_(spreadsheet, orderProcessingResults.productDataMap, orderProcessingResults.summary);

    Logger.log("WooCommerce report generation completed successfully!");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runWooCommerceReport: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Fetches all products from WooCommerce and initializes a map for data processing.
 * @private
 * @param {string} shopUrl The base URL of the WooCommerce store.
 * @param {object} authHeader The authorization header for API calls.
 * @return {Map<number, object>} A map where keys are product IDs and values are product data objects.
 */
function fetchAndProcessProducts_Woo_(shopUrl, authHeader) {
  const productDataMap = new Map();
  let page = 1;

  while (true) {
    const endpoint = `${shopUrl}/wp-json/wc/v3/products?page=${page}&per_page=${WOO_PRODUCTS_PER_PAGE}&_fields=id,name,price,stock_status,stock_quantity,categories,date_created_gmt`;
    const productBatch = fetchWooDataWithRetries_(endpoint, { headers: authHeader });

    if (!productBatch || productBatch.length === 0) break;

    productBatch.forEach(product => {
      let categoryName = "N/A";
      if (product.categories && product.categories.length > 0) {
        const topLevelCategory = product.categories.find(cat => cat.parent === 0);
        categoryName = (topLevelCategory || product.categories[0])?.name || "N/A";
      }

      productDataMap.set(product.id, {
        name: product.name || "N/A",
        category: categoryName,
        price: parseFloatSafe(product.price, 0.0),
        stockStatus: product.stock_status || "unknown",
        stockQuantity: parseIntSafe(product.stock_quantity, 0),
        dateCreated: product.date_created_gmt || null,
        totalRevenue: 0,
        uniqueOrderIds: new Set(),
        totalItemsSold: 0,
        revenueLast14Days: 0,
      });
    });

    if (productBatch.length < WOO_PRODUCTS_PER_PAGE) break;
    page++;
  }

  Logger.log(`Fetched and initialized ${productDataMap.size} products.`);
  return productDataMap;
}

/**
 * Fetches orders within the timeframe and updates the product data map with revenue and sales data.
 * @private
 * @param {string} shopUrl The base URL of the WooCommerce store.
 * @param {object} authHeader The authorization header for API calls.
 * @param {number} days The number of days back to fetch orders.
 * @param {Map<number, object>} productDataMap The map of product data to be updated.
 * @return {{productDataMap: Map<number, object>, summary: object}} The updated product map and summary totals.
 */
function processOrders_Woo_(shopUrl, authHeader, days, productDataMap) {
  const currentDate = new Date();
  const startDate = new Date(currentDate.getTime() - days * 24 * 60 * 60 * 1000);
  const fourteenDaysAgoDate = new Date(currentDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  const uniqueOrdersOverall = new Set();
  let page = 1;

  while (true) {
    const endpoint = `${shopUrl}/wp-json/wc/v3/orders?status=completed,processing&after=${startDate.toISOString()}&page=${page}&per_page=${WOO_ORDERS_PER_PAGE}&_fields=id,status,line_items,date_created_gmt`;
    const orders = fetchWooDataWithRetries_(endpoint, { headers: authHeader });

    if (!orders || orders.length === 0) break;

    orders.forEach(order => {
      uniqueOrdersOverall.add(order.id);
      const orderCreatedAt = new Date(order.date_created_gmt + "Z");

      order.line_items?.forEach(item => {
        const productInfo = productDataMap.get(item.product_id);
        if (productInfo) {
          const itemRevenue = parseFloatSafe(item.total, 0.0);
          const itemQuantity = parseIntSafe(item.quantity, 0);

          productInfo.totalRevenue += itemRevenue;
          productInfo.totalItemsSold += itemQuantity;
          productInfo.uniqueOrderIds.add(order.id);

          if (orderCreatedAt >= fourteenDaysAgoDate) {
            productInfo.revenueLast14Days += itemRevenue;
          }
        }
      });
    });

    if (orders.length < WOO_ORDERS_PER_PAGE) break;
    page++;
  }
  
  Logger.log(`Processed ${uniqueOrdersOverall.size} unique orders.`);
  
  // Calculate final summary totals
  const summary = {
    shopUrl: shopUrl, // Added for logging context
    totalRevenue: 0,
    totalItemsSold: 0,
    totalUniqueOrders: uniqueOrdersOverall.size,
    totalProducts: productDataMap.size,
    timeframeText: formatDisplayDateRange(days), // From CommonUtilities
    lastRunText: formatDisplayDateTime(new Date()), // From CommonUtilities
  };

  for (const product of productDataMap.values()) {
    summary.totalRevenue += product.totalRevenue;
    summary.totalItemsSold += product.totalItemsSold;
  }

  return { productDataMap, summary };
}

/**
 * Generic helper function to fetch data from a WooCommerce endpoint with retries.
 * @private
 * @param {string} endpoint The full URL for the API endpoint.
 * @param {object} options The options for UrlFetchApp.fetch().
 * @return {Array|object|null} The parsed JSON response, or null on failure.
 */
function fetchWooDataWithRetries_(endpoint, options) {
  options.muteHttpExceptions = true; // Handle errors manually

  for (let i = 0; i < WOO_API_RETRIES; i++) {
    try {
      const response = UrlFetchApp.fetch(endpoint, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode >= 200 && responseCode < 300) {
        return JSON.parse(responseText);
      } else {
        Logger.log(`API Error (Attempt ${i + 1}/${WOO_API_RETRIES}): ${responseCode} for ${endpoint.substring(0, 100)}...`);
        if (responseCode === 401 || responseCode === 403) {
          throw new Error(`Authorization error (${responseCode}). Check API keys and permissions.`);
        }
        // Exponential backoff for other server errors
        if (i < WOO_API_RETRIES - 1) Utilities.sleep(1000 * Math.pow(2, i));
      }
    } catch (e) {
      Logger.log(`Fetch Exception (Attempt ${i + 1}/${WOO_API_RETRIES}): ${e.message} for ${endpoint.substring(0, 100)}...`);
      if (i === WOO_API_RETRIES - 1) throw e; // Rethrow on the last attempt
    }
  }
  throw new Error(`Failed to fetch data from ${endpoint.substring(0, 100)}... after ${WOO_API_RETRIES} attempts.`);
}


/**
 * Writes all fetched and processed data to the respective sheets.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet object.
 * @param {Map<number, object>} productDataMap The final map of processed product data.
 * @param {object} summary The final summary data for the account.
 */
function writeResultsToSheets_Woo_(spreadsheet, productDataMap, summary) {
  // --- Write to WooCommerce Sheet ---
  const productSheet = getOrCreateSheet(spreadsheet, WOOCOMMERCE_DATA_SHEET_NAME);
  productSheet.clear(); // Clear everything including formatting
  
  const productHeaders = [
    "Product ID", "Product Name", "Product Category", "Product Price", "Date Created",
    "Total Orders", "Total Items Sold", "Total Revenue", "Revenue last 14 days",
    "Stock Status", "Stock Quantity"
  ];
  productSheet.getRange(1, 1, 1, productHeaders.length).setValues([productHeaders]).setFontWeight("bold").setHorizontalAlignment("center");
  
  const productList = Array.from(productDataMap.entries()).map(([id, p]) => [
    id, p.name, p.category, p.price, p.dateCreated,
    p.uniqueOrderIds.size, p.totalItemsSold, p.totalRevenue, p.revenueLast14Days,
    p.stockStatus, p.stockQuantity
  ]).sort((a, b) => b[7] - a[7]); // Sort by Total Revenue (index 7)

  if (productList.length > 0) {
    const range = productSheet.getRange(2, 1, productList.length, productHeaders.length);
    range.setValues(productList);
    // Formatting
    productSheet.getRange(2, 4, productList.length, 1).setNumberFormat('#,##0.00'); // Price
    productSheet.getRange(2, 8, productList.length, 2).setNumberFormat('#,##0.00'); // Revenues
  } else {
    productSheet.getRange(2, 1).setValue("No product data to display.");
  }
  
  // --- Write to AccountData Sheet ---
  // Calculates OOS items with sales
  let oosWithSalesCount = 0;
  let totalWithSalesCount = 0;
  
  for (const product of productDataMap.values()) {
    if (product.totalRevenue > 0) {
      totalWithSalesCount++;
      if (product.stockStatus !== "in stock" && product.stockStatus !== "instock") { // Catch various string variations
        oosWithSalesCount++;
      }
    }
  }
  
  const oosPercent = totalWithSalesCount > 0 
    ? ((oosWithSalesCount / totalWithSalesCount) * 100).toFixed(1) + "%" 
    : "0%";

  upsertAccountDataRow(spreadsheet, WOO_ACCOUNT_DATA_SHEET_NAME, {
    source: `WooCommerce - ${summary.shopUrl}`,
    timeframe: summary.timeframeText,
    revenue: summary.totalRevenue,
    orders: summary.totalUniqueOrders,
    cost: "-", // Cost not typically available via Woo API
    oosCount: oosWithSalesCount,
    oosPercent: oosPercent
  });
}
