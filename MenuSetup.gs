/**
 * @file MenuSetup.gs
 * @description Creates a custom menu and manages the HTML Settings dialog.
 * Platform is stored in PropertiesService (set via the Settings dialog),
 * falling back to the PLATFORM constant in Config.gs.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the active platform: PropertiesService value takes priority over Config.gs.
 */
function getActivePlatform() {
  const stored = PropertiesService.getScriptProperties().getProperty('PLATFORM');
  return stored || getAppConfig().Platform || '';
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const settingsMenu = ui.createMenu('Settings')
      .addItem('Run Now', 'runActivePlatformOrSetup')
      .addSeparator()
      .addItem('Label Mapping & Thresholds', 'showLabelSettingsDialog')
      .addItem('Platform & Store Setup', 'showSettingsDialog')
      .addItem('Auto-Fetch Setup', 'setupActivePlatformAutoFetch')
      .addSeparator()
      .addItem('Changelog', 'showChangelog');

  ui.createMenu('Performance Labels')
      .addItem('Setup Script', 'showSetupGuide')
      .addItem('Google Ads Script [To Copy]', 'showAdsScriptModal')
      .addSeparator()
      .addSubMenu(settingsMenu)
      .addSeparator()
      .addItem('Labels Documentation', 'showLabelsDocumentation')
      .addItem('Script Documentation', 'showDocumentation')
      .addToUi();
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * The primary entry point for a full system sync.
 * Fetches platform data (which then triggers label calculations automatically).
 */
function runMainSync() {
  runActivePlatformOrSetup();
}

function runActivePlatformOrSetup() {
  const status = getSetupStatus();
  if (!status.platformConfigured || !status.credentials.done) {
    logCentralEvent_({
      component: "Manual Run",
      status: "WARNING",
      details: status.platformConfigured ? status.credentials.detail : "Run Now opened setup because no platform is configured.",
      eventSource: "runActivePlatformOrSetup"
    });
    showSetupGuide();
    return;
  }

  runActivePlatform_(false);
}

function runActivePlatformDataOnly() {
  const status = getSetupStatus();
  if (!status.platformConfigured || !status.credentials.done) {
    showSetupGuide();
    return;
  }

  runActivePlatform_(true);
}

function runActivePlatform_(skipLabelsOnce) {
  const platform = getActivePlatform();
  const props = PropertiesService.getScriptProperties();

  logCentralEvent_({
    component: "Manual Run",
    status: "STARTED",
    details: `Manual run started for ${platform || "unknown platform"}${skipLabelsOnce ? " (platform data only)" : ""}.`,
    timeframe: getAppConfig().TimeframeDays,
    eventSource: "runActivePlatform"
  });

  if (skipLabelsOnce && platform !== 'ga4') {
    props.setProperty('SKIP_LABELS_ONCE', 'true');
  }

  if (platform === 'shopify') {
    ensureActivePlatformWorkerTrigger_(platform);
    startShopifyReport();
  } else if (platform === 'gomag') {
    ensureActivePlatformWorkerTrigger_(platform);
    startGomagReport();
  } else if (platform === 'ga4') {
    runGA4Report();
  } else if (platform === 'woocommerce') {
    ensureActivePlatformWorkerTrigger_(platform);
    startWooCommerceReport();
  } else {
    showSetupGuide();
  }
}

// ---------------------------------------------------------------------------
// Settings Dialog
// ---------------------------------------------------------------------------

function showSetupGuide() {
  const html = HtmlService.createHtmlOutputFromFile('SetupGuide')
      .setTitle('Setup Guide')
      .setWidth(760)
      .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'Setup Guide');
}

function getSetupStatus() {
  const props = PropertiesService.getScriptProperties();
  const platform = getActivePlatform();
  const platformLabels = {
    woocommerce: 'WooCommerce',
    shopify: 'Shopify',
    gomag: 'Gomag',
    ga4: 'Google Analytics 4'
  };

  const credentials = getCredentialStatus_(props, platform);
  const ga4Done = !!props.getProperty('GA4_PROPERTY_ID');
  const autoFetch = getAutoFetchStatus_(platform);

  return {
    platform: platform,
    platformLabel: platformLabels[platform] || 'Not selected',
    platformConfigured: !!platform,
    credentials: credentials,
    ga4: {
      done: ga4Done,
      state: ga4Done ? 'Done' : (platform === 'ga4' ? 'Missing' : 'Optional'),
      detail: ga4Done ? 'GA4 Property ID is saved.' : (platform === 'ga4' ? 'GA4 Property ID is required.' : 'Configure only if you use GA4 reports.')
    },
    labels: {
      done: true,
      state: 'Done',
      detail: 'Defaults are ready. Tune labels and thresholds when needed.'
    },
    adsScript: {
      done: false,
      state: 'Optional',
      detail: 'Copy the Google Ads script if you want Ads metrics in labels.'
    },
    autoFetch: autoFetch
  };
}

function getCredentialStatus_(props, platform) {
  const missing = [];
  const detailByPlatform = {
    woocommerce: 'WooCommerce domain, API key, and API secret are required.',
    shopify: 'Shopify domain, client ID/API key, and client secret are required.',
    gomag: 'Gomag ApiShop and Apikey are required.',
    ga4: 'GA4 Property ID is required.'
  };

  if (!platform) {
    return {
      done: false,
      state: 'Missing',
      detail: 'Choose a platform to start setup.',
      missing: ['Platform']
    };
  }

  if (platform === 'woocommerce') {
    if (!props.getProperty('WOOCOMMERCE_DOMAIN')) missing.push('WooCommerce Domain');
    if (!props.getProperty('WOOCOMMERCE_API_KEY')) missing.push('API Key');
    if (!props.getProperty('WOOCOMMERCE_API_SECRET')) missing.push('API Secret');
  } else if (platform === 'shopify') {
    if (!props.getProperty('SHOPIFY_DOMAIN')) missing.push('Shopify Domain');
    if (!props.getProperty('SHOPIFY_CLIENT_ID')) missing.push('Client ID / API Key');
    if (!props.getProperty('SHOPIFY_CLIENT_SECRET')) missing.push('Client Secret');
  } else if (platform === 'gomag') {
    if (!props.getProperty('GOMAG_API_SHOP')) missing.push('ApiShop');
    if (!props.getProperty('GOMAG_API_KEY')) missing.push('Apikey');
  } else if (platform === 'ga4') {
    if (!props.getProperty('GA4_PROPERTY_ID')) missing.push('GA4 Property ID');
  }

  return {
    done: missing.length === 0,
    state: missing.length === 0 ? 'Done' : 'Missing',
    detail: missing.length === 0 ? `${detailByPlatform[platform]} Saved.` : `Missing: ${missing.join(', ')}.`,
    missing: missing
  };
}

function getAutoFetchStatus_(platform) {
  if (!platform) {
    return {
      done: false,
      state: 'Not scheduled',
      detail: 'Choose a platform before scheduling auto-fetch.'
    };
  }

  return getPlatformTriggerStatus_(platform);
}

function openOverviewSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, "Overview");
  ss.setActiveSheet(sheet);
}

function setupActivePlatformAutoFetch() {
  const status = getSetupStatus();
  if (!status.platformConfigured || !status.credentials.done) {
    logCentralEvent_({
      component: "Auto-Fetch Setup",
      status: "WARNING",
      details: status.platformConfigured ? status.credentials.detail : "Auto-fetch setup opened setup because no platform is configured.",
      eventSource: "setupActivePlatformAutoFetch"
    });
    showSetupGuide();
    return;
  }

  const platform = status.platform;
  if (platform === 'woocommerce') setupWooCommerceComplete();
  else if (platform === 'shopify') setupShopifyComplete();
  else if (platform === 'gomag') setupGomagComplete();
  else if (platform === 'ga4') setupGA4Complete();
}

/**
 * Opens the HTML settings dialog (single screen for platform + all credentials).
 */
function showSettingsDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Settings')
      .setTitle('Platform & Store Setup')
      .setWidth(760)
      .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Platform & Store Setup');
}

/**
 * Called by the HTML dialog on load to pre-fill current values.
 * Never returns secret values — only domains and current platform.
 */
function getCurrentSettingsForDialog() {
  const props = PropertiesService.getScriptProperties();
  const gomagOrderStatuses = parseJsonProperty_(props, 'GOMAG_ORDER_STATUSES', []);

  // Helper: mask a stored value, showing only last 4 chars
  function mask(key) {
    const val = props.getProperty(key);
    return val ? '••••' + val.slice(-4) : '';
  }

  return {
    platform:      getActivePlatform(),
    wooDomain:     props.getProperty('WOOCOMMERCE_DOMAIN')  || '',
    wooKey:        mask('WOOCOMMERCE_API_KEY'),
    wooSecret:     mask('WOOCOMMERCE_API_SECRET'),
    shopifyDomain: props.getProperty('SHOPIFY_DOMAIN')      || '',
    shopifyId:     mask('SHOPIFY_CLIENT_ID'),
    shopifySecret: mask('SHOPIFY_CLIENT_SECRET'),
    shopifyFormat: props.getProperty('CFG_SHOPIFY_FORMAT') || DEFAULT_LABEL_CONFIG.Shopify.ProductIdFormat,
    shopifyCountryCode: props.getProperty('CFG_COUNTRY_CODE') || DEFAULT_LABEL_CONFIG.Shopify.CountryCode,
    matchGAdsIdsEnabled: props.getProperty('CFG_MATCH_GADS_IDS_ENABLED') === 'true',
    matchGAdsIdsMode: props.getProperty('CFG_MATCH_GADS_IDS_MODE') || DEFAULT_LABEL_CONFIG.MatchGAdsIds.Mode,
    gomagApiShop:  props.getProperty('GOMAG_API_SHOP')      || '',
    gomagApiKey:   mask('GOMAG_API_KEY'),
    gomagIdMode:   props.getProperty('CFG_GOMAG_ID_MODE')   || DEFAULT_LABEL_CONFIG.Gomag.ProductIdMode,
    gomagProductScope: props.getProperty('CFG_GOMAG_PRODUCT_SCOPE') || DEFAULT_LABEL_CONFIG.Gomag.ProductScope,
    gomagSecondaryIdMode: props.getProperty('CFG_GOMAG_SECONDARY_ID_MODE') || DEFAULT_LABEL_CONFIG.Gomag.SecondaryFeedIdMode,
    gomagOrderStatuses: gomagOrderStatuses,
    gomagOrderStatusIds: parseCommaList_(props.getProperty('CFG_GOMAG_ORDER_STATUS_IDS') || ''),
    ga4PropertyId: props.getProperty('GA4_PROPERTY_ID')     || ''
  };
}

/**
 * Called by the HTML dialog on save. Persists all non-empty values.
 */
function saveSettingsFromDialog(payload) {
  const props = PropertiesService.getScriptProperties();

  // Platform (always save)
  if (payload.platform) props.setProperty('PLATFORM', payload.platform);

  // WooCommerce
  if (payload.wooDomain)  props.setProperty('WOOCOMMERCE_DOMAIN',     payload.wooDomain);
  if (payload.wooKey)     props.setProperty('WOOCOMMERCE_API_KEY',    payload.wooKey);
  if (payload.wooSecret)  props.setProperty('WOOCOMMERCE_API_SECRET', payload.wooSecret);
  if (payload.platform === 'woocommerce') {
    props.setProperty('CFG_MATCH_GADS_IDS_ENABLED', payload.matchGAdsIdsEnabled ? 'true' : 'false');
    props.setProperty('CFG_MATCH_GADS_IDS_MODE', payload.matchGAdsIdsMode || 'woo_product_id');
  }

  // Shopify
  if (payload.shopifyDomain)  props.setProperty('SHOPIFY_DOMAIN',        payload.shopifyDomain);
  if (payload.shopifyId)      props.setProperty('SHOPIFY_CLIENT_ID',     payload.shopifyId);
  if (payload.shopifySecret)  props.setProperty('SHOPIFY_CLIENT_SECRET', payload.shopifySecret);
  if (payload.platform === 'shopify') {
    props.setProperty('CFG_SHOPIFY_FORMAT', payload.shopifyFormat || DEFAULT_LABEL_CONFIG.Shopify.ProductIdFormat);
    props.setProperty('CFG_COUNTRY_CODE', payload.shopifyCountryCode || DEFAULT_LABEL_CONFIG.Shopify.CountryCode);
    props.setProperty('CFG_MATCH_GADS_IDS_ENABLED', payload.matchGAdsIdsEnabled ? 'true' : 'false');
    props.setProperty('CFG_MATCH_GADS_IDS_MODE', payload.matchGAdsIdsMode || 'shopify_standard');
  }

  // Gomag
  if (payload.gomagApiShop) props.setProperty('GOMAG_API_SHOP', payload.gomagApiShop);
  if (payload.gomagApiKey)  props.setProperty('GOMAG_API_KEY',  payload.gomagApiKey);
  props.setProperty('CFG_GOMAG_ID_MODE', payload.gomagIdMode || DEFAULT_LABEL_CONFIG.Gomag.ProductIdMode);
  if (payload.platform === 'gomag') {
    props.setProperty('CFG_GOMAG_PRODUCT_SCOPE', payload.gomagProductScope || DEFAULT_LABEL_CONFIG.Gomag.ProductScope);
    props.setProperty('CFG_GOMAG_SECONDARY_ID_MODE', payload.gomagSecondaryIdMode || '');
    props.setProperty('CFG_MATCH_GADS_IDS_ENABLED', payload.matchGAdsIdsEnabled ? 'true' : 'false');
    props.setProperty('CFG_MATCH_GADS_IDS_MODE', payload.matchGAdsIdsMode || 'gomag_internal_id');
    props.setProperty('CFG_GOMAG_ORDER_STATUS_IDS', Array.isArray(payload.gomagOrderStatusIds) ? payload.gomagOrderStatusIds.join(',') : '');
    if (props.getProperty('GOMAG_API_SHOP') && props.getProperty('GOMAG_API_KEY')) {
      try {
        refreshGomagOrderStatuses_(loadGomagConfig_());
      } catch (e) {
        console.warn("Could not refresh Gomag order statuses during settings save: " + e.message);
      }
    }
  }

  // Google Analytics
  if (payload.ga4PropertyId) {
    props.setProperty('GA4_PROPERTY_ID', payload.ga4PropertyId);
  } else if (payload.platform === 'ga4') {
    // Note: If they intentionally blank it out, we should probably delete it.
    // However, keeping consistent with the rest of the script that only sets to non-empty.
    // If we want them to clear it, we could use setProperty('GA4_PROPERTY_ID', '') instead.
    props.setProperty('GA4_PROPERTY_ID', payload.ga4PropertyId || '');
  }

  try {
    logCentralEvent_({
      component: "Platform Settings",
      status: "SUCCESS",
      details: `Settings saved for ${payload.platform || getActivePlatform() || "unknown platform"}.`,
      eventSource: "saveSettingsFromDialog"
    });
  } catch (e) {
    console.warn("Central settings logging failed: " + e.message);
  }
}

function parseJsonProperty_(props, key, fallback) {
  try {
    const value = props.getProperty(key);
    return value ? JSON.parse(value) : fallback;
  } catch (e) {
    return fallback;
  }
}

function parseCommaList_(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Label Settings Dialog
// ---------------------------------------------------------------------------

function showLabelSettingsDialog() {
  const html = HtmlService.createHtmlOutputFromFile('LabelSettings')
      .setTitle('Label Mapping & Thresholds')
      .setWidth(880)
      .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Label Mapping & Thresholds');
}

/**
 * Merges PropertiesService with hardcoded Defaults for the Dialog UI
 */
function getLabelSettingsForDialog() {
  const props = PropertiesService.getScriptProperties();
  
  // Helper to fallback to default if property isn't set
  function getProp(key, def) {
    const val = props.getProperty(key);
    return val !== null ? val : def;
  }

  return {
    // Timeframes
    timeframeDays: getProp('CFG_TIMEFRAME_DAYS', DEFAULT_LABEL_CONFIG.TimeframeDays),
    newProductDays: getProp('CFG_NEW_PRODUCT_DAYS', DEFAULT_LABEL_CONFIG.NewProductDays),
    
    // GAds Thresholds
    roasGood: getProp('CFG_ROAS_GOOD', DEFAULT_LABEL_CONFIG.ROAS.Good),
    roasBad: getProp('CFG_ROAS_BAD', DEFAULT_LABEL_CONFIG.ROAS.Bad),
    cvrGood: getProp('CFG_CVR_GOOD', DEFAULT_LABEL_CONFIG.ConversionRate.Good),
    cvrBad: getProp('CFG_CVR_BAD', DEFAULT_LABEL_CONFIG.ConversionRate.Bad),
    clicksHigh: getProp('CFG_CLICKS_HIGH', DEFAULT_LABEL_CONFIG.Clicks.High),
    clicksLow: getProp('CFG_CLICKS_LOW', DEFAULT_LABEL_CONFIG.Clicks.Low),
    
    // Revenue & Prices
    revHigh: getProp('CFG_REV_HIGH', DEFAULT_LABEL_CONFIG.Revenue.HighThresholdPercent),
    revLow: getProp('CFG_REV_LOW', DEFAULT_LABEL_CONFIG.Revenue.LowThresholdPercent),
    minOrders: getProp('CFG_MIN_ORDERS', DEFAULT_LABEL_CONFIG.Orders.Threshold),
    priceStep: getProp('CFG_PRICE_STEP', DEFAULT_LABEL_CONFIG.PriceIntervalStep),
    
    // Secondary feed ID styling
    idPrefix: getProp('CFG_ID_PREFIX', DEFAULT_LABEL_CONFIG.IdPrefix),
    idSuffix: getProp('CFG_ID_SUFFIX', DEFAULT_LABEL_CONFIG.IdSuffix),
    
    // Output Labels
    outGAdsRoas: getProp('CFG_OUT_ROAS', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_GADS_ROAS),
    outGAdsCvr: getProp('CFG_OUT_CVR', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_GADS_CONV_RATE),
    outGAdsClicks: getProp('CFG_OUT_CLICKS', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_GADS_CLICKS),
    outRevSimple: getProp('CFG_OUT_REV_SIMPLE', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_REVENUE_SIMPLE),
    outRevAdvanced: getProp('CFG_OUT_REV_ADV', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_REVENUE_ADVANCED),
    outPriceInterval: getProp('CFG_OUT_PRICE', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_PRICE_INTERVAL),
    outOrders: getProp('CFG_OUT_ORDERS', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_ORDERS),
    outVariants: getProp('CFG_OUT_VARIANTS', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_AVAILABLE_VARIANTS),
    outTrend: getProp('CFG_OUT_TREND', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_TREND),
    outNewProduct: getProp('CFG_OUT_NEW', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_NEW),
    outPerfIndex: getProp('CFG_OUT_PERF', DEFAULT_LABEL_CONFIG.LabelsMapping.LABEL_PERFORMANCE_INDEX),
  };
}

function saveLabelSettingsFromDialog(payload) {
  const props = PropertiesService.getScriptProperties();
  
  // Set all properties, even if empty strings exist (since empty is valid for prefixes/labels)
  props.setProperty('CFG_TIMEFRAME_DAYS', payload.timeframeDays);
  props.setProperty('CFG_NEW_PRODUCT_DAYS', payload.newProductDays);
  
  props.setProperty('CFG_ROAS_GOOD', payload.roasGood);
  props.setProperty('CFG_ROAS_BAD', payload.roasBad);
  props.setProperty('CFG_CVR_GOOD', payload.cvrGood);
  props.setProperty('CFG_CVR_BAD', payload.cvrBad);
  props.setProperty('CFG_CLICKS_HIGH', payload.clicksHigh);
  props.setProperty('CFG_CLICKS_LOW', payload.clicksLow);
  
  props.setProperty('CFG_REV_HIGH', payload.revHigh);
  props.setProperty('CFG_REV_LOW', payload.revLow);
  props.setProperty('CFG_MIN_ORDERS', payload.minOrders);
  props.setProperty('CFG_PRICE_STEP', payload.priceStep);
  
  props.setProperty('CFG_ID_PREFIX', payload.idPrefix);
  props.setProperty('CFG_ID_SUFFIX', payload.idSuffix);
  
  props.setProperty('CFG_OUT_ROAS', payload.outGAdsRoas);
  props.setProperty('CFG_OUT_CVR', payload.outGAdsCvr);
  props.setProperty('CFG_OUT_CLICKS', payload.outGAdsClicks);
  props.setProperty('CFG_OUT_REV_SIMPLE', payload.outRevSimple);
  props.setProperty('CFG_OUT_REV_ADV', payload.outRevAdvanced);
  props.setProperty('CFG_OUT_PRICE', payload.outPriceInterval);
  props.setProperty('CFG_OUT_ORDERS', payload.outOrders);
  props.setProperty('CFG_OUT_VARIANTS', payload.outVariants);
  props.setProperty('CFG_OUT_TREND', payload.outTrend);
  props.setProperty('CFG_OUT_NEW', payload.outNewProduct);
  props.setProperty('CFG_OUT_PERF', payload.outPerfIndex);

  try {
    logCentralEvent_({
      component: "Label Settings",
      status: "SUCCESS",
      details: `Label settings saved. Timeframe: ${payload.timeframeDays || "-"} days.`,
      timeframe: payload.timeframeDays || "-",
      eventSource: "saveLabelSettingsFromDialog"
    });
  } catch (e) {
    console.warn("Central label settings logging failed: " + e.message);
  }
}

// ---------------------------------------------------------------------------
// View Credentials (text alert, active platform only)
// ---------------------------------------------------------------------------

function viewStoreSettings() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const platform = getActivePlatform();
  let message;

  if (platform === 'shopify') {
    const domain = props.getProperty('SHOPIFY_DOMAIN') || 'Not configured';
    const id     = props.getProperty('SHOPIFY_CLIENT_ID')     ? '••••' + props.getProperty('SHOPIFY_CLIENT_ID').slice(-4)     : 'Not configured';
    const secret = props.getProperty('SHOPIFY_CLIENT_SECRET') ? '••••' + props.getProperty('SHOPIFY_CLIENT_SECRET').slice(-4) : 'Not configured';
    const defaultFeedId = formatShopifyDefaultFeedIdLabel_(props.getProperty('CFG_SHOPIFY_FORMAT') || DEFAULT_LABEL_CONFIG.Shopify.ProductIdFormat);
    message = `🛍️ SHOPIFY\nDomain:     ${domain}\nAPI Key/ID: ${id}\nSecret:     ${secret}\nDefault Feed ID: ${defaultFeedId}\nGoogle Ads ID fallback: ${formatMatchGAdsStatus_(props)}`;
  } else if (platform === 'gomag') {
    const apiShop = props.getProperty('GOMAG_API_SHOP') || 'Not configured';
    const key = props.getProperty('GOMAG_API_KEY') ? '••••' + props.getProperty('GOMAG_API_KEY').slice(-4) : 'Not configured';
    const idMode = props.getProperty('CFG_GOMAG_ID_MODE') || DEFAULT_LABEL_CONFIG.Gomag.ProductIdMode;
    const productScope = props.getProperty('CFG_GOMAG_PRODUCT_SCOPE') || DEFAULT_LABEL_CONFIG.Gomag.ProductScope;
    const secondaryIdMode = props.getProperty('CFG_GOMAG_SECONDARY_ID_MODE') || '';
    const statusIds = parseCommaList_(props.getProperty('CFG_GOMAG_ORDER_STATUS_IDS') || '');
    message = `GOMAG\nApiShop:    ${apiShop}\nApikey:     ${key}\nDefault Feed ID: ${formatGomagIdModeLabel_(idMode)}\nCatalog rows: ${formatGomagProductScopeLabel_(productScope)}\nGMC_Feed_2 ID: ${formatGomagIdModeLabel_(secondaryIdMode) || 'Disabled'}\nGoogle Ads ID fallback: ${formatMatchGAdsStatus_(props)}\nOrder statuses: ${statusIds.length ? statusIds.join(', ') : 'All'}`;
  } else if (platform === 'ga4') {
    const gaId  = props.getProperty('GA4_PROPERTY_ID') || 'Not configured';
    message = `GOOGLE ANALYTICS 4\nProperty ID: ${gaId}`;
  } else if (platform === 'woocommerce') {
    const domain = props.getProperty('WOOCOMMERCE_DOMAIN') || 'Not configured';
    const key    = props.getProperty('WOOCOMMERCE_API_KEY')    ? '••••' + props.getProperty('WOOCOMMERCE_API_KEY').slice(-4)    : 'Not configured';
    const secret = props.getProperty('WOOCOMMERCE_API_SECRET') ? '••••' + props.getProperty('WOOCOMMERCE_API_SECRET').slice(-4) : 'Not configured';
    message = `🛒 WOOCOMMERCE\nDomain:     ${domain}\nAPI Key:    ${key}\nSecret:     ${secret}\nDefault Feed ID: Product ID\nGoogle Ads ID fallback: ${formatMatchGAdsStatus_(props)}`;
  } else {
    ui.alert(
      'Platform not configured',
      'Please open Performance Labels > Setup Guide and select a platform first.',
      ui.ButtonSet.OK
    );
    return;
  }

  ui.alert(`Current Settings — Platform: ${platform}`, message, ui.ButtonSet.OK);
}

function formatGomagIdModeLabel_(value) {
  const labels = {
    sku: 'SKU',
    product_id: 'Gomag Internal ID',
    ean: 'EAN'
  };
  return labels[value] || '';
}

function formatGomagProductScopeLabel_(value) {
  return value === 'parents' ? 'Parent products only' : 'Product versions / variants';
}

function formatShopifyDefaultFeedIdLabel_(value) {
  const labels = {
    shopify: 'Shopify standard ID',
    variant_id: 'Variant ID',
    parent_id: 'Parent ID'
  };
  return labels[value] || 'Shopify standard ID';
}

function formatMatchGAdsStatus_(props) {
  if (props.getProperty('CFG_MATCH_GADS_IDS_ENABLED') !== 'true') return 'Disabled';
  return formatMatchGAdsModeLabel_(props.getProperty('CFG_MATCH_GADS_IDS_MODE') || '') || 'Enabled';
}

function formatMatchGAdsModeLabel_(value) {
  const labels = {
    woo_product_id: 'Product ID',
    woo_sku: 'SKU',
    shopify_standard: 'Shopify standard ID',
    shopify_parent_id: 'Parent ID',
    shopify_variant_id: 'Variant ID',
    gomag_internal_id: 'Gomag Internal ID',
    gomag_sku: 'SKU'
  };
  return labels[value] || '';
}

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

function showDocumentation() {
  const html = HtmlService.createHtmlOutputFromFile('README')
      .setWidth(800)
      .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Performance Labels — Script Documentation');
}

function showLabelsDocumentation() {
  const html = HtmlService.createHtmlOutputFromFile('LabelsDocumentation')
      .setWidth(820)
      .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Performance Labels — Labels Documentation');
}

function showChangelog() {
  const html = HtmlService.createHtmlOutputFromFile('changes')
      .setWidth(820)
      .setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(html, 'Performance Labels — Changelog');
}

// ---------------------------------------------------------------------------
// Google Ads Script Copy Modal
// ---------------------------------------------------------------------------

function showAdsScriptModal() {
  const template = HtmlService.createTemplateFromFile('AdsScriptModal');
  template.adsScriptContentJson = JSON.stringify(getGoogleAdsScriptContent());
  
  const html = template.evaluate()
      .setWidth(920)
      .setHeight(760);
      
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Google Ads Script');
}
