const METRICS_SHEET_NAME = "Metrics";
const LABELS_SHEET_NAME = "GMC_Feed";
const LABELS_SHEET_2_NAME = "GMC_Feed_2";
const GADS_SHEET_NAME_SOURCE = "GAds";
const SHOPIFY_SHEET_NAME_SOURCE = "Shopify";
const WOOCOMMERCE_SHEET_NAME_SOURCE = "WooCommerce";

const METRICS_HEADERS = [
  "id", "Title", "Date Created", "Price", "Revenue", "Revenue last 14 days", "Orders", "Stock Status", "Stock Qty",
  "Impressions", "Clicks", "Cost", "Conversions", "Conv Value",
  "Calculated On"
];

function runAllLabelCalculations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try { updateDashboardStatus(ss, "Overview", "RUNNING", "Consolidating Metrics..."); } catch(e) {}
  
  Logger.log("--- Starting Data Consolidation ---");
  consolidateMetrics(ss);
  
  Logger.log("--- Starting Label Calculations ---");
  try { runRevenueLabels(); } catch(e) { Logger.log("Error in Revenue: " + e.message); }
  try { runPriceLabels(); } catch(e) { Logger.log("Error in Price: " + e.message); }
  try { runOrdersLabel(); } catch(e) { Logger.log("Error in Orders: " + e.message); }
  try { runAvailableVariantsLabel(); } catch(e) { Logger.log("Error in Variants: " + e.message); }
  try { runPerformanceIndexLabel(); } catch(e) { Logger.log("Error in Performance: " + e.message); }
  try { runTrendLabelCalculation(); } catch(e) { Logger.log("Error in Trend: " + e.message); }
  try { runNewProductLabelCalculation(); } catch(e) { Logger.log("Error in New Product: " + e.message); }
  try { runGoogleAdsLabelCalculation(); } catch(e) { Logger.log("Error in GAds: " + e.message); }
  
  Logger.log("--- All Tasks Completed ---");
  try { 
    updateDashboardStatus(ss, "Overview", "COMPLETED", "All labels calculated."); 
    appendToOverviewLog(ss, "Overview", "Label Calculations", "SUCCESS", "All labels calculated successfully.", "-", "-", "-");
  } catch(e) {}
}

function consolidateMetrics(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const shopifySheet = ss.getSheetByName(SHOPIFY_SHEET_NAME_SOURCE);
  const wooSheet = ss.getSheetByName(WOOCOMMERCE_SHEET_NAME_SOURCE);
  const gadsSheet = ss.getSheetByName(GADS_SHEET_NAME_SOURCE);
  
  const shopifyData = shopifySheet ? getShopifyData_(shopifySheet) : [];
  const wooData = wooSheet ? getWooData_(wooSheet) : [];
  const gadsMap = gadsSheet ? loadGAdsDataMap_(gadsSheet) : {};
  
  const sourceData = [...shopifyData, ...wooData];
  
  const combinedData = sourceData.map(item => {
    const safeId = String(item.id).toLowerCase();
    const gads = gadsMap[safeId] || { imp: 0, click: 0, cost: 0, conv: 0, val: 0 };
    return [
      item.id,
      item.title,
      item.dateCreated,
      item.price,
      item.revenue,
      item.revenue14,
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

  const metricsSheet = getOrCreateSheet(ss, METRICS_SHEET_NAME);
  metricsSheet.clearContents();
  
  metricsSheet.getRange(1, 1, 1, METRICS_HEADERS.length)
    .setValues([METRICS_HEADERS])
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  if (combinedData.length > 0) {
    writeValuesToSheetSafe(metricsSheet, 2, 1, combinedData);
    
    // Formatting
    metricsSheet.getRange(2, 4, combinedData.length, 3).setNumberFormat("#,##0.00"); 
    metricsSheet.getRange(2, 12, combinedData.length, 1).setNumberFormat("#,##0.00"); 
    metricsSheet.getRange(2, 14, combinedData.length, 1).setNumberFormat("#,##0.00"); 
    
    // --- Initialize GMC_Feed (primary: raw IDs) ---
    const labelsSheet = getOrCreateSheet(ss, LABELS_SHEET_NAME);
    labelsSheet.clear(); 
    labelsSheet.getRange(1, 1, 1, 1).setValues([["id"]]).setFontWeight("bold");
    const idColumnData = combinedData.map(row => [row[0]]);
    writeValuesToSheetSafe(labelsSheet, 2, 1, idColumnData);

    // --- Initialize GMC_Feed_2 (secondary: ID-modified, only created if prefix/suffix is configured) ---
    const prefix = AppConfig.IdPrefix || "";
    const suffix = AppConfig.IdSuffix || "";
    if (prefix || suffix) {
      const labelsSheet2 = getOrCreateSheet(ss, LABELS_SHEET_2_NAME);
      labelsSheet2.clear();
      labelsSheet2.getRange(1, 1, 1, 1).setValues([["id"]]).setFontWeight("bold");
      const idColumnData2 = combinedData.map(row => [prefix + String(row[0]) + suffix]);
      writeValuesToSheetSafe(labelsSheet2, 2, 1, idColumnData2);
      Logger.log(`GMC_Feed_2 generated with prefix="${prefix}" suffix="${suffix}"`);
    } else {
      Logger.log("GMC_Feed_2 skipped: ID_PREFIX and ID_SUFFIX are both empty in Config.gs.");
    }
  }
}

function getShopifyData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rawData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return rawData.map(row => ({
    id: row[0],
    title: row[3] + " - " + row[4],
    dateCreated: row[6],
    price: row[5],
    revenue: row[9],
    revenue14: row[10],
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
    dateCreated: row[4],
    price: row[3],
    revenue: row[7],
    revenue14: row[8],
    orders: row[5],
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
       map[String(id).toLowerCase()] = {
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
