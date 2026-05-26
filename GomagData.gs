/**
 * @file GomagData.gs
 * @description Gomag fetcher using the same resumable worker pattern as WooCommerce and Shopify.
 */

'use strict';

const GOMAG_DATA_SHEET_NAME = "Gomag";
const GOMAG_ACCOUNT_SHEET_NAME = "Overview";
const GOMAG_DEBUG_SHEET_NAME = "Gomag_Debug";
const GOMAG_TEMP_FILENAME = "temp_gomag_batch_data.json";
const GOMAG_MAX_EXECUTION_TIME_MS = 1000 * 60 * 4;
const GOMAG_PAGE_SIZE = 100;
const GOMAG_API_BASE_URL = "https://api.gomag.ro/api/v1";
const GOMAG_USER_AGENT = "PerformanceLabels-GoogleAppsScript/1.0";
const GOMAG_MIN_READ_REMAINING = 1;

const GOMAG_HEADERS = [
  "Product ID", "Product Name", "Product Category", "Product Price", "Date Created",
  "Total Orders", "Total Items Sold", "Total Revenue", "Revenue last 14 days",
  "Stock Status", "Stock Quantity", "Gomag Internal ID", "SKU", "EAN"
];

const GOMAG_MAX_UNMATCHED_SAMPLES = 25;
const GOMAG_MAX_ORDER_PRODUCT_LOOKUPS_PER_TICK = 80;

function startGomagReport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.error("Could not obtain lock to start Gomag report.");
    return;
  }

  try {
    resetGomagScript_();

    const config = loadGomagConfig_();
    const startState = {
      phase: 'FETCH_PRODUCTS',
      page: 1,
      writeStartIndex: 0,
      startTime: new Date().getTime(),
      uniqueOrdersCount: 0,
      totalRevenue: 0,
      totalItemsSold: 0,
      unmatchedOrderItems: 0,
      unmatchedOrderSamples: [],
      currentOrderIndex: 0,
      currentOrderItemIndex: 0,
      productLookupsThisTick: 0,
      status: "Starting..."
    };

    const props = PropertiesService.getScriptProperties();
    props.setProperty('GOMAG_BATCH_STATE', JSON.stringify(startState));
    props.setProperty('GOMAG_WORKER_STATUS', 'ACTIVE');

    saveGomagDataToDrive_({});
    logGomagStatus_("STARTED", `Job initialized. ID mode: ${config.idMode}.`);
    try { SpreadsheetApp.getActiveSpreadsheet().toast("Gomag Job Initiated."); } catch(e) {}

    processGomagWorker();

  } catch (e) {
    console.error("Error starting Gomag report: " + e.message);
    logGomagStatus_("ERROR", "Start failed: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

function processGomagWorker() {
  const props = PropertiesService.getScriptProperties();
  const status = props.getProperty('GOMAG_WORKER_STATUS');
  if (status !== 'ACTIVE') return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    processGomagBatchCore_();
  } catch (e) {
    console.error("Gomag Worker Error: " + e.message);
    logGomagStatus_("ERROR", e.message);
  } finally {
    lock.releaseLock();
  }
}

function forceResumeGomagReport() {
  PropertiesService.getScriptProperties().setProperty('GOMAG_WORKER_STATUS', 'ACTIVE');
  processGomagWorker();
}

function processGomagBatchCore_() {
  const executionStart = new Date().getTime();
  const props = PropertiesService.getScriptProperties();
  const rawState = props.getProperty('GOMAG_BATCH_STATE');
  let state = rawState ? JSON.parse(rawState) : null;
  let productMap = null;

  if (!state) {
    props.setProperty('GOMAG_WORKER_STATUS', 'IDLE');
    return;
  }

  try {
    state.productLookupsThisTick = 0;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = loadGomagConfig_();
    productMap = loadGomagDataFromDrive_();

    if (state.phase === 'FETCH_PRODUCTS') {
      executeGomagFetchProductsPhase_(config, state, productMap, executionStart);
    }

    if (state.phase === 'FETCH_ORDERS' && !isGomagTimeUp_(executionStart)) {
      executeGomagFetchOrdersPhase_(config, state, productMap, executionStart);
    }

    if (state.phase === 'WRITE_DATA' && !isGomagTimeUp_(executionStart)) {
      executeGomagWriteDataPhase_(config, state, productMap, executionStart, ss);
      return;
    }

    saveGomagDataToDrive_(productMap);
    props.setProperty('GOMAG_BATCH_STATE', JSON.stringify(state));

  } catch (e) {
    if (productMap && state) {
      try {
        saveGomagDataToDrive_(productMap);
        props.setProperty('GOMAG_BATCH_STATE', JSON.stringify(state));
      } catch (saveError) {
        console.error("Failed to preserve Gomag state after error: " + saveError.message);
      }
    }
    console.error("Gomag Core Error: " + e.message);
    logGomagStatus_("ERROR", e.message);
    props.setProperty('GOMAG_WORKER_STATUS', 'IDLE');
  }
}

function executeGomagFetchProductsPhase_(config, state, productMap, executionStart) {
  logGomagStatus_("RUNNING", `Fetching Gomag products (Page ${state.page})...`);

  while (!isGomagTimeUp_(executionStart)) {
    const endpoint = `${GOMAG_API_BASE_URL}/product/read/json?page=${state.page}&limit=${GOMAG_PAGE_SIZE}&addVersions=true`;
    const response = fetchGomagJson_(endpoint, config);
    const products = extractGomagItems_(response, ['products', 'data', 'items']);

    if (products.length === 0 && state.page === 1) {
      writeGomagDebug_(response, endpoint, 'products');
      throw new Error(`Gomag returned 0 products on page 1. Open ${GOMAG_DEBUG_SHEET_NAME} to inspect the API response shape.`);
    }

    products.forEach(product => {
      addGomagProductToMap_(productMap, product, config);
    });

    logGomagStatus_("RUNNING", `Fetched Gomag products page ${state.page}: ${products.length} items.`);

    if (products.length < GOMAG_PAGE_SIZE) {
      state.phase = 'FETCH_ORDERS';
      state.page = 1;
      return;
    }

    state.page++;
  }
}

function executeGomagFetchOrdersPhase_(config, state, productMap, executionStart) {
  logGomagStatus_("RUNNING", `Fetching Gomag orders (Page ${state.page})...`);

  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - config.days * 86400000);
  const day14 = new Date(endDate.getTime() - 14 * 86400000);
  const start = Utilities.formatDate(startDate, timeZone, "yyyy-MM-dd");
  const end = Utilities.formatDate(endDate, timeZone, "yyyy-MM-dd");

  while (!isGomagTimeUp_(executionStart)) {
    const endpoint = `${GOMAG_API_BASE_URL}/order/read/json?startDate=${start}&endDate=${end}&page=${state.page}&limit=${GOMAG_PAGE_SIZE}`;
    const response = fetchGomagJson_(endpoint, config);
    const orders = extractGomagItems_(response, ['orders', 'data', 'items']);

    const completedPage = processGomagOrdersPage_(orders, productMap, state, config, day14, executionStart);

    logGomagStatus_("RUNNING", `Fetched Gomag orders page ${state.page}: ${orders.length} orders.`);

    if (!completedPage) {
      logGomagStatus_("PAUSED", `Paused orders page ${state.page} at order ${state.currentOrderIndex || 0}.`);
      return;
    }

    state.currentOrderIndex = 0;
    state.currentOrderItemIndex = 0;
    state.productLookupsThisTick = 0;

    if (orders.length < GOMAG_PAGE_SIZE) {
      state.phase = 'WRITE_DATA';
      state.writeStartIndex = 0;
      return;
    }

    state.page++;
  }
}

function executeGomagWriteDataPhase_(config, state, productMap, executionStart, ss) {
  const props = PropertiesService.getScriptProperties();
  const sheet = getOrCreateSheet(ss, GOMAG_DATA_SHEET_NAME);
  const products = getUniqueGomagProducts_(productMap);

  if (state.writeStartIndex === 0) {
    sheet.clear();
    sheet.getRange(1, 1, 1, GOMAG_HEADERS.length)
      .setValues([GOMAG_HEADERS])
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  }

  const rows = products.map(p => [
    p.id, p.name, p.category, p.price, p.dateCreated,
    p.orders, p.sold, p.rev, p.rev14, p.stockStatus, p.stockQty,
    p.internalId, p.sku, p.ean
  ]).sort((a, b) => b[7] - a[7]);

  if (rows.length > 0) {
    const chunkSize = 1500;
    let doneWriting = true;

    for (let i = state.writeStartIndex; i < rows.length; i += chunkSize) {
      if (isGomagTimeUp_(executionStart)) {
        logGomagStatus_("PAUSED", `Writing paused at row ${i}.`);
        state.writeStartIndex = i;
        doneWriting = false;
        break;
      }

      const chunk = rows.slice(i, i + chunkSize);
      sheet.getRange(2 + i, 1, chunk.length, GOMAG_HEADERS.length).setValues(chunk);
      SpreadsheetApp.flush();
      logGomagStatus_("WRITING", `Writing rows ${i} - ${i + chunk.length}...`);
    }

    if (doneWriting) {
      sheet.getRange(2, 4, rows.length, 1).setNumberFormat('#,##0.00');
      sheet.getRange(2, 8, rows.length, 2).setNumberFormat('#,##0.00');
    }

    if (!doneWriting) {
      saveGomagDataToDrive_(productMap);
      props.setProperty('GOMAG_BATCH_STATE', JSON.stringify(state));
      return;
    }
  }

  const allProducts = products;
  let oosWithSalesCount = 0;
  let totalWithSalesCount = 0;

  allProducts.forEach(product => {
    if (product.rev > 0) {
      totalWithSalesCount++;
      if (String(product.stockStatus || "").toLowerCase() !== "instock") {
        oosWithSalesCount++;
      }
    }
  });

  const oosPercent = totalWithSalesCount > 0
    ? ((oosWithSalesCount / totalWithSalesCount) * 100).toFixed(1) + "%"
    : "0%";

  updateDashboardMetrics(ss, GOMAG_ACCOUNT_SHEET_NAME, {
    kind: 'store',
    rev: state.totalRevenue,
    orders: state.uniqueOrdersCount,
    products: allProducts.length,
    oosCount: oosWithSalesCount,
    oosPercent: oosPercent
  });

  appendToOverviewLog(
    ss,
    GOMAG_ACCOUNT_SHEET_NAME,
    `Gomag Sync (${config.days}d)`,
    "SUCCESS",
    `Fetched ${allProducts.length} items. Fetched individually: ${state.productsFetchedByOrder || 0}. Unmatched order items: ${state.unmatchedOrderItems || 0}`,
    config.days
  );

  writeGomagUnmatchedDiagnostics_(ss, state);

  logGomagStatus_("COMPLETED", "Finished successfully.");
  resetGomagScript_();
  props.setProperty('GOMAG_WORKER_STATUS', 'IDLE');

  if (props.getProperty('SKIP_LABELS_ONCE') === 'true') {
    props.deleteProperty('SKIP_LABELS_ONCE');
    Logger.log("Skipping Label Calculations because Platform Data Only was requested.");
    return;
  }

  try {
    Logger.log("Triggering Label Calculations...");
    runAllLabelCalculations();
  } catch (e) {
    console.error("Failed to trigger labels: " + e.message);
  }
}

function addGomagProductToMap_(productMap, product, config) {
  const versions = Array.isArray(product.versions) && product.versions.length > 0
    ? product.versions
    : (Array.isArray(product.variations) && product.variations.length > 0
      ? product.variations
      : [product]);

  versions.forEach(version => {
    const productData = normalizeGomagProduct_(product, version, config);
    indexGomagProduct_(productMap, productData);
  });
}

function indexGomagProduct_(productMap, productData) {
  if (!productData._canonicalKey) {
    productData._canonicalKey = `product_${Object.keys(productMap).length}_${productData.internalId || productData.sku || productData.ean || productData.id || ""}`;
  }

  const keys = [
    productData._canonicalKey,
    productData.internalId,
    productData.sku,
    productData.ean,
    productData.id
  ]
    .map(value => String(value || "").trim())
    .filter(Boolean);

  keys.forEach(key => {
    productMap[key] = productData;
  });
}

function getUniqueGomagProducts_(productMap) {
  const seen = {};
  return Object.values(productMap).filter(product => {
    const key = product._canonicalKey || product.internalId || product.sku || product.ean || product.id || JSON.stringify(product);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function normalizeGomagProduct_(product, version, config) {
  const internalId = String(firstDefinedGomag_(version.id, version.product, version.productId, product.id, product.product, product.productId, "") || "");
  const sku = String(firstDefinedGomag_(version.sku, product.sku, "") || "");
  const ean = String(firstDefinedGomag_(version.ean, product.ean, "") || "");
  const id = resolveGomagProductId_(config.idMode, internalId, sku, ean);
  const price = resolveGomagPrice_(version, product);

  return {
    id: id,
    name: resolveGomagLocalized_(firstDefinedGomag_(version.name, product.name, "")),
    category: resolveGomagCategory_(product.categories),
    price: price,
    dateCreated: firstDefinedGomag_(version.created, product.created, product.date_created, product.dateCreated, product.created_at, product.date, product.updated, ""),
    orders: 0,
    sold: 0,
    rev: 0,
    rev14: 0,
    stockStatus: firstDefinedGomag_(version.stockStatus, version.stock_status, product.stockStatus, product.stock_status, ""),
    stockQty: parseIntSafe(firstDefinedGomag_(version.stock, product.stock, 0), 0),
    internalId: internalId,
    sku: sku,
    ean: ean
  };
}

function processGomagOrdersPage_(orders, productMap, state, config, day14, executionStart) {
  const startOrderIndex = parseIntSafe(state.currentOrderIndex, 0);

  for (let orderIndex = startOrderIndex; orderIndex < orders.length; orderIndex++) {
    const completedOrder = processGomagOrder_(orders[orderIndex], productMap, state, config, day14, executionStart, orderIndex);
    if (!completedOrder) return false;

    state.currentOrderIndex = orderIndex + 1;
    state.currentOrderItemIndex = 0;
  }

  return true;
}

function processGomagOrder_(order, productMap, state, config, day14, executionStart, orderIndex) {
  if (parseIntSafe(state.currentOrderItemIndex, 0) === 0) {
    state.uniqueOrdersCount++;
  }

  const orderDate = parseGomagDate_(firstDefinedGomag_(order.date, order.created_at, order.created, order.dateCreated, ""));
  const products = Array.isArray(order.products) && order.products.length > 0
    ? order.products
    : (Array.isArray(order.items) && order.items.length > 0
      ? order.items
      : (Array.isArray(order.line_items) && order.line_items.length > 0
        ? order.line_items
        : normalizeGomagCollection_(firstDefinedGomag_(order.items, order.products, order.line_items, []))));

  const startItemIndex = parseIntSafe(state.currentOrderItemIndex, 0);

  for (let itemIndex = startItemIndex; itemIndex < products.length; itemIndex++) {
    if (isGomagTimeUp_(executionStart)) {
      state.currentOrderIndex = orderIndex;
      state.currentOrderItemIndex = itemIndex;
      return false;
    }

    const item = products[itemIndex];
    let product = findGomagProductForOrderItem_(item, productMap);

    if (!product) {
      if ((state.productLookupsThisTick || 0) >= GOMAG_MAX_ORDER_PRODUCT_LOOKUPS_PER_TICK) {
        state.currentOrderIndex = orderIndex;
        state.currentOrderItemIndex = itemIndex;
        return false;
      }

      product = fetchAndIndexGomagProductForOrderItem_(item, productMap, state, config);
      state.productLookupsThisTick = (state.productLookupsThisTick || 0) + 1;

      if (product) {
        state.productsFetchedByOrder = (state.productsFetchedByOrder || 0) + 1;
      } else {
        state.unmatchedOrderItems = (state.unmatchedOrderItems || 0) + 1;
        collectGomagUnmatchedOrderSample_(state, order, item);
        continue;
      }
    }

    const qty = parseIntSafe(firstDefinedGomag_(item.quantity, item.qty, 0), 0);
    const lineRevenue = resolveGomagLineRevenue_(item, qty);

    product.rev += lineRevenue;
    product.sold += qty;
    product.orders += 1;
    state.totalRevenue += lineRevenue;
    state.totalItemsSold += qty;

    if (orderDate && orderDate >= day14) {
      product.rev14 += lineRevenue;
    }
  }

  return true;
}

function fetchAndIndexGomagProductForOrderItem_(item, productMap, state, config) {
  const internalId = resolveGomagOrderInternalId_(item);
  const sku = String(firstDefinedGomag_(item.sku, item.SKU, item.product_sku, item.productSku, item.code, "") || "").trim();
  const lookupKey = internalId ? `id:${internalId}` : (sku ? `sku:${sku}` : "");
  if (!lookupKey) return null;

  state.gomagProductLookupMisses = state.gomagProductLookupMisses || {};
  if (state.gomagProductLookupMisses[lookupKey]) return null;

  const query = internalId
    ? `id=${encodeURIComponent(internalId)}`
    : `sku=${encodeURIComponent(sku)}`;
  const endpoint = `${GOMAG_API_BASE_URL}/product/read/json?${query}&addVersions=true&limit=${GOMAG_PAGE_SIZE}`;

  try {
    const response = fetchGomagJson_(endpoint, config);
    const products = extractGomagItems_(response, ['products', 'data', 'items']);
    products.forEach(product => addGomagProductToMap_(productMap, product, config));

    const product = findGomagProductForOrderItem_(item, productMap);
    if (product) return product;
  } catch (e) {
    console.warn(`Failed to fetch Gomag product for order item ${lookupKey}: ${e.message}`);
  }

  state.gomagProductLookupMisses[lookupKey] = true;
  return null;
}

function findGomagProductForOrderItem_(item, productMap) {
  const internalId = resolveGomagOrderInternalId_(item);
  if (internalId && productMap[internalId]) return productMap[internalId];

  const sku = String(firstDefinedGomag_(item.sku, item.SKU, item.product_sku, item.productSku, item.code, "") || "").trim();
  const ean = String(firstDefinedGomag_(item.ean, item.EAN, item.product_ean, item.productEan, "") || "").trim();
  const outputId = String(firstDefinedGomag_(item.id, item.product_id, item.productId, "") || "").trim();

  return (sku && productMap[sku]) ||
    (ean && productMap[ean]) ||
    (outputId && productMap[outputId]) ||
    null;
}

function collectGomagUnmatchedOrderSample_(state, order, item) {
  state.unmatchedOrderSamples = state.unmatchedOrderSamples || [];
  if (state.unmatchedOrderSamples.length >= GOMAG_MAX_UNMATCHED_SAMPLES) return;

  state.unmatchedOrderSamples.push({
    orderId: firstDefinedGomag_(order.id, order.number, ""),
    itemId: firstDefinedGomag_(item.id, item.product, item.productId, item.product_id, item.productID, item.id_product, ""),
    sku: firstDefinedGomag_(item.sku, item.SKU, item.product_sku, item.productSku, item.code, ""),
    ean: firstDefinedGomag_(item.ean, item.EAN, item.product_ean, item.productEan, ""),
    name: firstDefinedGomag_(item.name, item.product_name, ""),
    keys: Object.keys(item || {}).join(", "),
    raw: JSON.stringify(item).substring(0, 1000)
  });
}

function writeGomagUnmatchedDiagnostics_(ss, state) {
  const samples = state.unmatchedOrderSamples || [];
  if (!state.unmatchedOrderItems || samples.length === 0) return;

  const sheet = getOrCreateSheet(ss, GOMAG_DEBUG_SHEET_NAME);
  sheet.clear();

  const headers = ["Order ID", "Item ID", "SKU", "EAN", "Name", "Item Keys", "Raw Item Preview"];
  const rows = samples.map(sample => [
    sample.orderId,
    sample.itemId,
    sample.sku,
    sample.ean,
    sample.name,
    sample.keys,
    sample.raw
  ]);

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(6, 320);
  sheet.setColumnWidth(7, 600);
  sheet.getRange(2, 7, rows.length, 1).setWrap(true);
}

function resolveGomagOrderInternalId_(item) {
  const internalId = String(firstDefinedGomag_(item.product, item.productId, item.product_id, item.productID, item.id_product, item.id, "") || "");
  return internalId.trim();
}

function resolveGomagProductId_(idMode, internalId, sku, ean) {
  if (idMode === "product_id") return String(internalId || "").trim();
  if (idMode === "ean") return String(ean || "").trim();
  return String(sku || "").trim();
}

function resolveGomagPrice_(version, product) {
  const specialPrice = parseFloatSafe(firstDefinedGomag_(version.specialPrice, version.special_price, product.specialPrice, product.special_price, ""), 0);
  if (specialPrice > 0) return specialPrice;
  return parseFloatSafe(firstDefinedGomag_(version.price, product.price, version.base_price, product.base_price, 0), 0);
}

function resolveGomagLineRevenue_(item, qty) {
  const directTotal = parseFloatSafe(firstDefinedGomag_(item.total, item.total_price, item.totalPrice, item.value, item.subtotal, item.final_price, ""), NaN);
  if (!isNaN(directTotal)) return directTotal;
  return parseFloatSafe(firstDefinedGomag_(item.price, item.product_price, item.unit_price, 0), 0) * qty;
}

function fetchGomagJson_(endpoint, config, retries = 3) {
  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'Apikey': config.apiKey,
      'ApiShop': config.apiShop,
      'User-Agent': GOMAG_USER_AGENT
    }
  };

  for (let i = 0; i < retries; i++) {
    try {
      const response = UrlFetchApp.fetch(endpoint, options);
      const code = response.getResponseCode();
      const body = response.getContentText();
      const headers = normalizeGomagHeaders_(response.getHeaders());
      const rateLimit = getGomagReadRateLimit_(headers);

      if (code >= 200 && code < 300) {
        const parsed = JSON.parse(body);
        throwIfGomagApiError_(parsed);
        throttleGomagReadRate_(rateLimit);
        return parsed;
      }

      if (i < retries - 1 && (code === 429 || code >= 500)) {
        throttleGomagReadRate_(rateLimit, true);
        if (code !== 429) Utilities.sleep(1000 * Math.pow(2, i));
        continue;
      }

      throw new Error(`Gomag API returned ${code}${formatGomagRateLimit_(rateLimit)}: ${body.substring(0, 300)}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      Utilities.sleep(1000 * Math.pow(2, i));
    }
  }

  throw new Error(`Failed to fetch Gomag endpoint: ${endpoint}`);
}

function normalizeGomagHeaders_(headers) {
  const normalized = {};
  Object.keys(headers || {}).forEach(key => {
    normalized[String(key).toLowerCase()] = headers[key];
  });
  return normalized;
}

function getGomagReadRateLimit_(headers) {
  return {
    read: parseFloatSafe(headers['api-ratelimit-read'], NaN),
    burst: parseIntSafe(headers['api-ratelimit-read-burst'], NaN),
    remaining: parseIntSafe(headers['api-ratelimit-read-remaining'], NaN)
  };
}

function throttleGomagReadRate_(rateLimit, forceWait) {
  const remaining = rateLimit ? rateLimit.remaining : NaN;
  const readRate = rateLimit ? rateLimit.read : NaN;
  const shouldWait = forceWait || (!isNaN(remaining) && remaining <= GOMAG_MIN_READ_REMAINING);
  if (!shouldWait) return;

  const waitMs = !isNaN(readRate) && readRate > 0
    ? Math.ceil(1000 / readRate)
    : 1000;
  Utilities.sleep(Math.min(Math.max(waitMs, 1000), 10000));
}

function formatGomagRateLimit_(rateLimit) {
  if (!rateLimit) return "";
  const parts = [];
  if (!isNaN(rateLimit.read)) parts.push(`read=${rateLimit.read}/s`);
  if (!isNaN(rateLimit.burst)) parts.push(`burst=${rateLimit.burst}`);
  if (!isNaN(rateLimit.remaining)) parts.push(`remaining=${rateLimit.remaining}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function throwIfGomagApiError_(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return;

  const rawError = firstDefinedGomag_(response.error, response.status, "");
  const message = firstDefinedGomag_(response.message, response.error_message, response.errorMessage, "");

  if (!message) return;
  if (String(rawError || "").trim() === "" && !/error|eroare|permisi/i.test(String(message))) return;

  const code = String(rawError || "").trim();
  throw new Error(`Gomag API error${code ? ` ${code}` : ""}: ${message}`);
}

function writeGomagDebug_(response, endpoint, phase) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, GOMAG_DEBUG_SHEET_NAME);
    sheet.clear();

    const responseText = JSON.stringify(response, null, 2);
    const rows = [
      ["Checked At", new Date()],
      ["Phase", phase],
      ["Endpoint", endpoint],
      ["Top-level Keys", summarizeGomagKeys_(response)],
      ["total", response && response.total !== undefined ? response.total : ""],
      ["page", response && response.page !== undefined ? response.page : ""],
      ["pages", response && response.pages !== undefined ? response.pages : ""],
      ["products type", describeGomagValue_(response && response.products)],
      ["data type", describeGomagValue_(response && response.data)],
      ["response type", describeGomagValue_(response && response.response)],
      ["Preview", responseText.substring(0, 45000)]
    ];

    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 700);
    sheet.getRange("A:A").setFontWeight("bold");
    sheet.getRange("B11").setWrap(true);
  } catch (e) {
    console.warn("Failed to write Gomag debug sheet: " + e.message);
  }
}

function summarizeGomagKeys_(value) {
  if (!value || typeof value !== 'object') return "";
  return Object.keys(value).slice(0, 30).join(", ");
}

function describeGomagValue_(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== 'object') return String(value === undefined ? "" : value);
  const keys = Object.keys(value);
  return `object(${keys.length}) keys: ${keys.slice(0, 12).join(", ")}`;
}

function extractGomagItems_(response, preferredKeys) {
  if (Array.isArray(response)) return response;

  for (let i = 0; i < preferredKeys.length; i++) {
    const value = response && response[preferredKeys[i]];
    const nestedItems = extractNestedGomagCollection_(value, preferredKeys);
    if (nestedItems.length > 0) return nestedItems;

    const items = normalizeGomagCollection_(value);
    if (items.length > 0) return items;
  }

  if (response && response.data) {
    const nestedItems = extractNestedGomagCollection_(response.data, preferredKeys);
    if (nestedItems.length > 0) return nestedItems;

    const dataItems = normalizeGomagCollection_(response.data);
    if (dataItems.length > 0) return dataItems;

    for (const key in response.data) {
      const items = normalizeGomagCollection_(response.data[key]);
      if (items.length > 0) return items;
    }
  }

  if (response && response.response) {
    const responseItems = normalizeGomagCollection_(response.response);
    if (responseItems.length > 0) return responseItems;

    for (const key in response.response) {
      const items = normalizeGomagCollection_(response.response[key]);
      if (items.length > 0) return items;
    }
  }

  for (const key in response) {
    const items = normalizeGomagCollection_(response[key]);
    if (items.length > 0) return items;
  }

  return [];
}

function extractNestedGomagCollection_(value, preferredKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  for (let i = 0; i < preferredKeys.length; i++) {
    const nestedValue = value[preferredKeys[i]];
    const items = normalizeGomagCollection_(nestedValue);
    if (items.length > 0) return items;
  }

  return [];
}

function normalizeGomagCollection_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
  if (typeof value !== 'object') return [];

  if (isGomagRecord_(value)) return [value];

  return Object.keys(value)
    .map(key => value[key])
    .filter(item => item && typeof item === 'object');
}

function isGomagRecord_(value) {
  if (!value || typeof value !== 'object') return false;
  const recordKeys = [
    'id', 'sku', 'name', 'products', 'items', 'line_items',
    'versions', 'variations', 'price', 'stock', 'stockStatus'
  ];
  return recordKeys.some(key => value[key] !== undefined);
}

function resolveGomagLocalized_(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value.ro) return String(value.ro);

  for (const key in value) {
    if (value[key]) return String(value[key]);
  }

  return "";
}

function resolveGomagCategory_(categories) {
  if (!categories) return "N/A";

  if (!Array.isArray(categories) && typeof categories === 'object') {
    const firstKey = Object.keys(categories)[0];
    categories = firstKey ? categories[firstKey] : [];
  }

  if (!Array.isArray(categories) || categories.length === 0) return "N/A";
  const firstPath = categories[0];

  if (Array.isArray(firstPath)) {
    return firstPath.map(resolveGomagLocalized_).filter(String).join(" > ") || "N/A";
  }

  if (firstPath && typeof firstPath === 'object') {
    return resolveGomagLocalized_(firstDefinedGomag_(firstPath.name, firstPath.title, firstPath));
  }

  return resolveGomagLocalized_(firstPath) || "N/A";
}

function parseGomagDate_(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.valueOf()) ? null : date;
}

function firstDefinedGomag_() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== null && arguments[i] !== undefined && arguments[i] !== "") {
      return arguments[i];
    }
  }
  return "";
}

function loadGomagConfig_() {
  const appConfig = getAppConfig();
  const props = PropertiesService.getScriptProperties();
  const apiShop = props.getProperty('GOMAG_API_SHOP');
  const apiKey = props.getProperty('GOMAG_API_KEY');
  const idMode = props.getProperty('CFG_GOMAG_ID_MODE') || appConfig.Gomag.ProductIdMode || 'sku';

  if (!apiShop || !apiKey) {
    throw new Error("Missing Gomag settings. Open Performance Labels > Setup Guide and complete ApiShop and Apikey.");
  }

  if (!["sku", "product_id", "ean"].includes(idMode)) {
    throw new Error(`Invalid Gomag Product ID Mode: ${idMode}`);
  }

  return {
    apiShop: apiShop,
    apiKey: apiKey,
    idMode: idMode,
    days: appConfig.TimeframeDays
  };
}

function logGomagStatus_(status, message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    updateDashboardStatus(ss, GOMAG_ACCOUNT_SHEET_NAME, status, message);
  } catch(e) {
    console.warn("Failed to update Gomag status: " + e.message);
  }
}

function resetGomagScript_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('GOMAG_TEMP_FILE_ID');
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {}
    props.deleteProperty('GOMAG_TEMP_FILE_ID');
  }
  props.deleteProperty('GOMAG_BATCH_STATE');
}

function isGomagTimeUp_(startTime) {
  return (new Date().getTime() - startTime) > GOMAG_MAX_EXECUTION_TIME_MS;
}

function saveGomagDataToDrive_(data) {
  const content = JSON.stringify(data);
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('GOMAG_TEMP_FILE_ID');

  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setContent(content);
      return;
    } catch (e) {
      console.warn("Could not write to existing Gomag temp file. Creating a new one.");
    }
  }

  const file = DriveApp.createFile(GOMAG_TEMP_FILENAME, content, MimeType.PLAIN_TEXT);
  props.setProperty('GOMAG_TEMP_FILE_ID', file.getId());
}

function loadGomagDataFromDrive_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = props.getProperty('GOMAG_TEMP_FILE_ID');

  if (fileId) {
    try {
      return JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
    } catch (e) {
      console.error("Failed to load Gomag temp data: " + e.message);
    }
  }

  return {};
}
