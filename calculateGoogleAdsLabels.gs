/**
 * @file calculateGoogleAdsLabels.gs
 * @description Calculates performance labels for Google Ads data.
 * Reads raw metrics from the "GAds" sheet (synced by the external Google Ads script)
 * and applies logic (ROAS, CVR, Clicks) based on thresholds in the "Config" sheet.
 */

// --- Constants ---
const GADS_CONFIG_SHEET_NAME = "Config";
const GADS_DATA_SHEET_NAME = "Metrics"; // The sheet where raw data lands
const GADS_LABELS_SHEET_NAME = "Labels Feed";
const GADS_HEADER_ROW_NUM = 1;

// Thresholds
const MIN_CLICKS_THRESHOLD = 10;

// Output Headers
const HEADER_LABEL_ROAS = "label_roas";
const HEADER_LABEL_CVR = "label_cvr";
const HEADER_LABEL_CLICKS = "label_clicks";

/**
 * Main orchestrator function to run Google Ads label calculations.
 */
function runGoogleAdsLabelCalculation() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Load Configuration
    const configSheet = spreadsheet.getSheetByName(GADS_CONFIG_SHEET_NAME);
    if (!configSheet) throw new Error(`Sheet "${GADS_CONFIG_SHEET_NAME}" not found.`);
    
    // Load full Key-Value pairs for dynamic headers
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);

    // Keep existing threshold loading logic (specific cells)
    const config = {
      roasGood: parseFloatSafe(configSheet.getRange("B6").getValue(), 4.0),
      roasBad: parseFloatSafe(configSheet.getRange("B7").getValue(), 2.0),
      cvrGood: parseFloatSafe(configSheet.getRange("B8").getValue(), 1.5),
      cvrBad: parseFloatSafe(configSheet.getRange("B9").getValue(), 0.5),
      clicksHigh: parseFloatSafe(configSheet.getRange("B10").getValue(), 100),
      clicksLow: parseFloatSafe(configSheet.getRange("B11").getValue(), 20)
    };
    
    Logger.log("Loaded Google Ads Config:", config);

    // 2. Read Data
    const dataSheet = spreadsheet.getSheetByName(GADS_DATA_SHEET_NAME);
    if (!dataSheet) throw new Error(`Sheet "${GADS_DATA_SHEET_NAME}" not found.`);

    const lastRow = dataSheet.getLastRow();
    if (lastRow <= GADS_HEADER_ROW_NUM) {
      Logger.log("No data found in GAds sheet.");
      return;
    }

    const headers = dataSheet.getRange(GADS_HEADER_ROW_NUM, 1, 1, dataSheet.getLastColumn()).getValues()[0];
    const indices = getGAdsColumnIndices_(headers);
    const dataRange = dataSheet.getRange(GADS_HEADER_ROW_NUM + 1, 1, lastRow - GADS_HEADER_ROW_NUM, headers.length);
    const data = dataRange.getValues();

    // 3. Process & Generate Labels
    const labels = data.map(row => calculateRowLabels_(row, indices, config));

    // 4. Write Labels to Labels Feed Sheet
    const labelsSheet = getOrCreateSheet(spreadsheet, GADS_LABELS_SHEET_NAME);
    writeGAdsLabelsToSheet_(labelsSheet, labels, SCRIPT_CONFIGS);
    Logger.log("Google Ads label calculation completed.");

  } catch (e) {
    Logger.log(`Error in runGoogleAdsLabelCalculation: ${e.message}`);
  }
}

/**
 * Helper to get column indices for raw metrics.
 */
function getGAdsColumnIndices_(headers) {
  // Headers in Metrics Sheet: 
  // "id", "Title", "Price", "Revenue", "Orders", "Stock Status", "Stock Qty", 
  // "Impressions", "Clicks", "Cost", "Conversions", "Conv Value", "Calculated On"
  return {
    clicks: headers.indexOf("Clicks"),
    impressions: headers.indexOf("Impressions"),
    cost: headers.indexOf("Cost"),
    conversions: headers.indexOf("Conversions"),
    conversionValue: headers.indexOf("Conv Value")
  };
}

/**
 * Calculates labels for a single row of data.
 */
function calculateRowLabels_(row, indices, config) {
  const clicks = parseFloatSafe(row[indices.clicks], 0);
  const cost = parseFloatSafe(row[indices.cost], 0);
  const conversions = parseFloatSafe(row[indices.conversions], 0);
  const conversionValue = parseFloatSafe(row[indices.conversionValue], 0);
  const impressions = parseFloatSafe(row[indices.impressions], 0);

  // Derived Metrics
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cvr = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const roas = cost > 0 ? conversionValue / cost : 0;

  // 1. ROAS Label
  let labelRoas = "avg_roas";
  if (conversionValue === 0) {
    labelRoas = "no_roas";
  } else if (clicks >= MIN_CLICKS_THRESHOLD) {
    if (roas >= config.roasGood) labelRoas = "high_roas";
    else if (roas < config.roasBad) labelRoas = "low_roas";
  }

  // 2. CVR Label
  let labelCvr = "avg_cvr";
  if (conversions === 0) {
    labelCvr = "no_cvr";
  } else if (clicks >= MIN_CLICKS_THRESHOLD) {
    if (conversions >= 1 && cvr >= config.cvrGood) labelCvr = "high_cvr";
    else if (cvr < config.cvrBad) labelCvr = "low_cvr";
  }

  // 3. Clicks Label
  let labelClicks = "avg_clicks";
  if (clicks === 0) labelClicks = "no_clicks";
  else if (clicks >= config.clicksHigh) labelClicks = "high_clicks";
  else if (clicks < config.clicksLow) labelClicks = "low_clicks";

  return [labelRoas, labelCvr, labelClicks];
}

/**
 * Writes the calculated labels back to the sheet.
 */
function writeGAdsLabelsToSheet_(sheet, labels, config = {}) {
  // Resolve Dynamic Header Names
  const roasHeader = getConfigValue(config, HEADER_LABEL_ROAS, 'string', HEADER_LABEL_ROAS);
  const cvrHeader = getConfigValue(config, HEADER_LABEL_CVR, 'string', HEADER_LABEL_CVR);
  const clicksHeader = getConfigValue(config, HEADER_LABEL_CLICKS, 'string', HEADER_LABEL_CLICKS);
  
  Logger.log(`Writing GAds Labels using headers: ${roasHeader}, ${cvrHeader}, ${clicksHeader}`);

  const roasCol = findOrCreateHeaderColumn(sheet, roasHeader, GADS_HEADER_ROW_NUM);
  const cvrCol = findOrCreateHeaderColumn(sheet, cvrHeader, GADS_HEADER_ROW_NUM);
  const clicksCol = findOrCreateHeaderColumn(sheet, clicksHeader, GADS_HEADER_ROW_NUM);

  const numRows = labels.length;
  // Write column by column safely
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, roasCol, labels.map(r => [r[0]]));
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, cvrCol, labels.map(r => [r[1]]));
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, clicksCol, labels.map(r => [r[2]]));
}
