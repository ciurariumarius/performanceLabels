/**
 * @file MenuSetup.gs
 * @description Creates a custom menu in the Google Sheets UI for easy manual execution.
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚡ Performance Labels')
      .addItem('🔄 Update All Labels (Consolidate & Calculate)', 'runAllLabelCalculations')
      .addSeparator()
      .addItem('📊 Consolidate Metrics Only', 'consolidateMetrics')
      .addSeparator()
      .addSubMenu(ui.createMenu('🔧 Setup & Fetch')
          .addItem('Initialize Shopify Triggers', 'setupShopifyComplete')
          .addItem('Initialize WooCommerce Triggers', 'setupWooCommerceComplete')
          .addSeparator()
          .addItem('▶️ Manually Start Shopify Fetch', 'startShopifyReport')
          .addItem('▶️ Manually Start WooCommerce Fetch', 'startWooCommerceReport'))
      .addToUi();
}
