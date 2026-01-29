/**
 * @file GoogleAdsData.gs
 * @description This script is intended to be run within the Google Ads Scripts interface.
 * It fetches product-level performance data using GAQL and pushes raw metrics
 * to the "GAds" sheet in your Google Spreadsheet.
 * 
 * NOTE: This script does NOT calculate labels. It only syncs data.
 * Label calculation is handled by the spreadsheet-bound script `calculateGoogleAdsLabels.gs`.
 */

// --- Configuration ---
// Please set the spreadsheet URL here manually.
const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1HO82WNMbtO6-_UYqSOsBjF-s3WYNdW5bhyGAZUW3S2E/edit?gid=0#gid=0";
const CONFIG_SHEET_NAME = "Config";
const GADS_SHEET_NAME = "GAds";

/**
 * Main function to run the Google Ads data sync.
 */
function main() {
  try {
    // 1. Load Configuration (Timeframe) from Sheet
    const config = fetchTimeframeConfig();
    const dateRange = last_n_days(config.DAYS);
    const dateRangeParts = dateRange.split(',');
    
    Logger.log(`Running for the last ${config.DAYS} days (${dateRangeParts[0]} to ${dateRangeParts[1]}).`);

    // 2. Fetch Report Data
    // We only need raw metrics here. Labels will be calculated in the sheet script.
    const query = `
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
        AND segments.date BETWEEN '${dateRangeParts[0]}' AND '${dateRangeParts[1]}'
    `;
    
    const report = AdsApp.report(query);
    const rows = [];
    const iterator = report.rows();
    while (iterator.hasNext()) {
      rows.push(iterator.next());
    }
    
    Logger.log(`Fetched ${rows.length} rows from Google Ads.`);

    // 3. Process Data (Aggregation)
    // We calculate account totals simultaneously to avoid re-parsing formatted strings later
    const { productData, totals } = aggregateProductDataAndTotals(rows);
    
    // 4. Push to Spreadsheet
    // Headers: id, Title, Type L1, Impressions, Clicks, Cost, Conversions, Conv Value
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

    // --- 5. Log to AccountData ---
    const accountName = AdsApp.currentAccount().getName();

    upsertAccountDataRow(SpreadsheetApp.openByUrl(SPREADSHEET_URL), "AccountData", {
      source: `Google Ads - ${accountName}`,
      timeframe: `Last ${config.DAYS} Days`,
      revenue: totals.convValue.toFixed(2), // Revenue = Conversion Value
      cost: totals.cost.toFixed(2),
      orders: Math.round(totals.conversions), // Orders = Conversions
      oosCount: "-", // Not tracked in GAds
      oosPercent: "-"
    });

    Logger.log("Data sync and logging completed successfully.");

  } catch (e) {
    Logger.log(`Error in GoogleAdsData.gs: ${e.message}`);
  }
}

/**
 * Updates a row in the AccountData sheet based on the Source Name (Column B).
 * If the source exists, it overwrites the row. If not, it appends a new row.
 */
function upsertAccountDataRow(spreadsheet, sheetName, data) {
  const sheet = ensureSheetExists(spreadsheet, sheetName);
  
  // Headers
  const headers = ["Timestamp", "Source", "Timeframe", "Revenue", "Cost", "Orders", "OOS w/ Sales (#)", "OOS w/ Sales (%)"];
  
  // Robust Header Check
  let headerCheck = "";
  if (sheet.getLastRow() > 0) headerCheck = sheet.getRange(1, 1).getValue();
  
  if (headerCheck !== headers[0] || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center");
  }
  
  const lastRow = sheet.getLastRow();
  let targetRow = -1;
  
  // Search for existing source in Column B (Index 1)
  if (lastRow > 1) {
    const sourceColumn = sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat(); // Get all sources
    const rowIndex = sourceColumn.indexOf(data.source);
    if (rowIndex !== -1) {
      targetRow = rowIndex + 2; // +2 because 0-index + 1 header + 1 for 1-based index
    }
  }
  
  // formatted date
  const now = new Date();
  const timestamp = Utilities.formatDate(now, AdsApp.currentAccount().getTimeZone(), "dd.MM.yyyy HH:mm");

  // Prepare row data
  const rowData = [
    timestamp,
    data.source,
    data.timeframe,
    data.revenue,
    data.cost !== undefined ? data.cost : "-",
    data.orders,
    data.oosCount !== undefined ? data.oosCount : "-",
    data.oosPercent !== undefined ? data.oosPercent : "-"
  ];
  
  if (targetRow !== -1) {
    // update existing
    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // append new
    sheet.appendRow(rowData);
  }
}

/**
 * Aggregates raw data by product ID.
 * @param {Array<Object>} rows - GAQL result rows.
 * @returns {Array<Array<any>>} - Aggregated data for the sheet.
 */
/**
 * Aggregates raw data by product ID and calculates global totals.
 * @param {Array<Object>} rows - GAQL result rows.
 * @returns {Object} - { productData: Array, totals: Object }
 */
function aggregateProductDataAndTotals(rows) {
  const prod = {};
  const totals = {
    cost: 0,
    conversions: 0,
    convValue: 0
  };

  for (const row of rows) {
    const id = row['segments.product_item_id'];
    
    // Parse metrics safely
    const cost = parseFloat(row['metrics.cost_micros'] || 0) / 1000000;
    const conv = parseFloat(row['metrics.conversions'] || 0);
    const val = parseFloat(row['metrics.conversions_value'] || 0);

    // Update Totals
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

  // Convert object to array for sheet
  const productData = Object.values(prod).map(p => [
    p.id,
    p.title,
    p.typeL1,
    p.impressions,
    p.clicks,
    p.cost.toFixed(2),
    p.conversions.toFixed(2),
    p.conversionValue.toFixed(2)
  ]);
  
  return { productData, totals };
}

/**
 * Fetches the 'DAYS' configuration from the Config sheet.
 */
function fetchTimeframeConfig() {
  const spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  const sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${CONFIG_SHEET_NAME}" not found.`);

  const daysValue = sheet.getRange("B5").getValue();
  const days = parseInt(daysValue, 10);
  
  if (isNaN(days)) {
    throw new Error("Invalid 'DAYS' value in Config sheet (Cell B5).");
  }

  return { DAYS: days };
}

/**
 * Pushes data to the specified sheet using batch operations.
 * Auto-creates the sheet if it does not exist.
 */
function pushToSpreadsheet(data, sheetName, headers) {
  const spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  const sheet = ensureSheetExists(spreadsheet, sheetName);

  sheet.clearContents();

  if (headers) {
    data.unshift(headers);
  }

  if (data.length > 0) {
    sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
}

/**
 * Ensures that a sheet with the given name exists in the spreadsheet.
 * If not, it creates it.
 */
function ensureSheetExists(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    Logger.log(`Sheet "${sheetName}" created.`);
  }
  return sheet;
}

/**
 * Helper: Calculate last N days date range.
 */
function last_n_days(n) {
  const today = new Date();
  const endDate = Utilities.formatDate(today, AdsApp.currentAccount().getTimeZone(), "yyyyMMdd");
  const startDate = new Date();
  startDate.setDate(today.getDate() - n);
  const formattedStartDate = Utilities.formatDate(startDate, AdsApp.currentAccount().getTimeZone(), "yyyyMMdd");
  return `${formattedStartDate},${endDate}`;
}


