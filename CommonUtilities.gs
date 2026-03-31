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
  // We no longer read from the sheet. We return a mapping from the centralized AppConfig
  // so that all existing scripts (calculating labels) don't need to be rewritten.
  Logger.log("Loading configurations from Config.gs...");
  
  return {
    "ROAS Good": AppConfig.ROAS.Good,
    "ROAS Bad": AppConfig.ROAS.Bad,
    "Conversion Rate Good": AppConfig.ConversionRate.Good,
    "Conversion Rate Bad": AppConfig.ConversionRate.Bad,
    "Clicks High": AppConfig.Clicks.High,
    "Clicks Low": AppConfig.Clicks.Low,
    "Low Revenue Threshold": AppConfig.Revenue.LowThresholdPercent,
    "High Revenue Threshold": AppConfig.Revenue.HighThresholdPercent,
    "Price Interval Step": AppConfig.PriceIntervalStep,
    "Nr. of Orders Threshold": AppConfig.Orders.Threshold,
    "New Product Days": AppConfig.NewProductDays,
    "Timeframe": AppConfig.TimeframeDays,
    
    // Label Mappings
    "LABEL_GADS_ROAS": AppConfig.LabelsMapping.LABEL_GADS_ROAS,
    "LABEL_GADS_CONV_RATE": AppConfig.LabelsMapping.LABEL_GADS_CONV_RATE,
    "LABEL_GADS_CLICKS": AppConfig.LabelsMapping.LABEL_GADS_CLICKS,
    "LABEL_REVENUE_SIMPLE": AppConfig.LabelsMapping.LABEL_REVENUE_SIMPLE,
    "LABEL_REVENUE_ADVANCED": AppConfig.LabelsMapping.LABEL_REVENUE_ADVANCED,
    "LABEL_PRICE_INTERVAL": AppConfig.LabelsMapping.LABEL_PRICE_INTERVAL,
    "LABEL_PERFORMANCE_INDEX": AppConfig.LabelsMapping.LABEL_PERFORMANCE_INDEX,
    "LABEL_AVAILABLE_VARIANTS": AppConfig.LabelsMapping.LABEL_AVAILABLE_VARIANTS,
    "LABEL_ORDERS": AppConfig.LabelsMapping.LABEL_ORDERS,
    "LABEL_TREND": AppConfig.LabelsMapping.LABEL_TREND,
    "LABEL_NEW": AppConfig.LabelsMapping.LABEL_NEW
  };
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
  if (!headerName || String(headerName).trim() === "") {
    Logger.log("Header name is empty. Skipping column creation.");
    return -1; 
  }

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
 * Updates a row in the Overview sheet based on the Source Name (Column B).
 * If the source exists, it overwrites the row. If not, it appends a new row.
 * 
 * Target Schema:
 * [Timestamp, Source, Timeframe, Revenue, Cost, Orders, OOS #, OOS %]
 * 
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet.
 * @param {string} sheetName The name of the Overview sheet.
 * @param {object} data An object containing the metrics to write.
 *                     { source: "Shopify", timeframe: "30 Days", revenue: 100, cost: 0, orders: 10, oosCount: 2, oosPercent: "10%" }
 */
// --- OVERVIEW DASHBOARD LOGIC ---

/**
 * Initializes the layout of the Overview Dashboard if it's empty or missing headers.
 */
function initializeOverviewDashboard_(sheet) {
  // Check if Top Section is configured
  const topLeft = sheet.getRange("A1").getValue();
  if (topLeft === "LIVE SYSTEM STATUS") return; // Already initialized

  sheet.clear();
  
  // 1. Top Section (Status)
  sheet.getRange("A1:C1").merge().setValue("LIVE SYSTEM STATUS").setFontWeight("bold").setBackground("#f3f3f3");
  sheet.getRange("A2").setValue("Current Status:").setFontWeight("bold");
  sheet.getRange("B2").setValue("🟢 IDLE").setFontWeight("bold").setFontColor("#0f9d58");
  sheet.getRange("A3").setValue("Last Sync:").setFontWeight("bold");
  sheet.getRange("B3").setValue("-");

  // 2. Middle Section (Totals)
  sheet.getRange("A5:H5").merge().setValue("ACCOUNT TOTALS (LATEST SNAPSHOT)").setFontWeight("bold").setBackground("#e8eaed").setHorizontalAlignment("center");
  
  sheet.getRange("A6").setValue("Store Revenue:").setFontWeight("bold");
  sheet.getRange("A7").setValue("Store Orders:").setFontWeight("bold");
  sheet.getRange("A8").setValue("Active Products:").setFontWeight("bold");

  sheet.getRange("D6").setValue("Ads Revenue/Value:").setFontWeight("bold");
  sheet.getRange("D7").setValue("Ads Cost:").setFontWeight("bold");
  sheet.getRange("D8").setValue("Ads Conversions:").setFontWeight("bold");

  sheet.getRange("G6").setValue("Products without stock with sales (#):").setFontWeight("bold");
  sheet.getRange("G7").setValue("Products without stock with sales (%):").setFontWeight("bold");

  // 3. Bottom Section (Historical Log)
  sheet.getRange("A11").setValue("EXECUTION LOG").setFontWeight("bold").setFontSize(12);
  const logHeaders = ["Timestamp", "Component", "Action / Status", "Details", "Timeframe (Days)"];
  sheet.getRange(12, 1, 1, logHeaders.length).setValues([logHeaders]).setFontWeight("bold").setBackground("#fce8e6").setHorizontalAlignment("center");
  
  // Set Column Widths for better UI
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 250);
  sheet.setColumnWidth(5, 120);
  
  SpreadsheetApp.flush();
}

/**
 * Updates the Live Status Block at A2:B4
 */
function updateDashboardStatus(spreadsheet, sheetName, status, message) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  initializeOverviewDashboard_(sheet);

  let statusText = "🟢 IDLE";
  let color = "#0f9d58";
  
  if (status === "RUNNING" || status === "WRITING") {
    statusText = `🟠 ${status}`;
    color = "#f4b400";
  } else if (status === "ERROR") {
    statusText = `🔴 ${status}`;
    color = "#d23f31";
  } else if (status === "PAUSED") {
    statusText = `🟡 ${status}`;
    color = "#f4b400";
  } else if (status === "COMPLETED") {
    statusText = `🟢 ${status}`;
    color = "#0f9d58";
  }

  sheet.getRange("B2").setValue(statusText).setFontColor(color);
  if (message) sheet.getRange("C2").setValue(message); // Put details next to it
  
  if (status === "COMPLETED") {
    sheet.getRange("B3").setValue(formatDisplayDateTime(new Date()));
    sheet.getRange("C2").setValue(""); // clear message on complete
  }
}

/**
 * Updates the Middle Section (Account Totals)
 * @param {object} totals { kind: 'store'|'ads', rev, cost, orders, products, oosCount, oosPercent }
 */
function updateDashboardMetrics(spreadsheet, sheetName, totals) {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  initializeOverviewDashboard_(sheet);

  if (totals.kind === 'store') {
    sheet.getRange("B6").setValue(totals.rev).setNumberFormat('#,##0.00');
    sheet.getRange("B7").setValue(totals.orders);
    if (totals.products !== undefined) sheet.getRange("B8").setValue(totals.products);
    
    sheet.getRange("H6").setValue(totals.oosCount);
    sheet.getRange("H7").setValue(totals.oosPercent);
  } else if (totals.kind === 'ads') {
    sheet.getRange("E6").setValue(totals.rev).setNumberFormat('#,##0.00');
    sheet.getRange("E7").setValue(totals.cost).setNumberFormat('#,##0.00');
    sheet.getRange("E8").setValue(totals.orders);
  }
}

/**
 * Appends a new historic row to the Execution Log (Row 13 downwards).
 * Keeps maximum 500 logs by deleting rows > 512.
 */
function appendToOverviewLog(spreadsheet, sheetName, component, status, details, timeframe = "-") {
  const sheet = getOrCreateSheet(spreadsheet, sheetName);
  initializeOverviewDashboard_(sheet);

  const timestamp = formatDisplayDateTime(new Date());
  
  // Insert row at top of log (Row 13, pushing old ones down)
  sheet.insertRowBefore(13);
  
  const rowData = [[timestamp, component, status, details, timeframe]];
  const range = sheet.getRange(13, 1, 1, 5);
  range.setValues(rowData).setFontWeight("normal").setBackground(null);
  
  // Basic Color coding for the 'Status' column (C13)
  if (status.includes("ERROR") || status.includes("FAIL")) range.setBackground("#fce8e6");
  else if (status.includes("SUCCESS") || status.includes("COMPLETED")) range.setBackground("#e6f4ea");

  // Cleanup: Max 500 runs to save memory (headers are up to row 12)
  if (sheet.getMaxRows() > 520) {
    // Note: getMaxRows() gets all rows including empty ones at bottom.
    // It's safer to delete bottom rows if getLastRow() is too big
    if (sheet.getLastRow() > 512) {
      const rowsToDelete = sheet.getLastRow() - 512;
      try { sheet.deleteRows(513, rowsToDelete); } catch(e) {}
    }
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

// =========================================================================================
// --- Batch Writing Helper Functions ---
// =========================================================================================

/**
 * Writes a single column of values to a sheet in chunks to avoid timeouts.
 * Recommended for datasets larger than 5,000 rows.
 * 
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The target sheet.
 * @param {number} startRow The 1-indexed starting row (e.g., 2 for data below headers).
 * @param {number} startCol The 1-indexed starting column.
 * @param {Array<Array<string|number>>} values The 2D array of values to write (must be single column for this specific helper, or multi-column if consistent). 
 *                                             Actually, let's make it generic for any 2D array.
 * @param {number} [chunkSize=5000] The number of rows to write per batch.
 */
function writeValuesToSheetSafe(sheet, startRow, startCol, values, chunkSize = 5000) {
  if (!values || values.length === 0) {
    Logger.log("writeValuesToSheetSafe: No values to write.");
    return;
  }
  
  if (startCol < 1) {
    Logger.log("writeValuesToSheetSafe: Column is disabled (startCol < 1). Skipping write operation entirely.");
    return;
  }

  const totalRows = values.length;
  const totalCols = values[0].length;
  
  Logger.log(`Starting batch write of ${totalRows} rows to column ${startCol}...`);

  for (let i = 0; i < totalRows; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    
    // Calculate range: Row = startRow + i, Col = startCol, Height = chunk.length, Width = totalCols
    sheet.getRange(startRow + i, startCol, chunk.length, totalCols).setValues(chunk);
    
    SpreadsheetApp.flush(); // Commit this chunk
    Logger.log(`Written batch: Rows ${i + 1} to ${i + chunk.length}`);
  }
  
  Logger.log("Batch write completed.");
}
