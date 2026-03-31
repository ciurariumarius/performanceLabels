/**
 * @file calculateGoogleAdsLabels.gs
 * @description Calculates performance labels for Google Ads data.
 * Reads raw metrics from the "Metrics" sheet and applies logic (ROAS, CVR, Clicks)
 * based on thresholds configured in Config.gs.
 */

// --- Constants ---
const GADS_DATA_SHEET_NAME = "Metrics";
const GADS_LABELS_SHEET_NAME = "GMC_Feed";
const GADS_HEADER_ROW_NUM = 1;

// Thresholds
const MIN_CLICKS_THRESHOLD = 10;

// Output Headers
const HEADER_LABEL_ROAS = "LABEL_GADS_ROAS";
const HEADER_LABEL_CVR = "LABEL_GADS_CONV_RATE";
const HEADER_LABEL_CLICKS = "LABEL_GADS_CLICKS";

/**
 * Main orchestrator function to run Google Ads label calculations.
 */
function runGoogleAdsLabelCalculation() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Load Configuration from AppConfig (via CommonUtilities)
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(null);

    const config = {
      roasGood:   getConfigValue(SCRIPT_CONFIGS, "ROAS Good",            'float', 4.0),
      roasBad:    getConfigValue(SCRIPT_CONFIGS, "ROAS Bad",             'float', 2.0),
      cvrGood:    getConfigValue(SCRIPT_CONFIGS, "Conversion Rate Good", 'float', 1.5),
      cvrBad:     getConfigValue(SCRIPT_CONFIGS, "Conversion Rate Bad",  'float', 0.5),
      clicksHigh: getConfigValue(SCRIPT_CONFIGS, "Clicks High",          'float', 100),
      clicksLow:  getConfigValue(SCRIPT_CONFIGS, "Clicks Low",           'float', 20)
    };
    Logger.log("Loaded Google Ads Config: " + JSON.stringify(config));

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

  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, roasCol,    labels.map(r => [r[0]]));
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, cvrCol,     labels.map(r => [r[1]]));
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, clicksCol,  labels.map(r => [r[2]]));
}
