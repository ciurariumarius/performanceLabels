/**
 * @file calculateNewProductLabel.gs
 * @description Calculates a "new product" label purely in memory.
 */

const NEW_PROD_ID_INPUT_HEADER = "id"; 
const NEW_PROD_DATE_INPUT_HEADER = "Date Created";
const NEW_PROD_OUTPUT_LABEL_HEADER = "LABEL_NEW";

const NEW_PRODUCT_LABEL = "new_product";
const OLDER_PRODUCT_LABEL = ""; 

/**
 * Main orchestrator function to run the new product label calculation.
 */
function runNewProductLabelCalculation(data, headers, globalConfig) {
  try {
    const newProductDays = getConfigValue(globalConfig, "New Product Days", 'int', 30);

    if (newProductDays <= 0) {
      throw new Error(`Configuration "New Product Days" must be a positive number.`);
    }

    const columnIndices = getNewProdColumnIndices_(headers);
    const labels = generateNewProductLabels_(data, columnIndices, newProductDays);

    const headerName = getConfigValue(globalConfig, NEW_PROD_OUTPUT_LABEL_HEADER, 'string', NEW_PROD_OUTPUT_LABEL_HEADER);
    
    return {
      headers: [headerName],
      labels: labels
    };

  } catch (e) {
    Logger.log(`CRITICAL ERROR in runNewProductLabelCalculation: ${e.message}\nStack: ${e.stack}`);
    return null;
  }
}

/**
 * Gets and validates the indices of required columns.
 */
function getNewProdColumnIndices_(headers) {
  const indices = {
    id: headers.indexOf(NEW_PROD_ID_INPUT_HEADER),
    dateCreated: headers.indexOf(NEW_PROD_DATE_INPUT_HEADER),
  };

  if (indices.id === -1) {
    throw new Error(`Required column "${NEW_PROD_ID_INPUT_HEADER}" not found.`);
  }
  if (indices.dateCreated === -1) {
    throw new Error(`Required column "${NEW_PROD_DATE_INPUT_HEADER}" not found.`);
  }
  return indices;
}

/**
 * Iterates through data and generates a "new product" label for each row.
 */
function generateNewProductLabels_(data, columnIndices, newProductDays) {
  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(today.getDate() - newProductDays);
  cutoffDate.setHours(0, 0, 0, 0); 

  return data.map((row, index) => {
    if (!row[columnIndices.id]) {
      return [""]; 
    }

    const dateCreatedValue = row[columnIndices.dateCreated];
    let label = OLDER_PRODUCT_LABEL; 

    if (dateCreatedValue) {
      const productCreationDate = new Date(dateCreatedValue);
      if (!isNaN(productCreationDate.valueOf())) {
        if (productCreationDate >= cutoffDate) {
          label = NEW_PRODUCT_LABEL;
        }
      } else {
        label = "invalid_date"; 
      }
    }
    
    return [label];
  });
}
