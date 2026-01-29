/**
 * @file runAllLabelCalculations.gs
 * @description Main orchestrator script to run all individual label calculation functions sequentially.
 * This provides a single entry point for a trigger to update all labels in the "Metrics" sheet.
 * It now INCLUDES the data consolidation logic to merge platform data + Google Ads data first.
 */

const METRICS_SHEET_NAME = "Metrics";
const LABELS_SHEET_NAME = "Labels Feed"; // NEW: Dedicated sheet for labels
const GADS_SHEET_NAME_SOURCE = "GAds";
const SHOPIFY_SHEET_NAME_SOURCE = "Shopify";
const WOOCOMMERCE_SHEET_NAME_SOURCE = "WooCommerce";

const METRICS_HEADERS = [
  "id", "Title", "Date Created", "Price", "Revenue", "Revenue last 14 days", "Orders", "Stock Status", "Stock Qty", // eCommerce
  "Impressions", "Clicks", "Cost", "Conversions", "Conv Value", // GAds
  "Calculated On" // Metadata
];


function runAllLabelCalculations() {
  // ... (Header logic unchanged) ...
}

// ... consolidateMetrics function body ...
  // 3. Merge Data
  const combinedData = sourceData.map(item => {
    const gads = gadsMap[item.id] || { imp: 0, click: 0, cost: 0, conv: 0, val: 0 };
    
    return [
      item.id,
      item.title,
      item.dateCreated, // NEW
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
    metricsSheet.getRange(2, 4, combinedData.length, 3).setNumberFormat("#,##0.00"); // Price, Rev, Rev14 (Col 4,5,6 now)
    metricsSheet.getRange(2, 12, combinedData.length, 1).setNumberFormat("#,##0.00"); // Cost (Shifted +1)
    metricsSheet.getRange(2, 14, combinedData.length, 1).setNumberFormat("#,##0.00"); // Conv Value (Shifted +1)
    
    // 5. Initialize Labels Feed Sheet (Sync IDs)
    labelsSheet.clear(); 
    const labelsHeader = ["id"]; 
    labelsSheet.getRange(1, 1, 1, 1).setValues([labelsHeader]).setFontWeight("bold");
    
    const idColumnData = combinedData.map(row => [row[0]]);
    writeValuesToSheetSafe(labelsSheet, 2, 1, idColumnData);
    Logger.log("Initialized 'Labels Feed' sheet with IDs.");
  }
  
  Logger.log("Consolidation Complete.");
}

// --- Helpers ---

function getShopifyData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const rawData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  
  return rawData.map(row => ({
    id: row[0],
    title: row[3] + " - " + row[4],
    dateCreated: row[6], // Index 6 = Column 7 ("Date Created")
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
    dateCreated: row[4], // Index 4 = Column 5 ("Date Created")
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
