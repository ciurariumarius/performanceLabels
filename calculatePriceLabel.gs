/**
 * @file calculatePriceLabel.gs
 * @description Calculates a price interval label (e.g., "price_0_50") based on product price.
 * The script reads from a "Metrics" sheet and uses a configurable step value to generate the labels.
 * It is optimized for background execution and uses CommonUtilities.gs.
 *
 * Changelog (v2.1 - Unique Constants):
 * - Renamed script-level constants to be unique across the project to prevent "Identifier has already been declared" errors.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Centralized configuration loading and data validation.
 * - Encapsulated the price interval calculation into a dedicated helper function.
 * - Relies on CommonUtilities.gs for config loading, sheet management, and safe data parsing.
 */

// --- Script-level Constants (with unique names) ---
const PRICE_CONFIG_SHEET_NAME = "Config";
const PRICE_METRICS_SHEET_NAME = "Metrics";
const PRICE_HEADER_ROW_NUM = 1;

// --- Column Headers (with unique names) ---
const PRICE_ID_INPUT_HEADER = "id";
const PRICE_INPUT_HEADER = "Product Price";
const PRICE_OUTPUT_LABEL_HEADER = "LABEL_PRICE_INTERVAL";

/**
 * Main orchestrator function to run the price interval label calculation.
 */
function runPriceLabels() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(PRICE_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Sheet "${PRICE_CONFIG_SHEET_NAME}" not found.`);
    }
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const priceIntervalStep = getConfigValue(SCRIPT_CONFIGS, "Price Interval Step", 'float', 50.0);

    if (priceIntervalStep <= 0) {
      throw new Error(`Configuration "Price Interval Step" must be a positive number in '${PRICE_CONFIG_SHEET_NAME}'.`);
    }
    Logger.log(`Price Label Config: Using interval step of ${priceIntervalStep}.`);

    // --- 2. Read Data and Validate Setup ---
    const metricsSheet = spreadsheet.getSheetByName(PRICE_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${PRICE_METRICS_SHEET_NAME}" not found.`);
    }

    const lastRow = metricsSheet.getLastRow();
    if (lastRow < PRICE_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${PRICE_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }

    const headers = metricsSheet.getRange(PRICE_HEADER_ROW_NUM, 1, 1, metricsSheet.getLastColumn()).getValues()[0];
    const columnIndices = getPriceColumnIndices_(headers);
    
    const numDataRows = lastRow - PRICE_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }
    const data = metricsSheet.getRange(PRICE_HEADER_ROW_NUM + 1, 1, numDataRows, headers.length).getValues();

    // --- 3. Generate Labels ---
    const labels = generatePriceLabels_(data, columnIndices, priceIntervalStep);

    // --- 4. Write Results to Sheet ---
    writePriceLabelsToSheet_(metricsSheet, labels);

    Logger.log("Price interval label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runPriceLabels: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getPriceColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(PRICE_ID_INPUT_HEADER),
    productPrice: headers.indexOf(PRICE_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found in "${PRICE_METRICS_SHEET_NAME}": ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Iterates through data and generates a price interval label for each row.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {number} step The configured step for creating price intervals.
 * @return {Array<Array<string>>} A 2D array of labels, one for each row.
 */
function generatePriceLabels_(data, columnIndices, step) {
  return data.map(row => {
    // Only process rows that have an ID.
    if (!row[columnIndices.id]) {
      return [""]; // Return blank for empty rows to maintain alignment
    }

    // Assumes CommonUtilities.gs parseFloatSafe is available
    const price = parseFloatSafe(row[columnIndices.productPrice], -1);
    
    // If price is invalid (defaults to -1), return a specific label.
    if (price < 0) {
      return ["invalid_price_data"];
    }
    
    const label = determinePriceIntervalLabel_(price, step);
    return [label];
  });
}

/**
 * Determines the price interval label for a single product (e.g., "price_0_50").
 * @private
 * @param {number} price The price of the product.
 * @param {number} step The step value for the interval.
 * @return {string} The calculated price interval label.
 */
function determinePriceIntervalLabel_(price, step) {
  const min = Math.floor(price / step) * step;
  const max = min + step;
  return `price_${min.toFixed(0)}_${max.toFixed(0)}`;
}

/**
 * Writes the generated labels back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} labels The 2D array of labels to write.
 */
function writePriceLabelsToSheet_(sheet, labels) {
  if (labels.length === 0) {
    Logger.log("No labels were generated to write.");
    return;
  }
  
  // Assumes CommonUtilities.gs findOrCreateHeaderColumn is available
  const outputCol = findOrCreateHeaderColumn(sheet, PRICE_OUTPUT_LABEL_HEADER, PRICE_HEADER_ROW_NUM);

  // Use the chunked writer from CommonUtilities.gs
  writeValuesToSheetSafe(sheet, PRICE_HEADER_ROW_NUM + 1, outputCol, labels);
  
  Logger.log(`Wrote ${labels.length} price interval labels to the sheet.`);
}
