/**
 * @file calculateGoogleAdsLabels.gs
 * @description Calculates performance labels for Google Ads data.
 * Reads raw metrics from the "GAds" sheet (synced by the external Google Ads script)
 * and applies logic (ROAS, CVR, Clicks) based on thresholds in the "Config" sheet.
 */

// --- Constants ---
const GADS_CONFIG_SHEET_NAME = "Config";
const GADS_DATA_SHEET_NAME = "GAds"; // The sheet where raw data lands
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
    
    // We use the helper directly or load specific cells if CommonUtilities layout differs.
    // Assuming the layout from your previous code snippet:
    // B6: ROAS_GOOD, B7: ROAS_BAD, B8: CVR_GOOD, B9: CVR_BAD, B10: CLICKS_HIGH, B11: CLICKS_LOW
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

    // 4. Write Labels
    writeGAdsLabelsToSheet_(dataSheet, labels);
    Logger.log("Google Ads label calculation completed.");

  } catch (e) {
    Logger.log(`Error in runGoogleAdsLabelCalculation: ${e.message}`);
  }
}

/**
 * Helper to get column indices for raw metrics.
 */
function getGAdsColumnIndices_(headers) {
  // Headers pushed by GoogleAdsData.gs: ["id", "Title", "Type L1", "Impressions", "Clicks", "Cost", "Conversions", "Conv Value"]
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
  if (clicks >= MIN_CLICKS_THRESHOLD) {
    if (roas >= config.roasGood) labelRoas = "high_roas";
    else if (roas < config.roasBad) labelRoas = "low_roas";
  }

  // 2. CVR Label
  let labelCvr = "avg_cvr";
  if (clicks >= MIN_CLICKS_THRESHOLD) {
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
function writeGAdsLabelsToSheet_(sheet, labels) {
  const roasCol = findOrCreateHeaderColumn(sheet, HEADER_LABEL_ROAS, GADS_HEADER_ROW_NUM);
  const cvrCol = findOrCreateHeaderColumn(sheet, HEADER_LABEL_CVR, GADS_HEADER_ROW_NUM);
  const clicksCol = findOrCreateHeaderColumn(sheet, HEADER_LABEL_CLICKS, GADS_HEADER_ROW_NUM);

  const numRows = labels.length;
  // Write column by column
  // Write column by column safely
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, roasCol, labels.map(r => [r[0]]));
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, cvrCol, labels.map(r => [r[1]]));
  writeValuesToSheetSafe(sheet, GADS_HEADER_ROW_NUM + 1, clicksCol, labels.map(r => [r[2]]));
}
