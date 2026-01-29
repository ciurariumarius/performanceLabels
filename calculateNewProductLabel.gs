/**
 * @file calculateNewProductLabel.gs
 * @description Calculates a "new product" label based on the product's creation date.
 * A product is labeled "new_product" if its creation date is within a configurable number of days.
 * The script is optimized for background execution and uses CommonUtilities.gs.
 *
 * Changelog (v2.1 - Unique Constants):
 * - Renamed script-level constants to be unique across the project to prevent "Identifier has already been declared" errors.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Centralized configuration loading and data validation.
 * - Encapsulated date comparison and label generation logic.
 */

// --- Script-level Constants (with unique names) ---
const NEW_PROD_CONFIG_SHEET_NAME = "Config";
const NEW_PROD_METRICS_SHEET_NAME = "Metrics";
const NEW_PROD_HEADER_ROW_NUM = 1;

// --- Column Headers (with unique names) ---
const NEW_PROD_ID_INPUT_HEADER = "id"; // Added to ensure we only process rows with data
const NEW_PROD_DATE_INPUT_HEADER = "Date Created";
const NEW_PROD_OUTPUT_LABEL_HEADER = "LABEL_NEW";

// --- Label Text ---
const NEW_PRODUCT_LABEL = "new_product";
const OLDER_PRODUCT_LABEL = ""; // Use a blank string for older products

/**
 * Main orchestrator function to run the new product label calculation.
 */
function runNewProductLabelCalculation() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(NEW_PROD_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Sheet "${NEW_PROD_CONFIG_SHEET_NAME}" not found.`);
    }
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const newProductDays = getConfigValue(SCRIPT_CONFIGS, "New Product Days", 'int', 30);

    if (newProductDays <= 0) {
      throw new Error(`Configuration "New Product Days" must be a positive number in '${NEW_PROD_CONFIG_SHEET_NAME}'.`);
    }
    Logger.log(`New Product Label Config: Using a threshold of ${newProductDays} days.`);

    // --- 2. Read Data and Validate Setup ---
    const metricsSheet = spreadsheet.getSheetByName(NEW_PROD_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${NEW_PROD_METRICS_SHEET_NAME}" not found.`);
    }

    const lastRow = metricsSheet.getLastRow();
    if (lastRow < NEW_PROD_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${NEW_PROD_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }

    const headers = metricsSheet.getRange(NEW_PROD_HEADER_ROW_NUM, 1, 1, metricsSheet.getLastColumn()).getValues()[0];
    const columnIndices = getNewProdColumnIndices_(headers);
    
    const numDataRows = lastRow - NEW_PROD_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }
    const data = metricsSheet.getRange(NEW_PROD_HEADER_ROW_NUM + 1, 1, numDataRows, headers.length).getValues();

    // --- 3. Generate Labels ---
    const labels = generateNewProductLabels_(data, columnIndices, newProductDays);

    // --- 4. Write Results to Sheet ---
    writeNewProductLabelsToSheet_(metricsSheet, labels);

    Logger.log("New Product label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runNewProductLabelCalculation: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getNewProdColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(NEW_PROD_ID_INPUT_HEADER),
    dateCreated: headers.indexOf(NEW_PROD_DATE_INPUT_HEADER),
  };

  if (indices.id === -1) {
    throw new Error(`Required column "${NEW_PROD_ID_INPUT_HEADER}" not found.`);
  }
  if (indices.dateCreated === -1) {
    throw new Error(`Required column "${NEW_PROD_DATE_INPUT_HEADER}" not found.`);
  }
  return indices;
}

/**
 * Iterates through data and generates a "new product" label for each row.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {number} newProductDays The configured number of days to be considered "new".
 * @return {Array<Array<string>>} A 2D array of labels, one for each row.
 */
function generateNewProductLabels_(data, columnIndices, newProductDays) {
  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(today.getDate() - newProductDays);
  cutoffDate.setHours(0, 0, 0, 0); // Set to the start of the cutoff day

  return data.map((row, index) => {
    // Only process rows that have an ID.
    if (!row[columnIndices.id]) {
      return [""]; // Return blank for empty rows
    }

    const dateCreatedValue = row[columnIndices.dateCreated];
    let label = OLDER_PRODUCT_LABEL; // Default to older

    if (dateCreatedValue) {
      const productCreationDate = new Date(dateCreatedValue);
      // Check if the date is valid
      if (!isNaN(productCreationDate.valueOf())) {
        if (productCreationDate >= cutoffDate) {
          label = NEW_PRODUCT_LABEL;
        }
      } else {
        // Log a warning for invalid date formats but don't stop the script
        Logger.log(`Warning: Invalid date format in row ${index + 2}: "${dateCreatedValue}"`);
        label = "invalid_date"; // Assign a specific label for bad data
      }
    }
    
    return [label];
  });
}

/**
 * Writes the generated labels back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} labels The 2D array of labels to write.
 */
function writeNewProductLabelsToSheet_(sheet, labels) {
  if (labels.length === 0) {
    Logger.log("No labels were generated to write.");
    return;
  }
  
  // Assumes CommonUtilities.gs findOrCreateHeaderColumn is available
  const outputCol = findOrCreateHeaderColumn(sheet, NEW_PROD_OUTPUT_LABEL_HEADER, NEW_PROD_HEADER_ROW_NUM);

  const range = sheet.getRange(NEW_PROD_HEADER_ROW_NUM + 1, outputCol, labels.length, 1);
  range.clearContent();
  range.setValues(labels);
  
  Logger.log(`Wrote ${labels.length} new product labels to the sheet.`);
}
