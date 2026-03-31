/**
 * @file calculateRevenueLabel.gs
 * @description Calculates and applies two revenue-based labels based on data array:
 * 1. LABEL_REVENUE_ADVANCED: Compares product revenue to the account average (low/avg/high).
 * 2. LABEL_REVENUE_SIMPLE: Indicates if a product has any revenue (has_revenue/no_revenue).
 */

const REVENUE_ID_INPUT_HEADER = "id";
const REVENUE_TOTAL_INPUT_HEADER = "Revenue";
const REVENUE_ADVANCED_OUTPUT_HEADER = "LABEL_REVENUE_ADVANCED";
const REVENUE_SIMPLE_OUTPUT_HEADER = "LABEL_REVENUE_SIMPLE";

/**
 * Main orchestrator function to run the revenue label calculation in memory.
 */
function runRevenueLabels(data, headers, globalConfig) {
  try {
    const config = {
      lowThreshold: getConfigValue(globalConfig, "Low Revenue Threshold", 'float', 50.0) / 100,
      highThreshold: getConfigValue(globalConfig, "High Revenue Threshold", 'float', 150.0) / 100,
    };

    const columnIndices = getRevenueColumnIndices_(headers);
    
    // --- 1. Calculate Account Average Revenue (First Pass) ---
    const accountAverageRevenue = calculateAccountAverageRevenue_(data, columnIndices);

    // --- 2. Generate Labels (Second Pass) ---
    const labels = generateRevenueLabels_(data, columnIndices, config, accountAverageRevenue);

    const advancedHeaderName = getConfigValue(globalConfig, REVENUE_ADVANCED_OUTPUT_HEADER, 'string', REVENUE_ADVANCED_OUTPUT_HEADER);
    const simpleHeaderName = getConfigValue(globalConfig, REVENUE_SIMPLE_OUTPUT_HEADER, 'string', REVENUE_SIMPLE_OUTPUT_HEADER);

    return {
      headers: [advancedHeaderName, simpleHeaderName],
      labels: labels
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runRevenueLabels: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getRevenueColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(REVENUE_ID_INPUT_HEADER),
    totalRevenue: headers.indexOf(REVENUE_TOTAL_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * First pass: Calculates the account-wide average revenue for products that have revenue.
 */
function calculateAccountAverageRevenue_(data, columnIndices) {
  let totalRevenueSum = 0;
  let itemsWithRevenueCount = 0;

  data.forEach(row => {
    if (row[columnIndices.id]) { // Only consider rows with an ID
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
