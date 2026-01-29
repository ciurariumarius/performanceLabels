/**
 * @file calculateOrdersLabel.gs
 * @description Calculates and applies order volume labels ("no_orders", "low_orders", etc.)
 * to the "Metrics" sheet. The logic uses a configurable order count threshold and also
 * checks for the presence of revenue. It is optimized for background execution.
 *
 * Changelog (v2.1 - Unique Constants):
 * - Renamed script-level constants to be unique across the project to prevent "Identifier has already been declared" errors.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Centralized configuration loading and data validation.
 * - Encapsulated the labeling logic into a dedicated helper function.
 * - Relies on CommonUtilities.gs for config loading, sheet management, and safe data parsing.
 */

// --- Script-level Constants (with unique names) ---
const ORDERS_CONFIG_SHEET_NAME = "Config";
const ORDERS_METRICS_SHEET_NAME = "Metrics";
const ORDERS_HEADER_ROW_NUM = 1;

// --- Column Headers (with unique names) ---
const ORDERS_ID_INPUT_HEADER = "id";
const ORDERS_COUNT_INPUT_HEADER = "Total Orders";
const ORDERS_REVENUE_INPUT_HEADER = "Total Revenue";
const ORDERS_OUTPUT_LABEL_HEADER = "LABEL_ORDERS";

/**
 * Main orchestrator function to run the orders label calculation.
 */
function runOrdersLabel() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(ORDERS_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Sheet "${ORDERS_CONFIG_SHEET_NAME}" not found.`);
    }
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const orderThreshold = getConfigValue(SCRIPT_CONFIGS, "Nr. of Orders Threshold", 'int', 0);
    Logger.log(`Orders Label Config: Using order threshold of ${orderThreshold}.`);

    // --- 2. Read Data and Validate Setup ---
    const metricsSheet = spreadsheet.getSheetByName(ORDERS_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${ORDERS_METRICS_SHEET_NAME}" not found.`);
    }

    const lastRow = metricsSheet.getLastRow();
    if (lastRow < ORDERS_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${ORDERS_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }

    const headers = metricsSheet.getRange(ORDERS_HEADER_ROW_NUM, 1, 1, metricsSheet.getLastColumn()).getValues()[0];
    const columnIndices = getOrderColumnIndices_(headers);
    
    const numDataRows = lastRow - ORDERS_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }
    const data = metricsSheet.getRange(ORDERS_HEADER_ROW_NUM + 1, 1, numDataRows, headers.length).getValues();

    // --- 3. Generate Labels ---
    const labels = generateOrderLabels_(data, columnIndices, orderThreshold);

    // --- 4. Write Results to Sheet ---
    writeOrderLabelsToSheet_(metricsSheet, labels);

    Logger.log("Orders label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runOrdersLabel: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getOrderColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(ORDERS_ID_INPUT_HEADER),
    totalOrders: headers.indexOf(ORDERS_COUNT_INPUT_HEADER),
    totalRevenue: headers.indexOf(ORDERS_REVENUE_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found in "${ORDERS_METRICS_SHEET_NAME}": ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Iterates through data, parses values, and generates a label for each row.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {number} orderThreshold The configured threshold for 'high_orders'.
 * @return {Array<Array<string>>} A 2D array of labels, one for each row.
 */
function generateOrderLabels_(data, columnIndices, orderThreshold) {
  return data.map(row => {
    // Only process rows that have an ID.
    if (!row[columnIndices.id]) {
      return [""]; // Return blank for empty rows to maintain alignment
    }

    // Assumes CommonUtilities.gs safe parsing functions are available
    const orders = parseIntSafe(row[columnIndices.totalOrders], 0);
    const revenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    
    const label = determineOrderLabel_(orders, revenue, orderThreshold);
    return [label];
  });
}

/**
 * Determines the order volume label for a single product based on a set of rules.
 * @private
 * @param {number} orders The number of orders for the product.
 * @param {number} revenue The total revenue for the product.
 * @param {number} threshold The configured threshold for 'high_orders'.
 * @return {string} The calculated order label.
 */
function determineOrderLabel_(orders, revenue, threshold) {
  // Rule 1: If there is no revenue, there are effectively no orders for labeling purposes.
  if (revenue <= 0) {
    return "no_orders";
  }

  // Rules for products with revenue:
  if (orders === 0) {
    return "no_orders"; // Handles cases with revenue but 0 orders (e.g., manual data, refunds)
  }
  if (orders === 1) {
    return "one_order";
  }
  // The threshold must be greater than 0 for 'high_orders' to be a meaningful category.
  if (threshold > 0 && orders >= threshold) {
    return "high_orders";
  }
  
  // Default for all other cases (orders > 1 and less than threshold, or threshold is 0).
  return "average_orders";
}

/**
 * Writes the generated labels back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} labels The 2D array of labels to write.
 */
function writeOrderLabelsToSheet_(sheet, labels) {
  if (labels.length === 0) {
    Logger.log("No labels were generated to write.");
    return;
  }
  
  // Assumes CommonUtilities.gs findOrCreateHeaderColumn is available
  const outputCol = findOrCreateHeaderColumn(sheet, ORDERS_OUTPUT_LABEL_HEADER, ORDERS_HEADER_ROW_NUM);

  const range = sheet.getRange(ORDERS_HEADER_ROW_NUM + 1, outputCol, labels.length, 1);
  range.clearContent();
  range.setValues(labels);
  
  Logger.log(`Wrote ${labels.length} order volume labels to the sheet.`);
}
