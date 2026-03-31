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
      .addItem('▶️ Run All (Fetch + Calculate Labels)', 'runAllLabelCalculations')
      .addSeparator();

  if (platform === 'shopify') {
    menu.addItem('🛍️ Fetch Shopify Data', 'startShopifyReport');
  } else {
    menu.addItem('🛒 Fetch WooCommerce Data', 'startWooCommerceReport');
  }

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
      .addSubMenu(settingsMenu)
      .addSeparator()
      .addItem('📖 Documentation', 'showDocumentation')
      .addToUi();
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
    message = `🛍️ SHOPIFY\nDomain:     ${domain}\nAPI Key/ID: ${id}\nSecret:     ${secret}`;
  } else {
    const domain = props.getProperty('WOOCOMMERCE_DOMAIN') || 'Not configured';
    const key    = props.getProperty('WOOCOMMERCE_API_KEY')    ? '••••' + props.getProperty('WOOCOMMERCE_API_KEY').slice(-4)    : 'Not configured';
    const secret = props.getProperty('WOOCOMMERCE_API_SECRET') ? '••••' + props.getProperty('WOOCOMMERCE_API_SECRET').slice(-4) : 'Not configured';
    message = `🛒 WOOCOMMERCE\nDomain:     ${domain}\nAPI Key:    ${key}\nSecret:     ${secret}`;
  }

  ui.alert(`Current Settings — Platform: ${platform}`, message, ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

function showDocumentation() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; padding: 16px; line-height: 1.6; color: #202124; }
      h2 { color: #1a73e8; margin-bottom: 8px; }
      h3 { margin-top: 16px; margin-bottom: 4px; color: #3c4043; }
      code { background: #f1f3f4; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
      ul { padding-left: 18px; }
      li { margin-bottom: 4px; }
      .note { background: #e8f0fe; border-left: 3px solid #1a73e8; padding: 8px 12px; border-radius: 0 4px 4px 0; margin: 12px 0; font-size: 12px; }
    </style>
    <h2>⚡ Performance Labels — Quick Guide</h2>

    <h3>1. First-time Setup</h3>
    <ul>
      <li>Set your platform in <code>Config.gs</code>: <code>PLATFORM = 'woocommerce'</code> or <code>'shopify'</code></li>
      <li>Open <b>⚙️ Settings → 🔑 Update Settings</b> to enter your API credentials</li>
      <li>Click <b>🕐 Set Up Daily Auto-Fetch</b> to enable automatic daily data sync</li>
    </ul>

    <h3>2. Running Manually</h3>
    <ul>
      <li><b>▶️ Run All</b> — fetches data and recalculates all labels in one click</li>
      <li><b>Fetch [Platform] Data</b> — syncs store data only (no label recalculation)</li>
    </ul>

    <h3>3. Exporting the Feed</h3>
    <ul>
      <li>In Google Sheets: <b>File → Share → Publish to web</b></li>
      <li>Select the <code>GMC_Feed</code> sheet → format: <b>CSV</b> → Publish</li>
      <li>Copy the URL and paste it into <b>Google Merchant Center</b> as your feed source</li>
      <li>For Facebook/Meta: use <code>GMC_Feed_2</code> (generated if ID_PREFIX/SUFFIX is set in <code>Config.gs</code>)</li>
    </ul>

    <h3>4. Configuring Labels</h3>
    <ul>
      <li>Edit thresholds in <code>Config.gs</code> (ROAS, revenue, clicks, etc.)</li>
      <li>Map labels to <code>custom_label_0</code>–<code>custom_label_4</code> in <code>FEED_EXPORT_MAPPING</code></li>
      <li>Leave a mapping empty (<code>""</code>) to disable that label calculation</li>
    </ul>

    <div class="note">💡 <b>Google Ads Script:</b> <code>GoogleAdsData.gs</code> runs separately in the Google Ads Scripts interface — do not paste it into this Script Editor.</div>
  `)
  .setWidth(480)
  .setHeight(480);
  SpreadsheetApp.getUi().showModalDialog(html, '📖 Documentation');
}
