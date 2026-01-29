/**
 * @file GoogleAnalyticsData.gs
 * @description Fetches item and account metrics from Google Analytics 4 (GA4) and writes them to the spreadsheet.
 * This script is optimized for background execution, uses a configuration sheet, and relies on CommonUtilities.gs.
 *
 * Changelog (v2.1 - Bug Fix):
 * - Renamed all internal helper functions with a "_GA4_" suffix to prevent naming collisions with
 * other scripts in the global scope (e.g., ShopifyData.gs, WooCommerceData.gs).
 *
 * Changelog (v2.0 - Optimized):
 * - Refactored into smaller, single-responsibility functions for clarity and maintainability.
 * - Added a main try-catch block for robust error handling.
 */

// --- Script-level Constants (with unique names) ---
const GA4_CONFIG_SHEET_NAME = 'Config';
const GA4_ANALYTICS_SHEET_NAME = 'Analytics';
const GA4_ACCOUNT_DATA_SHEET_NAME = 'AccountData';

// --- GA4 Report Configuration ---
const GA4_API_LIMIT = 25000; // Max rows to request per API call

/**
 * Main orchestrator function to run the GA4 report generation process.
 */
function runGA4Report() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // --- 1. Load and Validate Configuration ---
    const configSheet = spreadsheet.getSheetByName(GA4_CONFIG_SHEET_NAME);
    if (!configSheet) {
      throw new Error(`Configuration sheet "${GA4_CONFIG_SHEET_NAME}" does not exist.`);
    }

    // Assumes CommonUtilities.gs is available
    const SCRIPT_CONFIGS = loadConfigurationsFromSheetObject(configSheet);
    const propertyId = getConfigValue(SCRIPT_CONFIGS, "GA4 propertyId", 'string');
    const timeframe = getConfigValue(SCRIPT_CONFIGS, "Timeframe", 'int', 90); // Use general timeframe

    if (!propertyId) {
      throw new Error(`Configuration "GA4 propertyId" is missing or invalid in '${GA4_CONFIG_SHEET_NAME}'.`);
    }
    if (timeframe <= 0) {
      throw new Error(`Configuration "Timeframe" must be a positive number in '${GA4_CONFIG_SHEET_NAME}'.`);
    }

    // --- 2. Calculate Date Ranges ---
    const today = new Date();
    const endDateMain = formatDateForGA4(today);
    const startDateMainObj = new Date(today);
    startDateMainObj.setDate(startDateMainObj.getDate() - timeframe + 1);
    const startDateMain = formatDateForGA4(startDateMainObj);

    const endDate14Days = formatDateForGA4(today);
    const start14DaysObj = new Date(today);
    start14DaysObj.setDate(start14DaysObj.getDate() - 14 + 1);
    const startDate14Days = formatDateForGA4(start14DaysObj);

    Logger.log(`GA4 Report Config: Timeframe ${timeframe} days. Main range: ${startDateMain} to ${endDateMain}.`);

    // --- 3. Fetch Data ---
    const itemRevenue14DayMap = fetch14DayRevenue_GA4_(propertyId, startDate14Days, endDate14Days);
    const mainReportResults = fetchAndProcessMainReport_GA4_(propertyId, startDateMain, endDateMain, itemRevenue14DayMap);
    const accountSummaryData = fetchAccountSummaryData_GA4_(propertyId, startDateMain, endDateMain);

    // --- 4. Write Results to Sheets ---
    const displayTimeframe = `${formatDisplayDate(startDateMainObj)} - ${formatDisplayDate(today)}`;
    writeResultsToSheets_GA4_(spreadsheet, mainReportResults, accountSummaryData, displayTimeframe);

    Logger.log('GA4 report generation completed successfully.');

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runGA4Report: ${e.message}\nStack: ${e.stack}`);
  }
}

/**
 * Fetches the "Revenue last 14 days" for all items.
 * @private
 * @param {string} propertyId The GA4 property ID.
 * @param {string} startDate The start date in 'YYYY-MM-DD' format.
 * @param {string} endDate The end date in 'YYYY-MM-DD' format.
 * @return {Object<string, number>} A map of item ID to its 14-day revenue.
 */
function fetch14DayRevenue_GA4_(propertyId, startDate, endDate) {
  const itemRevenue14DayMap = {};
  try {
    const request = {
      dimensions: [{ "name": "itemId" }],
      metrics: [{ "name": "itemRevenue" }],
      dateRanges: [{ "startDate": startDate, "endDate": endDate }],
      limit: GA4_API_LIMIT
    };

    const report = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    if (report.rows) {
      report.rows.forEach(row => {
        const itemId = row.dimensionValues[0].value;
        const revenue = parseFloatSafe(row.metricValues[0].value, 0.0);
        itemRevenue14DayMap[itemId] = revenue;
      });
    }
    Logger.log(`Fetched 14-day revenue for ${Object.keys(itemRevenue14DayMap).length} items.`);
  } catch (e) {
    Logger.log(`Warning: Could not fetch GA4 14-day item revenue. Proceeding without this data. Error: ${e.message}`);
  }
  return itemRevenue14DayMap;
}

/**
 * Fetches the main item report and processes the data.
 * @private
 * @param {string} propertyId The GA4 property ID.
 * @param {string} startDate The start date for the main report.
 * @param {string} endDate The end date for the main report.
 * @param {Object<string, number>} itemRevenue14DayMap A map of item IDs to their 14-day revenue.
 * @return {{analyticsSheetRows: Array<Array<any>>, totals: object}} Processed rows for the sheet and summary totals.
 */
function fetchAndProcessMainReport_GA4_(propertyId, startDate, endDate, itemRevenue14DayMap) {
  const request = {
    dimensions: [{ "name": "itemId" }, { "name": "itemName" }, { "name": "itemCategory" }],
    metrics: [{ "name": "itemRevenue" }, { "name": "itemsViewed" }, { "name": "itemsAddedToCart" }, { "name": "itemsPurchased" }],
    dateRanges: [{ "startDate": startDate, "endDate": endDate }],
    limit: GA4_API_LIMIT,
    orderBys: [{ "metric": { "metricName": "itemRevenue" }, "desc": true }]
  };

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
  const analyticsSheetRows = [];
  const totals = { totalRevenue: 0, itemsViewed: 0, itemsAddedToCart: 0, itemsPurchased: 0 };

  if (report.rows) {
    report.rows.forEach(row => {
      const itemId = row.dimensionValues[0].value;
      const itemName = row.dimensionValues[1].value;
      const itemCategory = row.dimensionValues[2] ? row.dimensionValues[2].value : "N/A";
      const itemRevenue = parseFloatSafe(row.metricValues[0].value, 0.0);
      const itemsViewed = parseIntSafe(row.metricValues[1].value, 0);
      const itemsAddedToCart = parseIntSafe(row.metricValues[2].value, 0);
      const itemsPurchased = parseIntSafe(row.metricValues[3].value, 0);

      totals.totalRevenue += itemRevenue;
      totals.itemsViewed += itemsViewed;
      totals.itemsAddedToCart += itemsAddedToCart;
      totals.itemsPurchased += itemsPurchased;

      const revenue14Days = itemRevenue14DayMap[itemId] || 0;
      analyticsSheetRows.push([itemId, itemName, itemCategory, "N/A", "N/A", itemsPurchased, itemRevenue, revenue14Days, "N/A", "N/A"]);
    });
  } else {
    Logger.log('No item data rows returned from GA4 for the main specified period.');
  }

  return { analyticsSheetRows, totals };
}

/**
 * Fetches the account-level summary data from GA4.
 * @private
 * @param {string} propertyId The GA4 property ID.
 * @param {string} startDate The start date for the summary report.
 * @param {string} endDate The end date for the summary report.
 * @return {object} An object containing the processed account summary metrics.
 */
function fetchAccountSummaryData_GA4_(propertyId, startDate, endDate) {
  const request = {
    metrics: [{ "name": "totalUsers" }, { "name": "averagePurchaseRevenuePerUser" }, { "name": "purchaseRevenue" }, { "name": "transactions" }],
    dateRanges: [{ "startDate": startDate, "endDate": endDate }]
  };

  const report = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
  const summary = { totalUsers: 0, avgRevenuePerUser: 0, purchaseRevenue: 0, totalTransactions: 0 };

  if (report.rows && report.rows.length > 0) {
    const row = report.rows[0];
    summary.totalUsers = parseIntSafe(row.metricValues[0].value, 0);
    summary.avgRevenuePerUser = parseFloatSafe(row.metricValues[1].value, 0.0);
    summary.purchaseRevenue = parseFloatSafe(row.metricValues[2].value, 0.0);
    summary.totalTransactions = parseIntSafe(row.metricValues[3].value, 0);
  } else {
    Logger.log('No account summary data returned from GA4.');
  }
  return summary;
}

/**
 * Writes all fetched and processed GA4 data to the respective sheets.
 * @private
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet The active spreadsheet object.
 * @param {object} mainReportResults The results from fetchAndProcessMainReport_GA4_.
 * @param {object} accountSummaryData The results from fetchAccountSummaryData_GA4_.
 * @param {string} displayTimeframe The formatted date range string for display.
 */
function writeResultsToSheets_GA4_(spreadsheet, mainReportResults, accountSummaryData, displayTimeframe) {
  // --- Write to Analytics Sheet ---
  const analyticsSheet = getOrCreateSheet(spreadsheet, GA4_ANALYTICS_SHEET_NAME);
  analyticsSheet.clearContents();
  const analyticsHeaders = ["Product ID", "Product Name", "Product Category", "Product Price", "Total Orders", "Total Items Sold", "Total Revenue", "Revenue last 14 days", "Stock Status", "Stock Quantity"];
  analyticsSheet.getRange(1, 1, 1, analyticsHeaders.length).setValues([analyticsHeaders]).setFontWeight("bold").setHorizontalAlignment("center");

  if (mainReportResults.analyticsSheetRows.length > 0) {
    const dataRange = analyticsSheet.getRange(2, 1, mainReportResults.analyticsSheetRows.length, analyticsHeaders.length);
    dataRange.setValues(mainReportResults.analyticsSheetRows);
    analyticsSheet.getRange(2, 6, mainReportResults.analyticsSheetRows.length, 1).setNumberFormat("#,##0");   // Total Items Sold
    analyticsSheet.getRange(2, 7, mainReportResults.analyticsSheetRows.length, 2).setNumberFormat("#,##0.00"); // Revenues
  }

  // --- Write to AccountData Sheet ---
  const accountDataSheet = getOrCreateSheet(spreadsheet, GA4_ACCOUNT_DATA_SHEET_NAME);
  if (accountDataSheet.getMaxRows() >= 8) {
      accountDataSheet.getRange("A7:J8").clearContent();
  }

  const accountHeaders = ["Timeframe (GA4)", "Total Users (GA4)", "Total Transactions (GA4)", "Total Purchase Revenue (GA4)", "Avg Revenue/User (GA4)", "Total Item Revenue (Calculated)", "Total Items Purchased (Calculated)", "Total Items Viewed (Calculated)", "Total Items Added to Cart (Calculated)", "Last Run (GA4)"];
  const accountValues = [
    displayTimeframe,
    accountSummaryData.totalUsers,
    accountSummaryData.totalTransactions,
    accountSummaryData.purchaseRevenue,
    accountSummaryData.avgRevenuePerUser,
    mainReportResults.totals.totalRevenue,
    mainReportResults.totals.itemsPurchased,
    mainReportResults.totals.itemsViewed,
    mainReportResults.totals.itemsAddedToCart,
    formatDisplayDateTime(new Date())
  ];

  accountDataSheet.getRange(7, 1, 1, accountHeaders.length).setValues([accountHeaders]).setFontWeight("bold").setHorizontalAlignment("center");
  accountDataSheet.getRange(8, 1, 1, accountValues.length).setValues([accountValues]);

  accountDataSheet.getRange(8, 2, 1, 2).setNumberFormat("#,##0");
  accountDataSheet.getRange(8, 4, 1, 3).setNumberFormat("#,##0.00");
  accountDataSheet.getRange(8, 7, 1, 3).setNumberFormat("#,##0");
}
