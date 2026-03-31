/**
 * @file AdsScriptContent.gs
 * @description Stores the Google Ads Script content as a string for the Copy Modal.
 * This is the only way to "read" the script content at runtime in Apps Script.
 */

function getGoogleAdsScriptContent() {
  return `/**
 * @file GoogleAdsData.gs
 * @description This script is intended to be run within the Google Ads Scripts interface.
 * It fetches product-level performance data using GAQL and pushes raw metrics
 * to the "GAds" sheet in your Google Spreadsheet.
 * 
 * ⚠️ WARNING: This file belongs in Google Ads Scripts (ads.google.com → Tools → Scripts).
 * Do NOT paste it into the Google Sheets Script Editor — it will conflict with Config.gs.
 * 
 * NOTE: This script does NOT calculate labels. It only syncs data.
 * Label calculation is handled by the spreadsheet-bound script \`calculateGoogleAdsLabels.gs\`.
 */

// --- Configuration ---
// Please set the spreadsheet URL here manually.
const SPREADSHEET_URL = "${SpreadsheetApp.getActiveSpreadsheet().getUrl()}";
// How many days of data to fetch. Keep in sync with TIMEFRAME_DAYS in Config.gs.
const GADS_TIMEFRAME_DAYS = 30;
const GADS_SHEET_NAME = "GAds";

/**
 * Main function to run the Google Ads data sync.
 */
function main() {
  try {
    // 1. Build date range (set GADS_TIMEFRAME_DAYS above to match Config.gs)
    const dateRange = last_n_days(GADS_TIMEFRAME_DAYS);
    const dateRangeParts = dateRange.split(',');
    
    Logger.log(\`Running for the last \${GADS_TIMEFRAME_DAYS} days (\${dateRangeParts[0]} to \${dateRangeParts[1]}).\`);

    // 2. Fetch Report Data
    // We only need raw metrics here. Labels will be calculated in the sheet script.
    const query = \`
      SELECT
        segments.product_item_id,
        segments.product_title,
        segments.product_type_l1,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE metrics.impressions > 0
        AND segments.date BETWEEN '\${dateRangeParts[0]}' AND '\${dateRangeParts[1]}'
    \`;
    
    const report = AdsApp.report(query);
    const rows = [];
    const iterator = report.rows();
    while (iterator.hasNext()) {
      rows.push(iterator.next());
    }
    
    Logger.log(\`Fetched \${rows.length} rows from Google Ads.\`);

    // 3. Process Data (Aggregation)
    const { productData, totals } = aggregateProductDataAndTotals(rows);
    
    // 4. Push to Spreadsheet
    const headers = [
      "id", 
      "Title", 
      "Type L1", 
      "Impressions", 
      "Clicks", 
      "Cost", 
      "Conversions", 
      "Conv Value"
    ];
    
    pushToSpreadsheet(productData, GADS_SHEET_NAME, headers);

    // --- 5. Log to Overview ---
    const accountName = AdsApp.currentAccount().getName();

    const ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    
    updateDashboardMetrics(ss, "Overview", {
      kind: 'ads',
      rev: totals.convValue.toFixed(2),
      cost: totals.cost.toFixed(2),
      orders: Math.round(totals.conversions)
    });

    appendToOverviewLog(
      ss,
      "Overview",
      \`Google Ads - \${accountName}\`,
      "SUCCESS",
      \`Synced \${productData.length} active products\`,
      "-",
      totals.cost.toFixed(2),
      "-"
    );

    Logger.log("Data sync and logging completed successfully.");

  } catch (e) {
    Logger.log(\`Error in GoogleAdsData.gs: \${e.message}\`);
  }
}

function initializeOverviewDashboard_(sheet) {
  const topLeft = sheet.getRange("A1").getValue();
  if (topLeft === "LIVE SYSTEM STATUS") return;

  sheet.clear();
  
  sheet.getRange("A1:C1").merge().setValue("LIVE SYSTEM STATUS").setFontWeight("bold").setBackground("#f3f3f3");
  sheet.getRange("A2").setValue("Current Status:").setFontWeight("bold");
  sheet.getRange("B2").setValue("🟢 IDLE").setFontWeight("bold").setFontColor("#0f9d58");
  sheet.getRange("A3").setValue("Last Sync:").setFontWeight("bold");
  sheet.getRange("B3").setValue("-");

  sheet.getRange("A5:H5").merge().setValue("ACCOUNT TOTALS (LATEST SNAPSHOT)").setFontWeight("bold").setBackground("#e8eaed").setHorizontalAlignment("center");
  
  sheet.getRange("A6").setValue("Store Revenue:").setFontWeight("bold");
  sheet.getRange("A7").setValue("Store Orders:").setFontWeight("bold");
  sheet.getRange("A8").setValue("Active Products:").setFontWeight("bold");

  sheet.getRange("D6").setValue("Ads Revenue/Value:").setFontWeight("bold");
  sheet.getRange("D7").setValue("Ads Cost:").setFontWeight("bold");
  sheet.getRange("D8").setValue("Ads Conversions:").setFontWeight("bold");

  sheet.getRange("G6").setValue("OOS w/ Sales (#):").setFontWeight("bold");
  sheet.getRange("G7").setValue("OOS w/ Sales (%):").setFontWeight("bold");

  sheet.getRange("A11").setValue("EXECUTION LOG").setFontWeight("bold").setFontSize(12);
  const logHeaders = ["Timestamp", "Component", "Action / Status", "Details", "Store Rev", "Ads Cost", "OOS %"];
  sheet.getRange(12, 1, 1, logHeaders.length).setValues([logHeaders]).setFontWeight("bold").setBackground("#fce8e6").setHorizontalAlignment("center");
  
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 300);
}

function updateDashboardMetrics(spreadsheet, sheetName, totals) {
  const sheet = ensureSheetExists(spreadsheet, sheetName);
  initializeOverviewDashboard_(sheet);

  if (totals.kind === 'store') {
    sheet.getRange("B6").setValue(totals.rev);
    sheet.getRange("B7").setValue(totals.orders);
    if (totals.products !== undefined) sheet.getRange("B8").setValue(totals.products);
    sheet.getRange("H6").setValue(totals.oosCount);
    sheet.getRange("H7").setValue(totals.oosPercent);
  } else if (totals.kind === 'ads') {
    sheet.getRange("E6").setValue(totals.rev);
    sheet.getRange("E7").setValue(totals.cost);
    sheet.getRange("E8").setValue(totals.orders);
  }
}

function appendToOverviewLog(spreadsheet, sheetName, component, status, details, rev = "-", cost = "-", oos = "-") {
  const sheet = ensureSheetExists(spreadsheet, sheetName);
  initializeOverviewDashboard_(sheet);

  const now = new Date();
  const timestamp = Utilities.formatDate(now, AdsApp.currentAccount().getTimeZone(), "dd.MM.yyyy HH:mm");
  
  sheet.insertRowBefore(13);
  
  const rowData = [[timestamp, component, status, details, rev, cost, oos]];
  const range = sheet.getRange(13, 1, 1, 7);
  range.setValues(rowData).setFontWeight("normal").setBackground(null);
  
  if (status.includes("ERROR") || status.includes("FAIL")) range.setBackground("#fce8e6");
  else if (status.includes("SUCCESS") || status.includes("COMPLETED")) range.setBackground("#e6f4ea");

  if (sheet.getMaxRows() > 520) {
    if (sheet.getLastRow() > 512) {
      try { sheet.deleteRows(513, sheet.getLastRow() - 512); } catch(e) {}
    }
  }
}

function aggregateProductDataAndTotals(rows) {
  const prod = {};
  const totals = { cost: 0, conversions: 0, convValue: 0 };

  for (const row of rows) {
    const id = row['segments.product_item_id'];
    const cost = parseFloat(row['metrics.cost_micros'] || 0) / 1000000;
    const conv = parseFloat(row['metrics.conversions'] || 0);
    const val = parseFloat(row['metrics.conversions_value'] || 0);

    totals.cost += cost;
    totals.conversions += conv;
    totals.convValue += val;

    if (!prod[id]) {
      prod[id] = {
        id: id,
        title: row['segments.product_title'],
        typeL1: row['segments.product_type_l1'],
        impressions: 0,
        clicks: 0,
        cost: 0,
        conversions: 0,
        conversionValue: 0
      };
    }

    prod[id].impressions += parseFloat(row['metrics.impressions'] || 0);
    prod[id].clicks += parseFloat(row['metrics.clicks'] || 0);
    prod[id].cost += cost;
    prod[id].conversions += conv;
    prod[id].conversionValue += val;
  }

  const productData = Object.values(prod).map(p => [
    p.id, p.title, p.typeL1, p.impressions, p.clicks, p.cost.toFixed(2), p.conversions.toFixed(2), p.conversionValue.toFixed(2)
  ]);
  
  return { productData, totals };
}

function pushToSpreadsheet(data, sheetName, headers) {
  const spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  const sheet = ensureSheetExists(spreadsheet, sheetName);
  sheet.clearContents();
  if (headers) data.unshift(headers);
  if (data.length > 0) sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
}

function ensureSheetExists(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  return sheet;
}

function last_n_days(n) {
  const today = new Date();
  const endDate = Utilities.formatDate(today, AdsApp.currentAccount().getTimeZone(), "yyyyMMdd");
  const startDate = new Date();
  startDate.setDate(today.getDate() - n);
  const formattedStartDate = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), "yyyyMMdd");
  return \`\${formattedStartDate},\${endDate}\`;
}
\`;
}
