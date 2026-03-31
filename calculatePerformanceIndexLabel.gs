/**
 * @file calculatePerformanceIndexLabel.gs
 * @description Calculates a performance index label based on ROAS, cost, and order count purely in memory.
 */

const PERF_OUTPUT_LABEL_HEADER = "LABEL_PERFORMANCE_INDEX";
const PERF_SITE_ROAS_HEADER = "Site ROAS";

/**
 * Main orchestrator function to run the performance index label calculation.
 */
function runPerformanceIndexLabel(data, headers, globalConfig) {
  try {
    const config = {
      roasFactorIndex: getConfigValue(globalConfig, "Index ROAS Factor", 'float', 1.5),
      ordersThresholdIndex: getConfigValue(globalConfig, "Index Orders Threshold", 'int', 2),
      roasFactorNearIndex: getConfigValue(globalConfig, "Near Index ROAS Factor", 'float', 1.0),
      roasFactorExclude: getConfigValue(globalConfig, "Exclude ROAS Factor", 'float', 0.6),
      costToPriceRatioExclude: getConfigValue(globalConfig, "Exclude Cost/Price Ratio", 'float', 0.8),
      absoluteCostExclude: getConfigValue(globalConfig, "Exclude Absolute Cost", 'int', 50),
    };

    const columnIndices = getColumnIndices_(headers);

    // --- 1. Calculate Account Averages ---
    const accountAvgROAS = calculateAccountAverages_(data, columnIndices);

    // --- 2. Process Products and Generate Labels ---
    const results = processProductsAndGetLabels_(data, columnIndices, config, accountAvgROAS);

    const roasHeaderName = getConfigValue(globalConfig, PERF_SITE_ROAS_HEADER, 'string', PERF_SITE_ROAS_HEADER);
    const labelHeaderName = getConfigValue(globalConfig, PERF_OUTPUT_LABEL_HEADER, 'string', PERF_OUTPUT_LABEL_HEADER);

    return {
      headers: [roasHeaderName, labelHeaderName],
      labels: results
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runPerformanceIndexLabel: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf("id"),
    cost: headers.indexOf("Cost"),
    productPrice: headers.indexOf("Price"),
    totalRevenue: headers.indexOf("Revenue"),
    totalOrders: headers.indexOf("Orders"),
  };
  
  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Calculates the account-wide average ROAS.
 */
function calculateAccountAverages_(data, columnIndices) {
  let totalRevenue = 0;
  let totalCost = 0;

  data.forEach(row => {
    if (row[columnIndices.id]) {
      totalRevenue += parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
      totalCost += parseFloatSafe(row[columnIndices.cost], 0.0);
    }
  });

  return totalCost > 0 ? totalRevenue / totalCost : 0;
}

/**
 * Iterates through products, calculates their ROAS, determines their label.
 */
function processProductsAndGetLabels_(data, columnIndices, config, accountAvgROAS) {
  const results = [];

  data.forEach(row => {
    if (!row[columnIndices.id]) {
      results.push(["", ""]); 
      return;
    }

    const cost = parseFloatSafe(row[columnIndices.cost], 0.0);
    const revenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    const price = parseFloatSafe(row[columnIndices.productPrice], 0.0);
    const orders = parseIntSafe(row[columnIndices.totalOrders], 0);

    const productROAS = cost > 0 ? revenue / cost : revenue;

    const label = determinePerformanceLabel_(productROAS, orders, cost, price, config, accountAvgROAS);
    results.push([productROAS.toFixed(2), label]);
  });

  return results;
}

/**
 * Determines the performance label for a single product.
 */
function determinePerformanceLabel_(productROAS, orders, cost, price, config, accountAvgROAS) {
  if ((cost === 0 && orders === 0) || (cost < 1.5 && orders === 0)) {
    return "NO-INDEX";
  }

  if (productROAS > (accountAvgROAS * config.roasFactorIndex) && orders > config.ordersThresholdIndex) {
    return "INDEX";
  }

  const isCostHigh = (price > 0 && cost > (price * config.costToPriceRatioExclude)) || (cost > config.absoluteCostExclude);
  if (productROAS < (accountAvgROAS * config.roasFactorExclude) && isCostHigh) {
    return "EXCLUDE-INDEX";
  }

  if (productROAS > (accountAvgROAS * config.roasFactorNearIndex)) {
    return "NEAR-INDEX";
  }

  return "LOW-INDEX";
}
