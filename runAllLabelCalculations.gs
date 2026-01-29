/**
 * @file runAllLabelCalculations.gs
 * @description Main orchestrator script to run all individual label calculation functions sequentially.
 * This provides a single entry point for a trigger to update all labels in the "Metrics" sheet.
 * It now INCLUDES the data consolidation logic to merge platform data + Google Ads data first.
 */

const METRICS_SHEET_NAME = "Metrics";
const GADS_SHEET_NAME_SOURCE = "GAds";
const SHOPIFY_SHEET_NAME_SOURCE = "Shopify";
const WOOCOMMERCE_SHEET_NAME_SOURCE = "WooCommerce";

const METRICS_HEADERS = [
  "id", "Title", "Price", "Revenue", "Orders", "Stock Status", "Stock Qty", // eCommerce
  "Impressions", "Clicks", "Cost", "Conversions", "Conv Value", // GAds
  "Calculated On" // Metadata
];


function runAllLabelCalculations() {
  const startTime = new Date();
  Logger.log("============================================================");
  Logger.log("Starting master label calculation process at: " + startTime.toLocaleString());
  Logger.log("============================================================");

  try {
    // Note: The order of execution can matter if some labels depend on others.
    // This sequence seems logical based on the script functions.

    Logger.log("--- (0/8) Starting: Data Consolidation ---");
    consolidateMetrics(); // Internal function call
    Logger.log("--- Completed: Data Consolidation ---");

    Logger.log("--- (1/8) Starting: Revenue Labels ---");
    runRevenueLabels();
    Logger.log("--- Completed: Revenue Labels ---");

    Logger.log("--- (2/7) Starting: Price Interval Labels ---");
    runPriceLabels();
    Logger.log("--- Completed: Price Interval Labels ---");

    Logger.log("--- (3/7) Starting: Order Volume Labels ---");
    runOrdersLabel();
    Logger.log("--- Completed: Order Volume Labels ---");

    Logger.log("--- (4/7) Starting: Available Variants Labels ---");
    runAvailableVariantsLabel();
    Logger.log("--- Completed: Available Variants Labels ---");

    Logger.log("--- (5/7) Starting: Performance Index Labels ---");
    runPerformanceIndexLabel();
    Logger.log("--- Completed: Performance Index Labels ---");

    Logger.log("--- (6/7) Starting: Trend Labels ---");
    runTrendLabelCalculation();
    Logger.log("--- Completed: Trend Labels ---");

    Logger.log("--- (7/7) Starting: New Product Labels ---");
    runNewProductLabelCalculation();
    Logger.log("--- Completed: New Product Labels ---");

    Logger.log("--- (8/8) Starting: Google Ads Labels ---");
    runGoogleAdsLabelCalculation();
    Logger.log("--- Completed: Google Ads Labels ---");


    const endTime = new Date();
    const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
    Logger.log("============================================================");
    Logger.log("All label calculations completed successfully!");
    Logger.log(`Total execution time: ${executionTime.toFixed(2)} seconds.`);
    Logger.log("Finished at: " + endTime.toLocaleString());
    Logger.log("============================================================");

  } catch (e) {
    const errorTime = new Date();
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Logger.log(`CRITICAL ERROR during runAllLabelCalculations at: ${errorTime.toLocaleString()}`);
    Logger.log(`Message: ${e.message}`);
    Logger.log(`Stack: ${e.stack}`);
    Logger.log("The process was halted. Subsequent calculations did not run.");
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  }
}

/**
 * Main function to consolidate data.
 * Merges Shopify/WooCommerce data with Google Ads data into the Metrics sheet.
 */
function consolidateMetrics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const metricsSheet = getOrCreateSheet(ss, METRICS_SHEET_NAME);

  Logger.log("Starting Data Consolidation...");

  // 1. Determine Source based on Config Sheet Selection
  const configSheet = ss.getSheetByName("Config");
  const selectedPlatform = configSheet ? configSheet.getRange("B20").getValue() : "";
  Logger.log(`Selected Platform in Config: ${selectedPlatform}`);

  let sourceData = [];
  let sourceType = "";

  if (selectedPlatform === "WooCommerce") {
    const wooSheet = ss.getSheetByName(WOOCOMMERCE_SHEET_NAME_SOURCE);
    if (wooSheet && wooSheet.getLastRow() > 1) {
      sourceData = getWooData_(wooSheet);
      sourceType = "WooCommerce";
    }
  } else if (selectedPlatform === "Shopify") {
    const shopifySheet = ss.getSheetByName(SHOPIFY_SHEET_NAME_SOURCE);
    if (shopifySheet && shopifySheet.getLastRow() > 1) {
      sourceData = getShopifyData_(shopifySheet);
      sourceType = "Shopify";
    }
  } else {
    // Falback: Auto-detect if selection is ambiguous or missing
    Logger.log("Platform selection unclear or empty. Attempting auto-detection...");
    const shopifySheet = ss.getSheetByName(SHOPIFY_SHEET_NAME_SOURCE);
    const wooSheet = ss.getSheetByName(WOOCOMMERCE_SHEET_NAME_SOURCE);

    if (shopifySheet && shopifySheet.getLastRow() > 1) {
      sourceData = getShopifyData_(shopifySheet);
      sourceType = "Shopify";
    } else if (wooSheet && wooSheet.getLastRow() > 1) {
      sourceData = getWooData_(wooSheet);
      sourceType = "WooCommerce";
    }
  }

  if (sourceData.length === 0) {
    Logger.log(`No source data found for platform "${selectedPlatform}". Aborting consolidation.`);
    return;
  }
  
  Logger.log(`Identified Source: ${sourceType} with ${sourceData.length} products.`);

  // 2. Load Google Ads Data
  const gadsSheet = ss.getSheetByName(GADS_SHEET_NAME_SOURCE);
  const gadsMap = loadGAdsDataMap_(gadsSheet);
  Logger.log(`Loaded Google Ads Data for ${Object.keys(gadsMap).length} IDs.`);

  // 3. Merge Data
  const combinedData = sourceData.map(item => {
    const gads = gadsMap[item.id] || { imp: 0, click: 0, cost: 0, conv: 0, val: 0 };
    
    return [
      item.id,
      item.title,
      item.price,
      item.revenue,
      item.orders,
      item.stockStatus,
      item.stockQty,
      gads.imp,
      gads.click,
      gads.cost,
      gads.conv,
      gads.val,
      new Date()
    ];
  });

  // 4. Write to Metrics Sheet
  metricsSheet.clearContents(); // Clear old data
  
  // Set Headers
  metricsSheet.getRange(1, 1, 1, METRICS_HEADERS.length)
    .setValues([METRICS_HEADERS])
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  // Write Data
  if (combinedData.length > 0) {
    // Write in chunks to be safe
    writeValuesToSheetSafe(metricsSheet, 2, 1, combinedData);
    
    // Formatting
    const lastRow = combinedData.length + 1;
    metricsSheet.getRange(2, 3, combinedData.length, 2).setNumberFormat("#,##0.00"); // Price, Rev
    metricsSheet.getRange(2, 10, combinedData.length, 1).setNumberFormat("#,##0.00"); // Cost
    metricsSheet.getRange(2, 12, combinedData.length, 1).setNumberFormat("#,##0.00"); // Conv Value
  }
  
  Logger.log("Consolidation Complete.");
}

// --- Helpers ---

function getShopifyData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const rawData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  
  return rawData.map(row => ({
    id: row[0], // Formatted ID
    title: row[3] + " - " + row[4], // Product Name - Variant Title
    price: row[5],
    revenue: row[9], // Index 9 = Column 10
    orders: row[7],
    stockStatus: row[11],
    stockQty: row[12]
  }));
}

function getWooData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const rawData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  
  return rawData.map(row => ({
    id: row[0],
    title: row[1],
    price: row[3],
    revenue: row[7], // Total Revenue
    orders: row[5], // Total Orders
    stockStatus: row[9],
    stockQty: row[10]
  }));
}

function loadGAdsDataMap_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const indices = {
    id: headers.indexOf("id"),
    imp: headers.indexOf("Impressions"),
    click: headers.indexOf("Clicks"),
    cost: headers.indexOf("Cost"),
    conv: headers.indexOf("Conversions"),
    val: headers.indexOf("Conv Value")
  };
  
  if (indices.id === -1) return {};
  
  const map = {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  
  data.forEach(row => {
    const id = row[indices.id];
    if (id) {
       map[id] = {
         imp: parseFloatSafe(row[indices.imp]),
         click: parseFloatSafe(row[indices.click]),
         cost: parseFloatSafe(row[indices.cost]),
         conv: parseFloatSafe(row[indices.conv]),
         val: parseFloatSafe(row[indices.val])
       };
    }
  });
  
  return map;
}
