const METRICS_SHEET_NAME = "Metrics";
const LABELS_SHEET_NAME = "GMC_Feed";
const LABELS_SHEET_2_NAME = "GMC_Feed_2";
const GADS_SHEET_NAME_SOURCE = "GAds";
const SHOPIFY_SHEET_NAME_SOURCE = "Shopify";
const WOOCOMMERCE_SHEET_NAME_SOURCE = "WooCommerce";
const GOMAG_SHEET_NAME_SOURCE = "Gomag";

const METRICS_HEADERS = [
  "id", "Title", "Date Created", "Price", "Revenue", "Revenue last 14 days", "Orders", "Stock Status", "Stock Qty",
  "Impressions", "Clicks", "Cost", "Conversions", "Conv Value",
  "Calculated On"
];

function runAllLabelCalculations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try { updateDashboardStatus(ss, "Overview", "RUNNING", "Consolidating Metrics..."); } catch(e) {}
  
  Logger.log("--- Starting Data Consolidation ---");
  consolidateMetrics(ss);
  
  Logger.log("--- Loading Metrics into Memory ---");
  const metricsSheet = getOrCreateSheet(ss, METRICS_SHEET_NAME);
  const lastRow = metricsSheet.getLastRow();
  
  if (lastRow < 2) {
    Logger.log("No data found in Metrics sheet. Aborting labels.");
    try { updateDashboardStatus(ss, "Overview", "COMPLETED", "No data to process."); } catch(e) {}
    return;
  }
  
  const lastCol = metricsSheet.getLastColumn();
  const rawHeaders = metricsSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rawData = metricsSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const globalConfig = loadConfigurationsFromSheetObject(null);

  Logger.log("--- Starting Label Calculations IN-MEMORY ---");
  
  const idIndex = rawHeaders.indexOf("id");
  if (idIndex === -1) {
    throw new Error('Required Metrics column "id" was not found. Cannot build feed labels safely.');
  }
  const allHeaders = ["id"]; 
  const allLabels = rawData.map(row => [row[idIndex]]); // Initialize with IDs

  const calculationErrors = [];

  // Helper to aggregate results block by block
  const addResult = (result, name) => {
    if (!result || !result.headers || !result.labels) {
      Logger.log(`Skipping output for ${name} due to missing result or error.`);
      return;
    }
    const enabledColumns = result.headers
      .map((header, index) => ({ header: String(header || "").trim(), index }))
      .filter(column => column.header !== "");

    if (enabledColumns.length === 0) {
      Logger.log(`Skipping output for ${name} because all mapped output columns are disabled.`);
      return;
    }

    allHeaders.push(...enabledColumns.map(column => column.header));
    for (let i = 0; i < rawData.length; i++) {
      const rowLabels = result.labels[i] || [];
      allLabels[i].push(...enabledColumns.map(column => rowLabels[column.index] || ""));
    }
    Logger.log(`Successfully calculated ${name} labels.`);
  };

  const runCalculation = (name, fn) => {
    try {
      addResult(fn(), name);
    } catch(e) {
      calculationErrors.push(`${name}: ${e.message}`);
      Logger.log(`Error in ${name}: ${e.message}`);
    }
  };

  runCalculation("Revenue", () => runRevenueLabels(rawData, rawHeaders, globalConfig));
  runCalculation("Price", () => runPriceLabels(rawData, rawHeaders, globalConfig));
  runCalculation("Orders", () => runOrdersLabel(rawData, rawHeaders, globalConfig));
  runCalculation("Variants", () => runAvailableVariantsLabel(rawData, rawHeaders, globalConfig));
  runCalculation("Performance", () => runPerformanceIndexLabel(rawData, rawHeaders, globalConfig));
  runCalculation("Trend", () => runTrendLabelCalculation(rawData, rawHeaders, globalConfig));
  runCalculation("New Product", () => runNewProductLabelCalculation(rawData, rawHeaders, globalConfig));
  runCalculation("GAds", () => runGoogleAdsLabelCalculation(rawData, rawHeaders, globalConfig));
  
  Logger.log("--- Writing All Labels to Sheet ---");
  const labelsSheet = getOrCreateSheet(ss, LABELS_SHEET_NAME);
  labelsSheet.clear();
  labelsSheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]).setFontWeight("bold");
  labelsSheet.getRange("A1").setNote(calculationErrors.length > 0
    ? `Partial label calculation. Errors: ${calculationErrors.join(" | ")}`
    : "");
  writeValuesToSheetSafe(labelsSheet, 2, 1, allLabels);
  
  Logger.log("--- Synchronizing Secondary Feed ---");
  try { syncSecondaryFeed_(ss); } catch(e) { Logger.log("Error in Feed Sync: " + e.message); }
  
  Logger.log("--- All Tasks Completed ---");
  try {
    if (calculationErrors.length > 0) {
      const message = `Labels calculated with ${calculationErrors.length} warning(s).`;
      updateDashboardStatus(ss, "Overview", "PARTIAL", message);
      appendToOverviewLog(ss, "Overview", "Label Calculations", "PARTIAL", calculationErrors.slice(0, 5).join(" | "), "-");
    } else {
      updateDashboardStatus(ss, "Overview", "COMPLETED", "All labels calculated.");
      appendToOverviewLog(ss, "Overview", "Label Calculations", "SUCCESS", "All labels calculated successfully.", "-");
    }
  } catch(e) {}
}

function consolidateMetrics(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const shopifySheet = ss.getSheetByName(SHOPIFY_SHEET_NAME_SOURCE);
  const wooSheet = ss.getSheetByName(WOOCOMMERCE_SHEET_NAME_SOURCE);
  const gomagSheet = ss.getSheetByName(GOMAG_SHEET_NAME_SOURCE);
  const gadsSheet = ss.getSheetByName(GADS_SHEET_NAME_SOURCE);
  
  const shopifyData = shopifySheet ? getShopifyData_(shopifySheet) : [];
  const wooData = wooSheet ? getWooData_(wooSheet) : [];
  const gomagData = gomagSheet ? getGomagData_(gomagSheet) : [];
  const gadsMap = gadsSheet ? loadGAdsDataMap_(gadsSheet) : {};
  
  const sourceRows = [...shopifyData, ...wooData, ...gomagData];
  const sourceData = sourceRows.filter(item => item.id);
  const skippedRows = sourceRows.length - sourceData.length;
  Logger.log(`Source rows loaded: Shopify=${shopifyData.length}, WooCommerce=${wooData.length}, Gomag=${gomagData.length}. Usable IDs=${sourceData.length}, skipped blank IDs=${skippedRows}.`);
  logCatalogAuditToOverview_(ss, { shopifyData, wooData, gomagData, sourceRows, sourceData });
  
  const combinedData = sourceData.map(item => {
    const safeId = String(item.id).toLowerCase();
    const gads = gadsMap[safeId] || { imp: 0, click: 0, cost: 0, conv: 0, val: 0 };
    return [
      item.id,
      item.title,
      item.dateCreated,
      item.price,
      item.revenue,
      item.revenue14,
      item.orders,
      item.stockStatus,
      item.stockQty,
      gads.imp,
      gads.click,
      gads.cost,
      gads.conv,
      gads.val,
      new Date()
    ];
  });

  const metricsSheet = getOrCreateSheet(ss, METRICS_SHEET_NAME);
  metricsSheet.clearContents();
  
  metricsSheet.getRange(1, 1, 1, METRICS_HEADERS.length)
    .setValues([METRICS_HEADERS])
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  if (combinedData.length > 0) {
    writeValuesToSheetSafe(metricsSheet, 2, 1, combinedData);
    
    // Formatting
    metricsSheet.getRange(2, 4, combinedData.length, 3).setNumberFormat("#,##0.00"); 
    metricsSheet.getRange(2, 12, combinedData.length, 1).setNumberFormat("#,##0.00"); 
    metricsSheet.getRange(2, 14, combinedData.length, 1).setNumberFormat("#,##0.00"); 
    
    // --- Initialize GMC_Feed_2 (secondary: ID-modified, only created if configured) ---
    // Note: Initialization of the primary feed is skipped here since we do it as one batch write later.
    const config = getAppConfig();
    const prefix = config.IdPrefix || "";
    const suffix = config.IdSuffix || "";
    const hasSecondaryIds = sourceData.some(item => item.secondaryId);
    if (prefix || suffix || hasSecondaryIds) {
      const labelsSheet2 = getOrCreateSheet(ss, LABELS_SHEET_2_NAME);
      labelsSheet2.clear();
      labelsSheet2.getRange(1, 1, 1, 1).setValues([["id"]]).setFontWeight("bold");
      const idColumnData2 = sourceData.map(item => {
        const baseId = item.secondaryId || item.id;
        return [prefix + String(baseId) + suffix];
      });
      writeValuesToSheetSafe(labelsSheet2, 2, 1, idColumnData2);
      Logger.log(`GMC_Feed_2 generated with prefix="${prefix}" suffix="${suffix}" secondaryIds=${hasSecondaryIds}`);
    } else {
      Logger.log("GMC_Feed_2 skipped: no prefix, suffix, or secondary ID mode configured.");
    }
  }
}

/**
 * Copies all label columns from GMC_Feed to GMC_Feed_2.
 * Both sheets are initialized with the same row order.
 */
function syncSecondaryFeed_(ss) {
  const feed1 = ss.getSheetByName(LABELS_SHEET_NAME);
  const feed2 = ss.getSheetByName(LABELS_SHEET_2_NAME);
  
  if (!feed1 || !feed2) return;
  
  const lastCol = feed1.getLastColumn();
  const lastRow = feed1.getLastRow();
  
  if (lastCol <= 1 || lastRow <= 1) return;
  
  // Get all data columns (starting from col 2)
  const range1 = feed1.getRange(1, 2, lastRow, lastCol - 1);
  const values = range1.getValues();
  
  // Paste into feed 2 starting at col 2
  const range2 = feed2.getRange(1, 2, lastRow, lastCol - 1);
  range2.setValues(values);
  
  Logger.log(`Synced ${lastCol - 1} label columns to GMC_Feed_2.`);
}

function getShopifyData_(sheet) {
  return readStoreSourceRows_(sheet, 'Shopify', {
    id: 'Product ID',
    title: ['Product Name', 'Variant Title'],
    dateCreated: 'Date Created',
    price: 'Product Price',
    revenue: 'Total Revenue',
    revenue14: 'Revenue last 14 days',
    orders: 'Total Orders',
    stockStatus: 'Stock Status',
    stockQty: 'Stock Quantity'
  });
}

function getWooData_(sheet) {
  return readStoreSourceRows_(sheet, 'WooCommerce', {
    id: 'Product ID',
    title: 'Product Name',
    dateCreated: 'Date Created',
    price: 'Product Price',
    revenue: 'Total Revenue',
    revenue14: 'Revenue last 14 days',
    orders: 'Total Orders',
    stockStatus: 'Stock Status',
    stockQty: 'Stock Quantity'
  });
}

function getGomagData_(sheet) {
  return readStoreSourceRows_(sheet, 'Gomag', {
    id: 'Product ID',
    secondaryId: 'Secondary Product ID',
    title: 'Product Name',
    dateCreated: 'Date Created',
    price: 'Product Price',
    revenue: 'Total Revenue',
    revenue14: 'Revenue last 14 days',
    orders: 'Total Orders',
    stockStatus: 'Stock Status',
    stockQty: 'Stock Quantity'
  });
}

function loadGAdsDataMap_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const indices = {
    id: headers.indexOf("id"),
    imp: headers.indexOf("Impressions"),
    click: headers.indexOf("Clicks"),
    cost: headers.indexOf("Cost"),
    conv: headers.indexOf("Conversions"),
    val: headers.indexOf("Conv Value")
  };
  
  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`GAds sheet is missing required column(s): ${missing.join(", ")}`);
  }
  const map = {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  data.forEach(row => {
    const id = row[indices.id];
    if (id) {
       map[String(id).toLowerCase()] = {
         imp: parseFloatSafe(row[indices.imp]),
         click: parseFloatSafe(row[indices.click]),
         cost: parseFloatSafe(row[indices.cost]),
         conv: parseFloatSafe(row[indices.conv]),
         val: parseFloatSafe(row[indices.val])
       };
    }
  });
  return map;
}

function readStoreSourceRows_(sheet, sourceName, mapping) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(header => String(header || "").trim());
  const headerMap = {};
  headers.forEach((header, index) => {
    if (header) headerMap[header] = index;
  });

  const optionalHeaders = ['secondaryId'];
  const requiredHeaders = [];
  Object.keys(mapping).forEach(key => {
    if (optionalHeaders.indexOf(key) !== -1) return;
    const value = mapping[key];
    if (Array.isArray(value)) requiredHeaders.push(...value);
    else requiredHeaders.push(value);
  });

  const missing = requiredHeaders.filter(header => headerMap[header] === undefined);
  if (missing.length > 0) {
    throw new Error(`${sourceName} sheet is missing required column(s): ${missing.join(", ")}`);
  }

  const rawData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const get = (row, header) => row[headerMap[header]];

  return rawData.map(row => {
    const title = Array.isArray(mapping.title)
      ? mapping.title.map(header => get(row, header)).filter(Boolean).join(" - ")
      : get(row, mapping.title);

    return {
      source: sourceName,
      id: get(row, mapping.id),
      secondaryId: mapping.secondaryId && headerMap[mapping.secondaryId] !== undefined ? get(row, mapping.secondaryId) : "",
      title: title,
      dateCreated: get(row, mapping.dateCreated),
      price: get(row, mapping.price),
      revenue: get(row, mapping.revenue),
      revenue14: get(row, mapping.revenue14),
      orders: get(row, mapping.orders),
      stockStatus: get(row, mapping.stockStatus),
      stockQty: get(row, mapping.stockQty)
    };
  });
}

function logCatalogAuditToOverview_(ss, audit) {
  const props = PropertiesService.getScriptProperties();
  const sources = [
    ['Shopify', audit.shopifyData],
    ['WooCommerce', audit.wooData],
    ['Gomag', audit.gomagData]
  ];

  const summaries = sources
    .filter(([, rows]) => rows.length > 0)
    .map(([source, rows]) => {
      const usable = rows.filter(item => item.id).length;
      const withOrders = rows.filter(item => item.id && parseIntSafe(item.orders, 0) > 0).length;
      warnOnCatalogDrop_(ss, props, source, usable);
      return `${source}: rows ${rows.length}, usable ${usable}, blank ${rows.length - usable}, with orders ${withOrders}, without orders ${usable - withOrders}`;
    });

  if (summaries.length > 0) {
    try {
      appendToOverviewLog(ss, "Overview", "Catalog Audit", "SUCCESS", summaries.join(" | "), "-");
    } catch(e) {}
  }

  const skippedRows = audit.sourceRows.length - audit.sourceData.length;
  const skipped = audit.sourceRows
    .filter(item => !item.id)
    .slice(0, 5)
    .map(item => [
      item.source || '',
      item.title || '',
      item.price || ''
    ]);

  if (skipped.length > 0) {
    const sampleText = skipped
      .map(sample => `${sample[0] || 'Unknown'}: ${sample[1] || '(no title)'}${sample[2] ? ` (${sample[2]})` : ''}`)
      .join(" | ");
    try {
      appendToOverviewLog(ss, "Overview", "Catalog Audit", "WARNING", `Skipped ${skippedRows} source rows with blank product IDs. Samples: ${sampleText}`, "-");
    } catch(e) {}
  }
}

function warnOnCatalogDrop_(ss, props, source, usableCount) {
  const key = `PL_LAST_USABLE_${String(source || "").toUpperCase()}`;
  const previous = parseIntSafe(props.getProperty(key), 0);

  if (previous > 0 && usableCount > 0 && usableCount < previous * 0.8) {
    try {
      appendToOverviewLog(
        ss,
        "Overview",
        "Catalog Audit",
        "WARNING",
        `${source} usable product IDs dropped from ${previous} to ${usableCount}. Check source fetch completeness.`,
        "-"
      );
    } catch(e) {}
  }

  props.setProperty(key, String(usableCount));
}
