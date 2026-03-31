/**
 * @file MenuSetup.gs
 * @description Creates a custom menu in the Google Sheets UI for easy manual execution.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ Performance Labels')

      // Primary action: do everything in one click
      .addItem('▶️ Run All (Fetch + Calculate Labels)', 'runAllLabelCalculations')
      .addSeparator()

      // Individual fetch options
      .addItem('🛍️ Fetch Shopify Data', 'startShopifyReport')
      .addItem('🛒 Fetch WooCommerce Data', 'startWooCommerceReport')
      .addSeparator()

      // Settings submenu
      .addSubMenu(ui.createMenu('⚙️ Settings')
          .addItem('🔑 Update API Keys & Domains', 'promptForStoreSettings')
          .addItem('👁️ View Current Credentials', 'viewStoreSettings')
          .addSeparator()
          .addItem('🕐 Set Up Daily Auto-Fetch (Shopify)', 'setupShopifyComplete')
          .addItem('🕐 Set Up Daily Auto-Fetch (WooCommerce)', 'setupWooCommerceComplete'))
      .addSeparator()

      .addItem('📖 Documentation', 'showDocumentation')
      .addToUi();
}

/**
 * Opens the documentation sidebar.
 */
function showDocumentation() {
  const html = HtmlService.createHtmlOutputFromFile('README')
      .setTitle('Performance Labels Documentation')
      .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Prompts the user to securely input their API keys.
 * Saves them to Script Properties so they are never exposed in Github or Code.
 */
function promptForStoreSettings() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  
  // Ask for WooCommerce Domain
  let current = props.getProperty('WOOCOMMERCE_DOMAIN') || 'None';
  let response = ui.prompt('🔐 WooCommerce Setup', `Enter WooCommerce Domain (e.g., myshop.com)\\nCurrent: ${current}\\n\\n(Leave blank to keep existing)`, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK && response.getResponseText().trim() !== "") {
    props.setProperty('WOOCOMMERCE_DOMAIN', response.getResponseText().trim());
  }

  // Ask for WooCommerce Key
  current = props.getProperty('WOOCOMMERCE_API_KEY') ? 'Set (Hidden)' : 'None';
  response = ui.prompt('🔐 WooCommerce Setup', `Enter WooCommerce API Key (ck_...)\\nCurrent: ${current}\\n\\n(Leave blank to keep existing)`, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK && response.getResponseText().trim() !== "") {
    props.setProperty('WOOCOMMERCE_API_KEY', response.getResponseText().trim());
  }

  // Ask for WooCommerce Secret
  current = props.getProperty('WOOCOMMERCE_API_SECRET') ? 'Set (Hidden)' : 'None';
  response = ui.prompt('🔐 WooCommerce Setup', `Enter WooCommerce API Secret (cs_...)\\nCurrent: ${current}\\n\\n(Leave blank to keep existing)`, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK && response.getResponseText().trim() !== "") {
    props.setProperty('WOOCOMMERCE_API_SECRET', response.getResponseText().trim());
  }
  
  // Ask for Shopify Domain
  current = props.getProperty('SHOPIFY_DOMAIN') || 'None';
  response = ui.prompt('🔐 Shopify Setup', `Enter Shopify Domain (e.g., mystore.myshopify.com)\\nCurrent: ${current}\\n\\n(Leave blank to keep existing)`, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK && response.getResponseText().trim() !== "") {
    props.setProperty('SHOPIFY_DOMAIN', response.getResponseText().trim());
  }

  // Ask for Shopify API Key / Client ID
  current = props.getProperty('SHOPIFY_CLIENT_ID') ? 'Set (Hidden)' : 'None';
  response = ui.prompt('🔐 Shopify Setup', `Enter Shopify Custom App Client ID/API Key\\nCurrent: ${current}\\n\\n(Leave blank to keep existing)`, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK && response.getResponseText().trim() !== "") {
    props.setProperty('SHOPIFY_CLIENT_ID', response.getResponseText().trim());
  }

  // Ask for Shopify API Secret 
  current = props.getProperty('SHOPIFY_CLIENT_SECRET') ? 'Set (Hidden)' : 'None';
  response = ui.prompt('🔐 Shopify Setup', `Enter Shopify Custom App Client Secret\\nCurrent: ${current}\\n\\n(Leave blank to keep existing)`, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK && response.getResponseText().trim() !== "") {
    props.setProperty('SHOPIFY_CLIENT_SECRET', response.getResponseText().trim());
  }

  ui.alert('✅ Settings successfully saved securely to Script Properties.');
}

/**
 * Displays the current store configuration to the user.
 * Hides the full secret keys for security.
 */
function viewStoreSettings() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  
  const wooDomain = props.getProperty('WOOCOMMERCE_DOMAIN') || "Not configured";
  const wooKey = props.getProperty('WOOCOMMERCE_API_KEY') ? "••••" + props.getProperty('WOOCOMMERCE_API_KEY').slice(-4) : "Not configured";
  const wooSecret = props.getProperty('WOOCOMMERCE_API_SECRET') ? "••••" + props.getProperty('WOOCOMMERCE_API_SECRET').slice(-4) : "Not configured";

  const shopDomain = props.getProperty('SHOPIFY_DOMAIN') || "Not configured";
  const shopId = props.getProperty('SHOPIFY_CLIENT_ID') ? "••••" + props.getProperty('SHOPIFY_CLIENT_ID').slice(-4) : "Not configured";
  const shopSecret = props.getProperty('SHOPIFY_CLIENT_SECRET') ? "••••" + props.getProperty('SHOPIFY_CLIENT_SECRET').slice(-4) : "Not configured";

  const message = `
🛒 WOOCOMMERCE SETTINGS 🛒
Domain: ${wooDomain}
API Key: ${wooKey}
API Secret: ${wooSecret}

🛍️ SHOPIFY SETTINGS 🛍️
Domain: ${shopDomain}
API Key/ID: ${shopId}
API Secret: ${shopSecret}
  `;
  
  ui.alert('Current Script Settings', message, ui.ButtonSet.OK);
}
