/**
 * @file CommonUtilities.gs
 * @description This file contains shared helper functions used across various data processing and
 * reporting scripts in this Google Apps Script project. It centralizes functionality for
 * configuration loading, date formatting, sheet management, and safe data parsing.
 */


// =========================================================================================
// --- Configuration Loading Helper Functions ---
// =========================================================================================

/**
 * Loads configurations from a specified sheet.
 * Assumes a two-column layout where Column A contains labels and Column B contains values.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} configSheet The sheet object to read from.
 * @return {object} An object where keys are labels from Col A and values are from Col B. Returns empty object on error.
 */
function loadConfigurationsFromSheetObject(configSheet) {
  const configurations = {};
  if (!configSheet) {
    Logger.log("Error in CommonUtilities: The provided configSheet object was null.");
    return configurations;
  }
  try {
    const dataRange = configSheet.getRange("A1:B" + configSheet.getLastRow());
    const data = dataRange.getValues();

    for (const row of data) {
      const label = String(row[0]).trim();
      if (label) {
        configurations[label] = row[1]; // Store the value from column B
      }
    }
    return configurations;
  } catch (e) {
    Logger.log(`Error in CommonUtilities while loading configurations: ${e.message}`);
    return {}; // Return empty object on error to prevent partial configs
  }
}

/**
 * Retrieves a configuration value by its label from a loaded config object.
 * Handles type conversion and provides a default value if the key is not found.
 *
 * @param {object} configObject The configuration object loaded by `loadConfigurationsFromSheetObject`.
 * @param {string} label The exact label text to look up.
 * @param {string} type The expected type: 'string', 'int', 'float', or 'boolean'.
 * @param {*} [defaultValue=null] The value to return if the label is not found or type conversion fails.
 * @return {*} The configuration value, converted to the specified type, or the defaultValue.
 */
function getConfigValue(configObject, label, type = 'string', defaultValue = null) {
  if (!configObject.hasOwnProperty(label)) {
    Logger.log(`Warning in CommonUtilities: Config label "${label}" not found. Using default value: ${defaultValue}.`);
    return defaultValue;
  }

  const value = configObject[label];

  if (value === null || value === undefined) {
    return defaultValue;
  }

  try {
    switch (type.toLowerCase()) {
      case 'string':
        return String(value).trim();
      case 'int':
        const intVal = parseInt(value, 10);
        return isNaN(intVal) ? defaultValue : intVal;
      case 'float':
        // Handles both comma and period as decimal separators by replacing comma first
        const floatVal = parseFloat(String(value).replace(',', '.'));
        return isNaN(floatVal) ? defaultValue : floatVal;
      case 'boolean':
        if (typeof value === 'boolean') return value;
        const valStr = String(value).toLowerCase().trim();
        if (valStr === 'true' || valStr === '1') return true;
        if (valStr === 'false' || valStr === '0' || valStr === '') return false; // Treat empty as false
        return defaultValue;
      default:
        Logger.log(`Warning in CommonUtilities: Unknown type "${type}" for label "${label}". Returning raw value.`);
        return value;
    }
  } catch (e) {
    Logger.log(`Error in CommonUtilities converting label "${label}" with value "${value}" to type "${type}". Returning default. Error: ${e.message}`);
    return defaultValue;
  }
}


// =========================================================================================
// --- Sheet and Header Management Functions ---
// =========================================================================================

/**
 * Gets a sheet by name, or creates it if it doesn't exist.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet object.
 * @param {string} sheetName The name of the sheet to get or create.
 * @return {GoogleAppsScript.Spreadsheet.Sheet} The sheet object.
 */
function getOrCreateSheet(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    Logger.log(`Sheet "${sheetName}" was not found and has been created.`);
  }
  return sheet;
}

/**
 * Finds the column number for a given header. If not found, adds it as a new column.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The sheet object.
 * @param {string} headerName The header name to find or create.
 * @param {number} [headerRow=1] The row number where headers are located (1-indexed).
 * @return {number} The column number (1-indexed) of the header.
 */
function findOrCreateHeaderColumn(sheet, headerName, headerRow = 1) {
  const lastCol = sheet.getLastColumn();
  // Read headers only if there are columns to read
  const headers = lastCol > 0 ? sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] : [];
  const colIndex = headers.indexOf(headerName);

  if (colIndex !== -1) {
    return colIndex + 1; // Return existing column number (1-indexed)
  } else {
    const newColNum = lastCol + 1;
    sheet.getRange(headerRow, newColNum).setValue(headerName).setFontWeight("bold").setHorizontalAlignment("center");
    Logger.log(`Header "${headerName}" was not found and has been added in column ${newColNum}.`);
    return newColNum;
  }
}


// =========================================================================================
// --- Safe Data Parsing Functions ---
// =========================================================================================

/**
 * Safely parses a value into a float, handling common non-numeric characters.
 * Removes commas (as thousands separators) and trims whitespace.
 * @param {string|number|null|undefined} value The value to parse.
 * @param {number} [defaultValue=0.0] The value to return if parsing fails or input is null/undefined.
 * @return {number} The parsed float or the default value.
 */
function parseFloatSafe(value, defaultValue = 0.0) {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'number' && !isNaN(value)) return value;

  const s = String(value).replace(/,/g, '').trim();
  if (s === '') return defaultValue;

  const num = parseFloat(s);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Safely parses a value into an integer.
 * @param {string|number|null|undefined} value The value to parse.
 * @param {number} [defaultValue=0] The value to return if parsing fails or input is null/undefined.
 * @return {number} The parsed integer or the default value.
 */
function parseIntSafe(value, defaultValue = 0) {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'number' && !isNaN(value)) return Math.round(value);

  const s = String(value).replace(/,/g, '').trim();
  if (s === '') return defaultValue;

  const num = parseInt(s, 10);
  return isNaN(num) ? defaultValue : num;
}


// =========================================================================================
// --- Date Formatting Functions ---
// =========================================================================================

/**
 * Formats a Date object with time for display (e.g., dd/MM/yyyy HH:mm:ss).
 * Uses the spreadsheet's configured timezone.
 * @param {Date} date The date object to format.
 * @return {string} The formatted date-time string, or an error message.
 */
function formatDisplayDateTime(date) {
  if (!(date instanceof Date) || isNaN(date.valueOf())) {
    Logger.log("Warning in CommonUtilities (formatDisplayDateTime): Invalid date provided.");
    return "Invalid Date";
  }
  try {
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(date, timeZone, "dd/MM/yyyy HH:mm:ss");
  } catch (e) {
    Logger.log(`Error in CommonUtilities (formatDisplayDateTime): ${e.message}`);
    return "Date Format Error";
  }
}

/**
 * Creates a formatted date range string for display (e.g., "dd/MM/yyyy - dd/MM/yyyy").
 * Calculates start date based on number of days back from today.
 * @param {number} days The number of days for the range (looking backwards from today).
 * @return {string} The formatted date range string, or an error message.
 */
function formatDisplayDateRange(days) {
  if (typeof days !== 'number' || isNaN(days) || days <= 0) {
    Logger.log("Warning in CommonUtilities (formatDisplayDateRange): Invalid number of days provided.");
    return "Invalid Date Range";
  }
  try {
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days + 1); // Inclusive start day

    const formattedStartDate = Utilities.formatDate(startDate, timeZone, "dd/MM/yyyy");
    const formattedEndDate = Utilities.formatDate(endDate, timeZone, "dd/MM/yyyy");
    return `${formattedStartDate} - ${formattedEndDate}`;
  } catch (e) {
    Logger.log(`Error in CommonUtilities (formatDisplayDateRange): ${e.message}`);
    return "Date Range Format Error";
  }
}

/**
 * Formats a Date object as YYYY-MM-DD for use in GA4 API calls.
 * @param {Date} date The date object to format.
 * @return {string} The formatted date string for GA4, or an error message.
 */
function formatDateForGA4(date) {
  if (!(date instanceof Date) || isNaN(date.valueOf())) {
    Logger.log("Warning in CommonUtilities (formatDateForGA4): Invalid date provided.");
    return "Invalid Date";
  }
  try {
    return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
  } catch (e) {
    Logger.log(`Error in CommonUtilities (formatDateForGA4): ${e.message}`);
    return "Date Format Error";
  }
}

/**
 * Formats a Date object as dd/MM/yyyy for display.
 * @param {Date} date The date object to format.
 * @return {string} The formatted date string, or an error message.
 */
function formatDisplayDate(date) {
  if (!(date instanceof Date) || isNaN(date.valueOf())) {
    Logger.log("Warning in CommonUtilities (formatDisplayDate): Invalid date provided.");
    return "Invalid Date";
  }
  try {
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(date, timeZone, "dd/MM/yyyy");
  } catch (e) {
    Logger.log(`Error in CommonUtilities (formatDisplayDate): ${e.message}`);
    return "Date Format Error";
  }
}
// =========================================================================================
// --- Account Data Logging Helper Functions ---
// =========================================================================================

/**
 * Updates a row in the AccountData sheet based on the Source Name (Column B).
 * If the source exists, it overwrites the row. If not, it appends a new row.
 * 
 * Target Schema:
 * [Timestamp, Source, Timeframe, Revenue, Cost, Orders, OOS #, OOS %]
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet.
 * @param {string} sheetName The name of the AccountData sheet.
 * @param {object} data An object containing the metrics to write.
 *                     { source: "Shopify", timeframe: "30 Days", revenue: 100, cost: 0, orders: 10, oosCount: 2, oosPercent: "10%" }
 */
function upsertAccountDataRow(spreadsheet, sheetName, data) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  
  // Headers
  const headers = ["Timestamp", "Source", "Timeframe", "Revenue", "Cost", "Orders", "OOS w/ Sales (#)", "OOS w/ Sales (%)"];
  
  // Ensure headers exist
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setHorizontalAlignment("center");
  }
  
  const lastRow = sheet.getLastRow();
  let targetRow = -1;
  
  // Search for existing source in Column B (Index 1)
  if (lastRow > 1) {
    const sourceColumn = sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat(); // Get all sources
    const rowIndex = sourceColumn.indexOf(data.source);
    if (rowIndex !== -1) {
      targetRow = rowIndex + 2; // +2 because 0-index + 1 header + 1 for 1-based index
    }
  }
  
  // Prepare row data
  const rowData = [
    formatDisplayDateTime(new Date()), // Timestamp
    data.source,
    data.timeframe,
    data.revenue,
    data.cost !== undefined ? data.cost : "-",
    data.orders,
    data.oosCount !== undefined ? data.oosCount : "-",
    data.oosPercent !== undefined ? data.oosPercent : "-"
  ];
  
  if (targetRow !== -1) {
    // update existing
    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // append new
    sheet.appendRow(rowData);
  }
}

// =========================================================================================
// --- URL and Network Helper Functions ---
// =========================================================================================

/**
 * Ensures a URL string starts with https://.
 * @param {string} url The URL to check.
 * @returns {string} The URL with https:// prefix if needed, or empty string if input is invalid.
 */
function ensureHttps(url) {
  if (!url || typeof url !== 'string') return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("http")) return trimmed;
  return "https://" + trimmed;
}

/**
 * Generic helper function to fetch JSON data from an endpoint with retries and exponential backoff.
 * @param {string} endpoint The full URL for the API endpoint.
 * @param {object} options The options for UrlFetchApp.fetch().
 * @param {number} [retries=3] Number of retry attempts.
 * @return {Array|object|null} The parsed JSON response, or null on failure.
 */
function fetchJsonWithRetries(endpoint, options, retries = 3) {
  const fetchOptions = { ...options, muteHttpExceptions: true };

  for (let i = 0; i < retries; i++) {
    try {
      const response = UrlFetchApp.fetch(endpoint, fetchOptions);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode >= 200 && responseCode < 300) {
        return JSON.parse(responseText);
      } else {
        Logger.log(`API Error (Attempt ${i + 1}/${retries}): ${responseCode} for ${endpoint.substring(0, 100)}...`);
        if (responseCode === 401 || responseCode === 403) {
          throw new Error(`Authorization error (${responseCode}). Check API keys and permissions.`);
        }
        // Exponential backoff
        if (i < retries - 1) Utilities.sleep(1000 * Math.pow(2, i));
      }
    } catch (e) {
      Logger.log(`Fetch Exception (Attempt ${i + 1}/${retries}): ${e.message} for ${endpoint.substring(0, 100)}...`);
      if (i === retries - 1) throw e;
    }
  }
  throw new Error(`Failed to fetch data from ${endpoint.substring(0, 100)}... after ${retries} attempts.`);
}
