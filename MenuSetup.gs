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
  return stored || AppConfig.Platform;
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
      .addItem('🔑 Update Settings', 'showSettingsDialog')
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
