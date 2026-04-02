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
  return stored || getAppConfig().Platform;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const platform = getActivePlatform();

  const menu = ui.createMenu('⚡ Performance Labels')
      .addItem('▶️ Run Now', 'runMainSync')
      .addItem('📋 Google Ads Script - To Copy', 'showAdsScriptModal')
      .addSeparator();



  const devMenu = ui.createMenu('🛠️ Dev');
  
  if (platform === 'shopify') {
    devMenu.addItem('🛍️ Get Shopify Data', 'startShopifyReport');
  } else {
    devMenu.addItem('🛒 Get WooCommerce Data', 'startWooCommerceReport');
  }
  
  devMenu.addItem('📈 Get Google Analytics Data', 'runGA4Report');
  devMenu.addItem('🏷️ Recalculate Labels', 'runAllLabelCalculations');

  const settingsMenu = ui.createMenu('⚙️ Settings')
      .addItem('🔑 Update API Settings', 'showSettingsDialog')
      .addItem('📊 Label & Threshold Settings', 'showLabelSettingsDialog')
      .addItem('👁️ View Current Credentials', 'viewStoreSettings')
      .addSeparator();

  if (platform === 'shopify') {
    settingsMenu.addItem('🕐 Set Up Daily Auto-Fetch (Shopify)', 'setupShopifyComplete');
  } else {
    settingsMenu.addItem('🕐 Set Up Daily Auto-Fetch (WooCommerce)', 'setupWooCommerceComplete');
  }

  menu.addSeparator()
      .addSubMenu(devMenu)
      .addSeparator()
      .addSubMenu(settingsMenu)
      .addSeparator()
      .addItem('📖 Documentation', 'showDocumentation')
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
  const platform = getActivePlatform();
  
  // 1. Start the primary platform fetcher
  // Both fetchers are designed to trigger runAllLabelCalculations() when finished.
  if (platform === 'shopify') {
    startShopifyReport();
  } else {
    startWooCommerceReport();
  }
}

// ---------------------------------------------------------------------------
// Settings Dialog
// ---------------------------------------------------------------------------

/**
 * Opens the HTML settings dialog (single screen for platform + all credentials).
 */
function showSettingsDialog() {
  const html = HtmlService.createHtmlOutputFromFile('Settings')
      .setTitle('Settings')
      .setWidth(380)
      .setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, '⚙️ Platform & API Settings');
}

/**
 * Called by the HTML dialog on load to pre-fill current values.
 * Never returns secret values — only domains and current platform.
 */
function getCurrentSettingsForDialog() {
  const props = PropertiesService.getScriptProperties();

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

  // Shopify
  if (payload.shopifyDomain)  props.setProperty('SHOPIFY_DOMAIN',        payload.shopifyDomain);
  if (payload.shopifyId)      props.setProperty('SHOPIFY_CLIENT_ID',     payload.shopifyId);
  if (payload.shopifySecret)  props.setProperty('SHOPIFY_CLIENT_SECRET', payload.shopifySecret);

  // Google Analytics
  if (payload.ga4PropertyId) {
    props.setProperty('GA4_PROPERTY_ID', payload.ga4PropertyId);
  } else {
    // Note: If they intentionally blank it out, we should probably delete it.
    // However, keeping consistent with the rest of the script that only sets to non-empty.
    // If we want them to clear it, we could use setProperty('GA4_PROPERTY_ID', '') instead.
    props.setProperty('GA4_PROPERTY_ID', payload.ga4PropertyId || '');
  }
}

// ---------------------------------------------------------------------------
// Label Settings Dialog
// ---------------------------------------------------------------------------

function showLabelSettingsDialog() {
  const html = HtmlService.createHtmlOutputFromFile('LabelSettings')
      .setTitle('Label & Threshold Settings')
      .setWidth(550)
      .setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, '📊 Label & Threshold Settings');
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
    
    // ID Styling
    shopifyFormat: getProp('CFG_SHOPIFY_FORMAT', DEFAULT_LABEL_CONFIG.Shopify.ProductIdFormat),
    countryCode: getProp('CFG_COUNTRY_CODE', DEFAULT_LABEL_CONFIG.Shopify.CountryCode),
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
  
  props.setProperty('CFG_SHOPIFY_FORMAT', payload.shopifyFormat);
  props.setProperty('CFG_COUNTRY_CODE', payload.countryCode);
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
}

// ---------------------------------------------------------------------------
// View Credentials (text alert, active platform only)
// ---------------------------------------------------------------------------

function viewStoreSettings() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const platform = getActivePlatform();
  let message;

  const gaId  = props.getProperty('GA4_PROPERTY_ID') || 'Not configured';

  if (platform === 'shopify') {
    const domain = props.getProperty('SHOPIFY_DOMAIN') || 'Not configured';
    const id     = props.getProperty('SHOPIFY_CLIENT_ID')     ? '••••' + props.getProperty('SHOPIFY_CLIENT_ID').slice(-4)     : 'Not configured';
    const secret = props.getProperty('SHOPIFY_CLIENT_SECRET') ? '••••' + props.getProperty('SHOPIFY_CLIENT_SECRET').slice(-4) : 'Not configured';
    message = `🛍️ SHOPIFY\nDomain:     ${domain}\nAPI Key/ID: ${id}\nSecret:     ${secret}\n\n📈 GOOGLE ANALYTICS\nProperty ID: ${gaId}`;
  } else {
    const domain = props.getProperty('WOOCOMMERCE_DOMAIN') || 'Not configured';
    const key    = props.getProperty('WOOCOMMERCE_API_KEY')    ? '••••' + props.getProperty('WOOCOMMERCE_API_KEY').slice(-4)    : 'Not configured';
    const secret = props.getProperty('WOOCOMMERCE_API_SECRET') ? '••••' + props.getProperty('WOOCOMMERCE_API_SECRET').slice(-4) : 'Not configured';
    message = `🛒 WOOCOMMERCE\nDomain:     ${domain}\nAPI Key:    ${key}\nSecret:     ${secret}\n\n📈 GOOGLE ANALYTICS\nProperty ID: ${gaId}`;
  }

  ui.alert(`Current Settings — Platform: ${platform}`, message, ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

function showDocumentation() {
  const html = HtmlService.createHtmlOutputFromFile('README')
      .setWidth(480)
      .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '📖 Performance Labels — Documentation');
}

// ---------------------------------------------------------------------------
// Google Ads Script Copy Modal
// ---------------------------------------------------------------------------

function showAdsScriptModal() {
  const template = HtmlService.createTemplateFromFile('AdsScriptModal');
  template.adsScriptContent = getGoogleAdsScriptContent();
  
  const html = template.evaluate()
      .setWidth(700)
      .setHeight(650);
      
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Google Ads Script');
}
