/**
 * @file calculateAvailableVariantsLabel.gs
 * @description Calculates a label showing the ratio of in-stock variants to total variants purely in memory.
 */

const VARIANTS_ID_INPUT_HEADER = "id";
const VARIANTS_STOCK_INPUT_HEADER = "Stock Status";
const VARIANTS_OUTPUT_LABEL_HEADER = "LABEL_AVAILABLE_VARIANTS";
const VARIANTS_IN_STOCK_TEXTS = ["instock", "in stock"];

/**
 * Main orchestrator function to run the available variants label calculation.
 */
function runAvailableVariantsLabel(data, headers, globalConfig) {
  try {
    const columnIndices = getVariantColumnIndices_(headers);

    // --- 1. Gather Parent Product Statistics (First Pass) ---
    const parentStats = gatherParentStats_(data, columnIndices);

    // --- 2. Generate Labels (Second Pass) ---
    const labels = generateVariantLabels_(data, columnIndices, parentStats);

    const headerName = getConfigValue(globalConfig, VARIANTS_OUTPUT_LABEL_HEADER, 'string', VARIANTS_OUTPUT_LABEL_HEADER);
    
    return {
      headers: [headerName],
      labels: labels
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runAvailableVariantsLabel: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getVariantColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(VARIANTS_ID_INPUT_HEADER),
    stockStatus: headers.indexOf(VARIANTS_STOCK_INPUT_HEADER),
  };

  if (indices.id === -1) {
    throw new Error(`Required column "${VARIANTS_ID_INPUT_HEADER}" not found.`);
  }
  return indices;
}

/**
 * Extracts the parent product ID.
 */
function extractParentId_(fullIdString) {
  if (!fullIdString || typeof fullIdString !== 'string') return null;
  const match = fullIdString.match(/(.*)_(\d+)$/);
  return (match ? match[1] : fullIdString).toLowerCase();
}

/**
 * First pass: Iterates through data to calculate total and in-stock variants.
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
  
  return parentStats;
}

/**
 * Second pass: Creates an array of labels for each row.
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
