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
  
  // 1. Clean existing platform triggers to prevent duplicates and stale platform runs
  deleteAllPlatformTriggers_();

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
  
  // 1. Clean existing platform triggers (including old ones)
  deleteAllPlatformTriggers_();

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

  deleteAllPlatformTriggers_();

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

  deleteAllPlatformTriggers_();

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

function deleteAllPlatformTriggers_() {
  [
    'startWooCommerceReport',
    'processBatchWorker',
    'runShopifyReport',
    'startShopifyReport',
    'processShopifyWorker',
    'startGomagReport',
    'processGomagWorker',
    'runGA4Report',
    'runAllLabelCalculations'
  ].forEach(deleteTriggersForHandler_);
}

function ensureActivePlatformWorkerTrigger_(platform) {
  const workerHandlers = {
    woocommerce: 'processBatchWorker',
    shopify: 'processShopifyWorker',
    gomag: 'processGomagWorker'
  };

  const handlerName = workerHandlers[platform];
  if (!handlerName) return;

  ensureTimeTriggerForHandler_(handlerName, 5);
}

function ensureTimeTriggerForHandler_(handlerName, minutes) {
  const exists = ScriptApp.getProjectTriggers().some(trigger => {
    return trigger.getHandlerFunction() === handlerName;
  });

  if (exists) return;

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyMinutes(minutes)
    .create();
}
