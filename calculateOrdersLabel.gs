/**
 * @file calculateOrdersLabel.gs
 * @description Calculates and applies order volume labels ("no_orders", "low_orders", etc.)
 * purely in-memory.
 */

const ORDERS_ID_INPUT_HEADER = "id";
const ORDERS_COUNT_INPUT_HEADER = "Orders";
const ORDERS_REVENUE_INPUT_HEADER = "Revenue";
const ORDERS_OUTPUT_LABEL_HEADER = "LABEL_ORDERS";

/**
 * Main orchestrator function to run the orders label calculation in memory.
 */
function runOrdersLabel(data, headers, globalConfig) {
  try {
    const orderThreshold = getConfigValue(globalConfig, "Nr. of Orders Threshold", 'int', 0);
    const columnIndices = getOrderColumnIndices_(headers);
    const labels = generateOrderLabels_(data, columnIndices, orderThreshold);

    const headerName = getConfigValue(globalConfig, ORDERS_OUTPUT_LABEL_HEADER, 'string', ORDERS_OUTPUT_LABEL_HEADER);
    
    return {
      headers: [headerName],
      labels: labels
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runOrdersLabel: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getOrderColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(ORDERS_ID_INPUT_HEADER),
    totalOrders: headers.indexOf(ORDERS_COUNT_INPUT_HEADER),
    totalRevenue: headers.indexOf(ORDERS_REVENUE_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Iterates through data, parses values, and generates a label for each row.
 */
function generateOrderLabels_(data, columnIndices, orderThreshold) {
  return data.map(row => {
    if (!row[columnIndices.id]) {
      return [""]; // Return blank for empty rows to maintain alignment
    }

    const orders = parseIntSafe(row[columnIndices.totalOrders], 0);
    const revenue = parseFloatSafe(row[columnIndices.totalRevenue], 0.0);
    
    const label = determineOrderLabel_(orders, revenue, orderThreshold);
    return [label];
  });
}

/**
 * Determines the order volume label for a single product.
 */
function determineOrderLabel_(orders, revenue, threshold) {
  if (revenue <= 0) {
    return "no_orders";
  }

  if (orders === 0) {
    return "no_orders";
  }
  if (orders === 1) {
    return "one_order";
  }
  if (threshold > 0 && orders >= threshold) {
    return "high_orders";
  }
  
  return "average_orders";
}
