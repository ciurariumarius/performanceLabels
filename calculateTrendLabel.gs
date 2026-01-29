/**
 * @file calculateTrendLabel.gs
 * @description Calculates a sales trend label ("LABEL_TREND") by comparing the average daily revenue
 * of the last 14 days against the average daily revenue from the period before that.
 * The script is optimized for background execution and uses CommonUtilities.gs.
 *
 * Changelog (v2.1 - Unique Constants):
 * - Renamed script-level constants to be unique across the project to prevent "Identifier has already been declared" errors.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Added a main try-catch block for robust error handling.
 * - Encapsulated trend logic and data parsing into dedicated helper functions.
 */

// --- Script-level Constants (with unique names) ---
const TREND_CONFIG_SHEET_NAME = "Config";
const TREND_METRICS_SHEET_NAME = "Metrics";
const TREND_HEADER_ROW_NUM = 1;

// --- Column Headers (with unique names) ---
const TREND_ID_INPUT_HEADER = "id";
const TREND_TOTAL_REVENUE_HEADER = "Total Revenue";
const TREND_14_DAY_REVENUE_HEADER = "Revenue last 14 days";
const TREND_ORDERS_INPUT_HEADER = "Total Orders";
const TREND_OUTPUT_LABEL_HEADER = "LABEL_TREND";

// --- Trend Threshold Configuration ---
const TREND_THRESHOLD_PERCENT = 0.20; // 20%

/**
 * Main orchestrator function to run the trend label calculation.
 */
function runTrendLabelCalculation() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(TREND_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Sheet "${TREND_CONFIG_SHEET_NAME}" not found.`);
    }
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const timeframeDays = getConfigValue(SCRIPT_CONFIGS, "Timeframe", 'int', 30);
    const orderThreshold = getConfigValue(SCRIPT_CONFIGS, "Nr. of Orders Threshold", 'int', 0);

    if (timeframeDays <= 0) {
      throw new Error(`Configuration "Timeframe" must be a positive number in '${TREND_CONFIG_SHEET_NAME}'.`);
    }
    Logger.log(`Trend Label Config: Timeframe ${timeframeDays} days, Order Threshold ${orderThreshold}.`);

    // --- 2. Read Data and Validate Setup ---
    const metricsSheet = spreadsheet.getSheetByName(TREND_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${TREND_METRICS_SHEET_NAME}" not found.`);
    }

    const lastRow = metricsSheet.getLastRow();
    if (lastRow < TREND_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${TREND_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }

    const headers = metricsSheet.getRange(TREND_HEADER_ROW_NUM, 1, 1, metricsSheet.getLastColumn()).getValues()[0];
    const columnIndices = getTrendColumnIndices_(headers);
    
    const numDataRows = lastRow - TREND_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }
    const data = metricsSheet.getRange(TREND_HEADER_ROW_NUM + 1, 1, numDataRows, headers.length).getValues();

    // --- 3. Generate Labels ---
    const labels = generateTrendLabels_(data, columnIndices, timeframeDays, orderThreshold);

    // --- 4. Write Results to Sheet ---
    writeTrendLabelsToSheet_(metricsSheet, labels);

    Logger.log("Trend label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runTrendLabelCalculation: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getTrendColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(TREND_ID_INPUT_HEADER),
    totalRevenue: headers.indexOf(TREND_TOTAL_REVENUE_HEADER),
    revenue14Days: headers.indexOf(TREND_14_DAY_REVENUE_HEADER),
    totalOrders: headers.indexOf(TREND_ORDERS_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found in "${TREND_METRICS_SHEET_NAME}": ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Iterates through data and generates a trend label for each row.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {number} timeframeDays The total configured timeframe.
 * @param {number} orderThreshold The configured order threshold.
 * @return {Array<Array<string>>} A 2D array of labels, one for each row.
 */
function generateTrendLabels_(data, columnIndices, timeframeDays, orderThreshold) {
  return data.map(row => {
    if (!row[columnIndices.id]) {
      return [""]; // Return blank for rows without an ID
    }

    // Assumes CommonUtilities.gs safe parsing functions are available
    const totalRevenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    const revenue14Days = parseFloatSafe(row[columnIndices.revenue14Days], 0.0);
    const totalOrders = parseIntSafe(row[columnIndices.totalOrders], 0);

    const potentialTrend = determinePotentialTrend_(totalRevenue, revenue14Days, timeframeDays);
    const finalLabel = applyOrderThresholdToTrend_(potentialTrend, totalOrders, orderThreshold);

    return [finalLabel];
  });
}

/**
 * Determines the potential trend (up, down, stable) based on revenue comparison.
 * @private
 * @param {number} totalRevenue The total revenue over the full timeframe.
 * @param {number} revenue14Days The revenue from the last 14 days.
 * @param {number} timeframeDays The total configured timeframe.
 * @return {string} The calculated potential trend label.
 */
function determinePotentialTrend_(totalRevenue, revenue14Days, timeframeDays) {
  const daysForOlderPeriod = timeframeDays - 14;

  if (daysForOlderPeriod <= 0) {
    return revenue14Days > 0 ? "recent_activity_only" : "no_trend";
  }

  const revenueForOlderPeriod = totalRevenue - revenue14Days;
  if (revenueForOlderPeriod < 0) {
    // This indicates a data inconsistency but we handle it gracefully.
    return "no_trend";
  }

  const avgDailyRevenue14Days = revenue14Days / 14;
  const avgDailyRevenueOlderPeriod = revenueForOlderPeriod / daysForOlderPeriod;

  if (avgDailyRevenueOlderPeriod > 0) {
    const ratio = avgDailyRevenue14Days / avgDailyRevenueOlderPeriod;
    if (ratio > (1 + TREND_THRESHOLD_PERCENT)) return "up_trend";
    if (ratio < (1 - TREND_THRESHOLD_PERCENT)) return "down_trend";
    return "stable_trend";
  }

  // Handle cases where there was no revenue in the older period
  if (avgDailyRevenue14Days > 0) {
    return "up_trend";
  }
  
  return "no_trend"; // If both periods have no revenue
}

/**
 * Adjusts a potential trend label based on the order threshold.
 * @private
 * @param {string} potentialTrend The trend determined by revenue ('up_trend' or 'down_trend').
 * @param {number} totalOrders The number of orders for the product.
 * @param {number} orderThreshold The configured order threshold.
 * @return {string} The final trend label.
 */
function applyOrderThresholdToTrend_(potentialTrend, totalOrders, orderThreshold) {
  if (potentialTrend === "up_trend" || potentialTrend === "down_trend") {
    // A trend is only confirmed if the product meets the order threshold.
    if (totalOrders >= orderThreshold) {
      return potentialTrend;
    } else {
      return "stable_trend"; // Not enough orders to confirm the trend, so it's considered stable.
    }
  }
  // For other potential trends ("stable_trend", "no_trend", etc.), just return them as is.
  return potentialTrend;
}

/**
 * Writes the generated labels back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} labels The 2D array of labels to write.
 */
function writeTrendLabelsToSheet_(sheet, labels) {
  if (labels.length === 0) {
    Logger.log("No labels were generated to write.");
    return;
  }
  
  // Assumes CommonUtilities.gs findOrCreateHeaderColumn is available
  const outputCol = findOrCreateHeaderColumn(sheet, TREND_OUTPUT_LABEL_HEADER, TREND_HEADER_ROW_NUM);

  const range = sheet.getRange(TREND_HEADER_ROW_NUM + 1, outputCol, labels.length, 1);
  range.clearContent();
  range.setValues(labels);
  
  Logger.log(`Wrote ${labels.length} trend labels to the sheet.`);
}
