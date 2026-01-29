/**
 * @file calculateRevenueLabel.gs
 * @description Calculates and applies two revenue-based labels to the "Metrics" sheet:
 * 1. LABEL_REVENUE_ADVANCED: Compares product revenue to the account average (low/avg/high).
 * 2. LABEL_REVENUE_SIMPLE: Indicates if a product has any revenue (has_revenue/no_revenue).
 * The script is optimized for background execution and uses CommonUtilities.gs.
 *
 * Changelog (v2.1 - Unique Constants):
 * - Renamed script-level constants to be unique across the project to prevent "Identifier has already been declared" errors.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Centralized configuration loading and data validation.
 * - Encapsulated the two-pass logic (average calculation and label generation) into dedicated functions.
 * - Relies on CommonUtilities.gs for config loading, sheet management, and safe data parsing.
 */

// --- Script-level Constants (with unique names) ---
const REVENUE_CONFIG_SHEET_NAME = "Config";
const REVENUE_METRICS_SHEET_NAME = "Metrics";
const REVENUE_LABELS_SHEET_NAME = "Labels Feed";
const REVENUE_HEADER_ROW_NUM = 1;

// --- Column Headers (with unique names) ---
const REVENUE_ID_INPUT_HEADER = "id";
const REVENUE_TOTAL_INPUT_HEADER = "Revenue";
const REVENUE_ADVANCED_OUTPUT_HEADER = "LABEL_REVENUE_ADVANCED";
const REVENUE_SIMPLE_OUTPUT_HEADER = "LABEL_REVENUE_SIMPLE";

/**
 * Main orchestrator function to run the revenue label calculation.
 */
function runRevenueLabels() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(REVENUE_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Sheet "${REVENUE_CONFIG_SHEET_NAME}" not found.`);
    }
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const config = {
      lowThreshold: getConfigValue(SCRIPT_CONFIGS, "Low Revenue Threshold", 'float', 50.0) / 100,
      highThreshold: getConfigValue(SCRIPT_CONFIGS, "High Revenue Threshold", 'float', 150.0) / 100,
    };
    Logger.log(`Revenue Label Config: Low Threshold ${config.lowThreshold * 100}%, High Threshold ${config.highThreshold * 100}%.`);

    // --- 2. Read Data and Validate Setup ---
    const metricsSheet = spreadsheet.getSheetByName(REVENUE_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${REVENUE_METRICS_SHEET_NAME}" not found.`);
    }

    const lastRow = metricsSheet.getLastRow();
    if (lastRow < REVENUE_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${REVENUE_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }

    const headers = metricsSheet.getRange(REVENUE_HEADER_ROW_NUM, 1, 1, metricsSheet.getLastColumn()).getValues()[0];
    const columnIndices = getRevenueColumnIndices_(headers);
    
    const numDataRows = lastRow - REVENUE_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }
    const data = metricsSheet.getRange(REVENUE_HEADER_ROW_NUM + 1, 1, numDataRows, headers.length).getValues();

    // --- 3. Calculate Account Average Revenue (First Pass) ---
    const accountAverageRevenue = calculateAccountAverageRevenue_(data, columnIndices);
    Logger.log(`Calculated Account Average Revenue: ${accountAverageRevenue.toFixed(2)}.`);

    // --- 4. Generate Labels (Second Pass) ---
    const labels = generateRevenueLabels_(data, columnIndices, config, accountAverageRevenue);

    // --- 5. Write Results to LABELS FEED Sheet ---
    const labelsSheet = getOrCreateSheet(spreadsheet, REVENUE_LABELS_SHEET_NAME);
    writeRevenueLabelsToSheet_(labelsSheet, labels, SCRIPT_CONFIGS);

    Logger.log("Revenue label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runRevenueLabels: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getRevenueColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(REVENUE_ID_INPUT_HEADER),
    totalRevenue: headers.indexOf(REVENUE_TOTAL_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found in "${REVENUE_METRICS_SHEET_NAME}": ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * First pass: Calculates the account-wide average revenue for products that have revenue.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @return {number} The calculated average revenue.
 */
function calculateAccountAverageRevenue_(data, columnIndices) {
  let totalRevenueSum = 0;
  let itemsWithRevenueCount = 0;

  data.forEach(row => {
    if (row[columnIndices.id]) { // Only consider rows with an ID
      // Assumes CommonUtilities.gs parseFloatSafe is available
      const revenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
      if (revenue > 0) {
        totalRevenueSum += revenue;
        itemsWithRevenueCount++;
      }
    }
  });

  return itemsWithRevenueCount > 0 ? totalRevenueSum / itemsWithRevenueCount : 0;
}

/**
 * Second pass: Iterates through data and generates the advanced and simple revenue labels.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {object} config The configuration object with thresholds.
 * @param {number} accountAverageRevenue The account-wide average revenue.
 * @return {Array<Array<string>>} A 2D array of [advancedLabel, simpleLabel] for each row.
 */
function generateRevenueLabels_(data, columnIndices, config, accountAverageRevenue) {
  return data.map(row => {
    if (!row[columnIndices.id]) {
      return ["", ""]; // Return blanks for rows without an ID
    }

    const revenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    
    // Determine Simple Label
    const simpleLabel = revenue > 0 ? "has_revenue" : "no_revenue";
    
    // Determine Advanced Label
    const advancedLabel = determineAdvancedRevenueLabel_(revenue, accountAverageRevenue, config);
    
    return [advancedLabel, simpleLabel];
  });
}

/**
 * Determines the advanced revenue label (low/avg/high) for a single product.
 * @private
 * @param {number} revenue The revenue of the product.
 * @param {number} accountAverage The account's average revenue per product.
 * @param {object} config The configuration object with thresholds.
 * @return {string} The calculated advanced revenue label.
 */
function determineAdvancedRevenueLabel_(revenue, accountAverage, config) {
  if (revenue <= 0) {
    return "no_revenue";
  }
  if (accountAverage <= 0) {
    return "avg_revenue";
  }

  if (revenue < accountAverage * config.lowThreshold) {
    return "low_revenue";
  }
  if (revenue >= accountAverage * config.highThreshold) {
    return "high_revenue";
  }
  
  return "avg_revenue";
}

/**
 * Writes the generated labels back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} labels The 2D array of labels to write.
 */
function writeRevenueLabelsToSheet_(sheet, labels, config = {}) {
  if (labels.length === 0) {
    Logger.log("No labels were generated to write.");
    return;
  }
  
  // Resolve Dynamic Header Names
  const advancedHeaderName = getConfigValue(config, REVENUE_ADVANCED_OUTPUT_HEADER, 'string', REVENUE_ADVANCED_OUTPUT_HEADER);
  const simpleHeaderName = getConfigValue(config, REVENUE_SIMPLE_OUTPUT_HEADER, 'string', REVENUE_SIMPLE_OUTPUT_HEADER);
  
  Logger.log(`Writing Labels using headers: Advanced="${advancedHeaderName}", Simple="${simpleHeaderName}"`);

  const advancedCol = findOrCreateHeaderColumn(sheet, advancedHeaderName, REVENUE_HEADER_ROW_NUM);
  const simpleCol = findOrCreateHeaderColumn(sheet, simpleHeaderName, REVENUE_HEADER_ROW_NUM);

  const advancedLabels = labels.map(row => [row[0]]);
  const simpleLabels = labels.map(row => [row[1]]);

  // Write Advanced Labels in chunks
  writeValuesToSheetSafe(sheet, REVENUE_HEADER_ROW_NUM + 1, advancedCol, advancedLabels);
  
  // Write Simple Labels in chunks
  writeValuesToSheetSafe(sheet, REVENUE_HEADER_ROW_NUM + 1, simpleCol, simpleLabels);
  
  Logger.log(`Wrote ${labels.length} revenue labels to the sheet.`);
}
