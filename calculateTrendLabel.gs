/**
 * @file calculateTrendLabel.gs
 * @description Calculates a sales trend label purely in memory.
 */

const TREND_ID_INPUT_HEADER = "id";
const TREND_TOTAL_REVENUE_HEADER = "Revenue";
const TREND_14_DAY_REVENUE_HEADER = "Revenue last 14 days"; 
const TREND_ORDERS_INPUT_HEADER = "Orders";
const TREND_OUTPUT_LABEL_HEADER = "LABEL_TREND";

const TREND_THRESHOLD_PERCENT = 0.20; // 20%

/**
 * Main orchestrator function to run the trend label calculation.
 */
function runTrendLabelCalculation(data, headers, globalConfig) {
  try {
    const timeframeDays = getConfigValue(globalConfig, "Timeframe", 'int', 30);
    const orderThreshold = getConfigValue(globalConfig, "Nr. of Orders Threshold", 'int', 0);

    if (timeframeDays <= 0) {
      throw new Error(`Configuration "Timeframe" must be a positive number.`);
    }

    const columnIndices = getTrendColumnIndices_(headers);
    
    // --- 1. Generate Labels ---
    const labels = generateTrendLabels_(data, columnIndices, timeframeDays, orderThreshold);

    const headerName = getConfigValue(globalConfig, TREND_OUTPUT_LABEL_HEADER, 'string', TREND_OUTPUT_LABEL_HEADER);
    
    return {
      headers: [headerName],
      labels: labels
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runTrendLabelCalculation: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getTrendColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(TREND_ID_INPUT_HEADER),
    totalRevenue: headers.indexOf(TREND_TOTAL_REVENUE_HEADER),
    revenue14Days: headers.indexOf(TREND_14_DAY_REVENUE_HEADER),
    totalOrders: headers.indexOf(TREND_ORDERS_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Iterates through data and generates a trend label for each row.
 */
function generateTrendLabels_(data, columnIndices, timeframeDays, orderThreshold) {
  return data.map(row => {
    if (!row[columnIndices.id]) {
      return [""]; 
    }

    const totalRevenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    const revenue14Days = parseFloatSafe(row[columnIndices.revenue14Days], 0.0);
    const totalOrders = parseIntSafe(row[columnIndices.totalOrders], 0);

    const potentialTrend = determinePotentialTrend_(totalRevenue, revenue14Days, timeframeDays);
    const finalLabel = applyOrderThresholdToTrend_(potentialTrend, totalOrders, orderThreshold);

    return [finalLabel];
  });
}

/**
 * Determines the potential trend (up, down, stable) based on revenue comparison.
 */
function determinePotentialTrend_(totalRevenue, revenue14Days, timeframeDays) {
  const daysForOlderPeriod = timeframeDays - 14;

  if (daysForOlderPeriod <= 0) {
    return revenue14Days > 0 ? "recent_activity_only" : "no_trend";
  }

  const revenueForOlderPeriod = totalRevenue - revenue14Days;
  if (revenueForOlderPeriod < 0) {
    return "no_trend";
  }

  const avgDailyRevenue14Days = revenue14Days / 14;
  const avgDailyRevenueOlderPeriod = revenueForOlderPeriod / daysForOlderPeriod;

  if (avgDailyRevenueOlderPeriod > 0) {
    const ratio = avgDailyRevenue14Days / avgDailyRevenueOlderPeriod;
    if (ratio > (1 + TREND_THRESHOLD_PERCENT)) return "up_trend";
    if (ratio < (1 - TREND_THRESHOLD_PERCENT)) return "down_trend";
    return "stable_trend";
  }

  if (avgDailyRevenue14Days > 0) {
    return "up_trend";
  }
  
  return "no_trend";
}

/**
 * Adjusts a potential trend label based on the order threshold.
 */
function applyOrderThresholdToTrend_(potentialTrend, totalOrders, orderThreshold) {
  if (potentialTrend === "up_trend" || potentialTrend === "down_trend") {
    if (totalOrders >= orderThreshold) {
      return potentialTrend;
    } else {
      return "stable_trend"; 
    }
  }
  return potentialTrend;
}
