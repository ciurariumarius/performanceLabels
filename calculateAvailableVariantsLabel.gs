/**
 * @file calculateAvailableVariantsLabel.gs
 * @description Calculates a label showing the ratio of in-stock variants to total variants for each parent product.
 * It reads from a "Metrics" sheet, extracts a parent ID from a composite 'id' column, counts stock statuses,
 * and writes the resulting labels (e.g., "3/5") to the "LABEL_AVAILABLE_VARIANTS" column.
 * It is optimized for background execution and relies on CommonUtilities.gs.
 *
 * Changelog (v2.1 - Unique Constants):
 * - Renamed script-level constants to be unique across the project to prevent "Identifier has already been declared" errors.
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Added a main try-catch block for robust error handling.
 * - Centralized setup and data validation.
 * - Encapsulated the two-pass logic (stats gathering and label generation) into dedicated functions.
 */

// --- Script-level Constants (with unique names) ---
const VARIANTS_METRICS_SHEET_NAME = "Metrics";
const VARIANTS_HEADER_ROW_NUM = 1;

// --- Column Headers (with unique names) ---
const VARIANTS_ID_INPUT_HEADER = "id";
const VARIANTS_STOCK_INPUT_HEADER = "Stock Status";
const VARIANTS_OUTPUT_LABEL_HEADER = "LABEL_AVAILABLE_VARIANTS";

// Define what text values count as "in stock" (case-insensitive)
const VARIANTS_IN_STOCK_TEXTS = ["instock", "in stock"];

/**
 * Main orchestrator function to run the available variants label calculation.
 */
function runAvailableVariantsLabel() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const metricsSheet = spreadsheet.getSheetByName(VARIANTS_METRICS_SHEET_NAME);
    if (!metricsSheet) {
      throw new Error(`Sheet "${VARIANTS_METRICS_SHEET_NAME}" was not found.`);
    }

    // --- 1. Read Data and Validate Setup ---
    const lastRow = metricsSheet.getLastRow();
    if (lastRow < VARIANTS_HEADER_ROW_NUM) {
      Logger.log(`Sheet "${VARIANTS_METRICS_SHEET_NAME}" has no header row. Aborting.`);
      return;
    }

    const headers = metricsSheet.getRange(VARIANTS_HEADER_ROW_NUM, 1, 1, metricsSheet.getLastColumn()).getValues()[0];
    const columnIndices = getVariantColumnIndices_(headers);

    const numDataRows = lastRow - VARIANTS_HEADER_ROW_NUM;
    if (numDataRows <= 0) {
      Logger.log("No data rows to process.");
      return;
    }

    const data = metricsSheet.getRange(VARIANTS_HEADER_ROW_NUM + 1, 1, numDataRows, headers.length).getValues();

    // --- 2. Gather Parent Product Statistics (First Pass) ---
    const parentStats = gatherParentStats_(data, columnIndices);

    // --- 3. Generate Labels (Second Pass) ---
    const labels = generateVariantLabels_(data, columnIndices, parentStats);

    // --- 4. Write Results to Sheet ---
    writeVariantLabelsToSheet_(metricsSheet, labels);

    Logger.log("Available Variants label calculation completed successfully.");

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runAvailableVariantsLabel: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Gets and validates the indices of required columns from the header row.
 * @private
 * @param {Array<string>} headers An array of header names.
 * @return {object} An object containing the 0-indexed column indices.
 */
function getVariantColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(VARIANTS_ID_INPUT_HEADER),
    stockStatus: headers.indexOf(VARIANTS_STOCK_INPUT_HEADER),
  };

  if (indices.id === -1) {
    throw new Error(`Required column "${VARIANTS_ID_INPUT_HEADER}" not found.`);
  }
  if (indices.stockStatus === -1) {
    Logger.log(`Warning: Column "${VARIANTS_STOCK_INPUT_HEADER}" not found. In-stock counts will be 0.`);
  }
  return indices;
}

/**
 * Extracts the parent product ID from a composite ID string (e.g., "shopify_US_12345_67890" -> "shopify_US_12345").
 * @private
 * @param {string} fullIdString The composite ID.
 * @return {string|null} The extracted parent ID or null if the pattern doesn't match.
 */
function extractParentId_(fullIdString) {
  if (!fullIdString || typeof fullIdString !== 'string') return null;
  const match = fullIdString.match(/(.*)_(\d+)$/);
  return match ? match[1] : fullIdString;
}

/**
 * First pass: Iterates through data to calculate total and in-stock variants for each parent product.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @return {object} An object where keys are parent IDs and values are {total, inStock} stats.
 */
function gatherParentStats_(data, columnIndices) {
  const parentStats = {};

  data.forEach(row => {
    const fullId = row[columnIndices.id];
    const parentId = extractParentId_(fullId);

    if (parentId) {
      if (!parentStats[parentId]) {
        parentStats[parentId] = { total: 0, inStock: 0 };
      }
      parentStats[parentId].total++;

      if (columnIndices.stockStatus !== -1) {
        const stockStatus = String(row[columnIndices.stockStatus] || "").toLowerCase().trim();
        if (VARIANTS_IN_STOCK_TEXTS.includes(stockStatus)) {
          parentStats[parentId].inStock++;
        }
      }
    }
  });
  
  Logger.log(`Gathered stats for ${Object.keys(parentStats).length} unique parent products.`);
  return parentStats;
}

/**
 * Second pass: Creates an array of labels for each row based on the gathered parent stats.
 * @private
 * @param {Array<Array<any>>} data The 2D array of data from the sheet.
 * @param {object} columnIndices An object with the indices of required columns.
 * @param {object} parentStats The object containing statistics for each parent product.
 * @return {Array<Array<string>>} A 2D array of labels, one for each row.
 */
function generateVariantLabels_(data, columnIndices, parentStats) {
  return data.map(row => {
    const fullId = row[columnIndices.id];
    const parentId = extractParentId_(fullId);
    let labelValue = ""; 

    if (parentId && parentStats[parentId]) {
      const stats = parentStats[parentId];
      labelValue = `${stats.inStock}/${stats.total}`;
    }
    return [labelValue];
  });
}

/**
 * Writes the generated labels back to the spreadsheet.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object to write to.
 * @param {Array<Array<string>>} labels The 2D array of labels to write.
 */
function writeVariantLabelsToSheet_(sheet, labels) {
  if (labels.length === 0) {
    Logger.log("No labels were generated to write.");
    return;
  }
  
  // Assumes CommonUtilities.gs findOrCreateHeaderColumn is available
  const outputCol = findOrCreateHeaderColumn(sheet, VARIANTS_OUTPUT_LABEL_HEADER, VARIANTS_HEADER_ROW_NUM);

  // Use the chunked writer from CommonUtilities.gs
  writeValuesToSheetSafe(sheet, VARIANTS_HEADER_ROW_NUM + 1, outputCol, labels);
  
  Logger.log(`Wrote ${labels.length} available variant labels to the sheet.`);
}
