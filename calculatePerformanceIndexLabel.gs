/**
 * @file calculatePerformanceIndexLabel.gs
 * @description Calculates a performance index label for products based on ROAS, cost, and order count.
 * This script reads from a "Metrics" sheet, calculates account-wide average ROAS for comparison,
 * and then assigns a performance label to each product. It is optimized for background execution.
 *
 * Changelog (v2.1):
 * - Modified ROAS calculation: if cost is 0, ROAS is now equal to revenue (not Infinity).
 * - Prevents writing "N/A" to the sheet for rows without a product ID; cells are now left blank.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Centralized configuration loading and validation.
 * - Encapsulated the complex labeling logic into a dedicated helper function.
 * - Relies on CommonUtilities.gs for safe data parsing.
 */

// --- Script-level Constants ---
const PERF_METRICS_SHEET_NAME = "Metrics";
const PERF_HEADER_ROW_NUM = 1;

/**
 * Main orchestrator function to run the performance index label calculation.
 */
function runPerformanceIndexLabel() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const metricsSheet = spreadsheet.getSheetByName(PERF_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${PERF_METRICS_SHEET_NAME}" was not found.`);
    }

    // --- 1. Load and Validate Configuration ---
    const config = {
      roasFactorIndex: 1.5,     // ROAS must be > AccountAvg * this factor for INDEX
      ordersThresholdIndex: 2,  // Orders must be > this for INDEX
      roasFactorNearIndex: 1.0,   // ROAS must be > AccountAvg * this factor for NEAR-INDEX
      roasFactorExclude: 0.6,   // ROAS must be < AccountAvg * this factor for EXCLUDE
      costToPriceRatioExclude: 0.8, // Cost > Price * this factor for EXCLUDE
      absoluteCostExclude: 50,  // OR Cost > this absolute value for EXCLUDE
    };
    Logger.log(`Performance Index Config: ROAS Factor (Index): ${config.roasFactorIndex}, Orders Threshold (Index): ${config.ordersThresholdIndex}`);

    // --- 2. Read Data and Get Column Indices ---
    const lastRow = metricsSheet.getLastRow();
    const lastCol = metricsSheet.getLastColumn();
    if (lastRow < PERF_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${PERF_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }
    
    const headers = metricsSheet.getRange(PERF_HEADER_ROW_NUM, 1, 1, lastCol).getValues()[0];
    const columnIndices = getColumnIndices_(headers);
    
    const numDataRows = lastRow - PERF_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }
    const data = metricsSheet.getRange(PERF_HEADER_ROW_NUM + 1, 1, numDataRows, lastCol).getValues();

    // --- 3. Calculate Account Averages ---
    const accountAvgROAS = calculateAccountAverages_(data, columnIndices);
    Logger.log(`Calculated Account Average ROAS: ${accountAvgROAS.toFixed(2)}`);

    // --- 4. Process Products and Generate Labels ---
    const results = processProductsAndGetLabels_(data, columnIndices, config, accountAvgROAS);

    // --- 5. Write Results to Sheet ---
    writeResultsToSheet_(metricsSheet, results);

    Logger.log("Performance Index label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runPerformanceIndexLabel: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf("id"),
    cost: headers.indexOf("cost"),
    productPrice: headers.indexOf("Product Price"),
    totalRevenue: headers.indexOf("Total Revenue"),
    totalOrders: headers.indexOf("Total Orders"),
  };
  
  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found in "${PERF_METRICS_SHEET_NAME}": ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Calculates the account-wide average ROAS from the dataset.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @return {number} The calculated average ROAS for the account.
 */
function calculateAccountAverages_(data, columnIndices) {
  let totalRevenue = 0;
  let totalCost = 0;

  data.forEach(row => {
    if (row[columnIndices.id]) {
      // Assumes CommonUtilities.gs parseFloatSafe is available
      totalRevenue += parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
      totalCost += parseFloatSafe(row[columnIndices.cost], 0.0);
    }
  });

  return totalCost > 0 ? totalRevenue / totalCost : 0;
}

/**
 * Iterates through products, calculates their ROAS, determines their label, and collects the results.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {object} config The configuration object with thresholds.
 * @param {number} accountAvgROAS The account-wide average ROAS.
 * @return {Array<Array<string>>} A 2D array containing [roas, label] for each product.
 */
function processProductsAndGetLabels_(data, columnIndices, config, accountAvgROAS) {
  const results = [];

  data.forEach(row => {
    if (!row[columnIndices.id]) {
      results.push(["", ""]); // Push blanks for rows without an ID to maintain alignment
      return;
    }

    const cost = parseFloatSafe(row[columnIndices.cost], 0.0);
    const revenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    const price = parseFloatSafe(row[columnIndices.productPrice], 0.0);
    const orders = parseIntSafe(row[columnIndices.totalOrders], 0);

    // If cost is 0, ROAS equals revenue. Otherwise, calculate as normal.
    const productROAS = cost > 0 ? revenue / cost : revenue;

    const label = determinePerformanceLabel_(productROAS, orders, cost, price, config, accountAvgROAS);
    results.push([productROAS.toFixed(2), label]);
  });

  return results;
}

/**
 * Determines the performance label for a single product based on a set of rules.
 * @private
 * @param {number} productROAS The calculated ROAS for the product.
 * @param {number} orders The number of orders for the product.
 * @param {number} cost The cost associated with the product.
 * @param {number} price The price of the product.
 * @param {object} config The configuration object with thresholds.
 * @param {number} accountAvgROAS The account-wide average ROAS.
 * @return {string} The calculated performance label.
 */
function determinePerformanceLabel_(productROAS, orders, cost, price, config, accountAvgROAS) {
  // Rule Priority 1: NO-INDEX (minimal or zero activity)
  if ((cost === 0 && orders === 0) || (cost < 1.5 && orders === 0)) {
    return "NO-INDEX";
  }

  // Rule Priority 2: INDEX (high performers)
  if (productROAS > (accountAvgROAS * config.roasFactorIndex) && orders > config.ordersThresholdIndex) {
    return "INDEX";
  }

  // Rule Priority 3: EXCLUDE-INDEX (unprofitable and costly)
  const isCostHigh = (price > 0 && cost > (price * config.costToPriceRatioExclude)) || (cost > config.absoluteCostExclude);
  if (productROAS < (accountAvgROAS * config.roasFactorExclude) && isCostHigh) {
    return "EXCLUDE-INDEX";
  }

  // Rule Priority 4: NEAR-INDEX (good potential)
  if (productROAS > (accountAvgROAS * config.roasFactorNearIndex)) {
    return "NEAR-INDEX";
  }

  // Default Catch-all Label
  return "LOW-INDEX";
}

/**
 * Writes the calculated ROAS and label results back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} results The 2D array of [roas, label] to write.
 */
function writeResultsToSheet_(sheet, results) {
  if (results.length === 0) {
    Logger.log("No results were generated to write.");
    return;
  }
  
  // Assumes CommonUtilities.gs findOrCreateHeaderColumn is available
  const roasCol = findOrCreateHeaderColumn(sheet, "Site ROAS", PERF_HEADER_ROW_NUM);
  const labelCol = findOrCreateHeaderColumn(sheet, "LABEL_PERFORMANCE_INDEX", PERF_HEADER_ROW_NUM);

  const roasValues = results.map(row => [row[0]]);
  const labelValues = results.map(row => [row[1]]);

  // Write new values in chunks
  writeValuesToSheetSafe(sheet, PERF_HEADER_ROW_NUM + 1, roasCol, roasValues);
  writeValuesToSheetSafe(sheet, PERF_HEADER_ROW_NUM + 1, labelCol, labelValues);
  
  Logger.log(`Wrote ${results.length} performance labels and ROAS values to the sheet.`);
}
