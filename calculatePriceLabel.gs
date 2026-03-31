/**
 * @file calculatePriceLabel.gs
 * @description Calculates a price interval label (e.g., "price_0_50") based on product price purely in-memory.
 */

const PRICE_ID_INPUT_HEADER = "id";
const PRICE_INPUT_HEADER = "Price";
const PRICE_OUTPUT_LABEL_HEADER = "LABEL_PRICE_INTERVAL";

/**
 * Main orchestrator function to run the price interval label calculation in memory.
 */
function runPriceLabels(data, headers, globalConfig) {
  try {
    const priceIntervalStep = getConfigValue(globalConfig, "Price Interval Step", 'float', 50.0);

    if (priceIntervalStep <= 0) {
      throw new Error(`Configuration "Price Interval Step" must be a positive number.`);
    }

    const columnIndices = getPriceColumnIndices_(headers);
    const labels = generatePriceLabels_(data, columnIndices, priceIntervalStep);

    const headerName = getConfigValue(globalConfig, PRICE_OUTPUT_LABEL_HEADER, 'string', PRICE_OUTPUT_LABEL_HEADER);
    
    return {
      headers: [headerName],
      labels: labels
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runPriceLabels: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getPriceColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(PRICE_ID_INPUT_HEADER),
    productPrice: headers.indexOf(PRICE_INPUT_HEADER),
  };

  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required columns not found: ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Iterates through data and generates a price interval label for each row.
 */
function generatePriceLabels_(data, columnIndices, step) {
  return data.map(row => {
    if (!row[columnIndices.id]) {
      return [""]; 
    }

    const price = parseFloatSafe(row[columnIndices.productPrice], -1);
    
    if (price < 0) {
      return ["invalid_price_data"];
    }
    
    const label = determinePriceIntervalLabel_(price, step);
    return [label];
  });
}

/**
 * Determines the price interval label for a single product.
 */
function determinePriceIntervalLabel_(price, step) {
  const min = Math.floor(price / step) * step;
  const max = min + step;
  return `price_${min.toFixed(0)}_${max.toFixed(0)}`;
}
