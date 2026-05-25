/**
 * @file TriggerSetup.gs
 * @description Centralized manager for project triggers.
 * Simplified to provide two main "Complete Setup" options.
 */

/**
 * OPTION 1: WooCommerce Complete Setup
 * ------------------------------------
 * Sets up:
 * 1. WooCommerce Daily Start (5:00 AM)
 * 2. WooCommerce Worker (Every 5 mins)
 * 3. Label Calculations (Daily at 6:00 AM)
 */
function setupWooCommerceComplete() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Clean existing triggers to prevent duplicates
  deleteTriggersForHandler_('startWooCommerceReport');
  deleteTriggersForHandler_('processBatchWorker');
  deleteTriggersForHandler_('runAllLabelCalculations');

  // 2. Woo Start (Daily 5am)
  ScriptApp.newTrigger('startWooCommerceReport')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();
    
  // 3. Woo Worker (5 min)
  ScriptApp.newTrigger('processBatchWorker')
    .timeBased()
    .everyMinutes(5)
    .create();
    
  /*
  // 4. Labels (Daisy-chained now)
  // The data scripts will call runAllLabelCalculations() automatically when done.
  */

  const msg = "✅ WooCommerce Complete Setup Done (Data + Labels).";
  console.log(msg);
  ss.toast(msg);
}

/**
 * OPTION 2: Shopify Complete Setup
 * --------------------------------
 * Sets up:
 * 1. Shopify Daily Start (5:00 AM)
 * 2. Shopify Worker (Every 5 mins)
 * 3. Label Calculations (Daily at 6:00 AM)
 */
function setupShopifyComplete() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Clean existing triggers (including old ones)
  deleteTriggersForHandler_('runShopifyReport'); // Legacy
  deleteTriggersForHandler_('startShopifyReport');
  deleteTriggersForHandler_('processShopifyWorker');
  deleteTriggersForHandler_('runAllLabelCalculations');

  // 2. Shopify Start (Daily 5am)
  ScriptApp.newTrigger('startShopifyReport')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();
    
  // 3. Shopify Worker (5 min)
  ScriptApp.newTrigger('processShopifyWorker')
    .timeBased()
    .everyMinutes(5)
    .create();
    
  /* 
  // 4. Labels (Daisy-chained now - no longer needed as time-based)
  // The data scripts (Shopify/Woo) will call runAllLabelCalculations() automatically when done.
  */

  const msg = "✅ Shopify Complete Setup Done (Data + Labels).";
  console.log(msg);
  ss.toast(msg);
}

/**
 * OPTION 3: Gomag Complete Setup
 * --------------------------------
 * Sets up:
 * 1. Gomag Daily Start (5:00 AM)
 * 2. Gomag Worker (Every 5 mins)
 */
function setupGomagComplete() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  deleteTriggersForHandler_('startGomagReport');
  deleteTriggersForHandler_('processGomagWorker');
  deleteTriggersForHandler_('runAllLabelCalculations');

  ScriptApp.newTrigger('startGomagReport')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();

  ScriptApp.newTrigger('processGomagWorker')
    .timeBased()
    .everyMinutes(5)
    .create();

  const msg = "Gomag Complete Setup Done (Data + Labels).";
  console.log(msg);
  ss.toast(msg);
}

/**
 * OPTION 4: GA4 Complete Setup
 * ----------------------------
 * Sets up:
 * 1. GA4 Daily Report (5:00 AM)
 */
function setupGA4Complete() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  deleteTriggersForHandler_('runGA4Report');

  ScriptApp.newTrigger('runGA4Report')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();

  const msg = "GA4 Complete Setup Done.";
  console.log(msg);
  ss.toast(msg);
}

/**
 * HELPER: Deletes all triggers for a specific function name.
 * @param {string} handlerName The name of the function to clear triggers for.
 */
function deleteTriggersForHandler_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
