/**
 * @file TriggerSetup.gs
 * @description Centralized manager for project triggers.
 * Simplified to provide two main "Complete Setup" options.
 */

const PL_TRIGGER_META_PLATFORM = 'PL_AUTO_FETCH_PLATFORM';
const PL_TRIGGER_META_MODE = 'PL_AUTO_FETCH_MODE';
const PL_TRIGGER_META_UPDATED_AT = 'PL_AUTO_FETCH_UPDATED_AT';
const PL_DAILY_START_HOUR = 5;
const PL_WORKER_INTERVAL_MINUTES = 5;

const PL_PLATFORM_TRIGGER_CONFIG = {
  woocommerce: {
    label: 'WooCommerce',
    daily: 'startWooCommerceReport',
    worker: 'processBatchWorker'
  },
  shopify: {
    label: 'Shopify',
    daily: 'startShopifyReport',
    worker: 'processShopifyWorker',
    legacy: ['runShopifyReport']
  },
  gomag: {
    label: 'Gomag',
    daily: 'startGomagReport',
    worker: 'processGomagWorker'
  },
  ga4: {
    label: 'GA4',
    daily: 'runGA4Report'
  }
};

/**
 * OPTION 1: WooCommerce Complete Setup
 * ------------------------------------
 * Sets up:
 * 1. WooCommerce Daily Start (5:00 AM)
 * 2. WooCommerce Worker (Every 5 mins)
 * 3. Label Calculations (Daily at 6:00 AM)
 */
function setupWooCommerceComplete() {
  setupPlatformAutoFetch_('woocommerce');
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
  setupPlatformAutoFetch_('shopify');
}

/**
 * OPTION 3: Gomag Complete Setup
 * --------------------------------
 * Sets up:
 * 1. Gomag Daily Start (5:00 AM)
 * 2. Gomag Worker (Every 5 mins)
 */
function setupGomagComplete() {
  setupPlatformAutoFetch_('gomag');
}

/**
 * OPTION 4: GA4 Complete Setup
 * ----------------------------
 * Sets up:
 * 1. GA4 Daily Report (5:00 AM)
 */
function setupGA4Complete() {
  setupPlatformAutoFetch_('ga4');
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
  getAllPlatformTriggerHandlers_().forEach(deleteTriggersForHandler_);
}

function ensureActivePlatformWorkerTrigger_(platform) {
  const config = PL_PLATFORM_TRIGGER_CONFIG[platform];
  if (!config || !config.worker) return;

  repairManualWorkerTrigger_(platform);
}

function setupPlatformAutoFetch_(platform) {
  const config = PL_PLATFORM_TRIGGER_CONFIG[platform];
  if (!config) throw new Error(`Unsupported auto-fetch platform: ${platform}`);

  const status = getPlatformTriggerStatus_(platform);
  const alreadyScheduled = status.state === 'Scheduled';

  if (!alreadyScheduled) {
    deleteAllPlatformTriggers_();
    createDailyTrigger_(config.daily);
    if (config.worker) createWorkerTrigger_(config.worker);
  }

  savePlatformTriggerMetadata_(platform, 'scheduled');

  const msg = `${config.label} Auto-Fetch ${alreadyScheduled ? 'already scheduled' : 'scheduled'}: daily start${config.worker ? ' + 5-minute worker' : ''}.`;
  console.log(msg);
  logCentralEvent_({
    component: "Auto-Fetch Setup",
    status: alreadyScheduled ? "SUCCESS" : "COMPLETED",
    details: msg,
    eventSource: "setupPlatformAutoFetch"
  });
  try { SpreadsheetApp.getActiveSpreadsheet().toast(msg); } catch (e) {}
  return getPlatformTriggerStatus_(platform);
}

function repairManualWorkerTrigger_(platform) {
  const config = PL_PLATFORM_TRIGGER_CONFIG[platform];
  if (!config || !config.worker) return getPlatformTriggerStatus_(platform);

  const allowedHandlers = [config.daily, config.worker].filter(Boolean);
  getAllPlatformTriggerHandlers_()
    .filter(handler => allowedHandlers.indexOf(handler) === -1)
    .forEach(deleteTriggersForHandler_);

  dedupeTriggersForHandler_(config.worker);
  if (config.daily) dedupeTriggersForHandler_(config.daily);

  if (countTriggersByHandler_()[config.worker] !== 1) {
    createWorkerTrigger_(config.worker);
  }

  savePlatformTriggerMetadata_(platform, 'manual_worker');
  logCentralEvent_({
    component: "Auto-Fetch Setup",
    status: "SUCCESS",
    details: `${config.label} manual worker trigger repaired for Run Now.`,
    eventSource: "repairManualWorkerTrigger"
  });
  return getPlatformTriggerStatus_(platform);
}

function getPlatformTriggerStatus_(platform) {
  const config = PL_PLATFORM_TRIGGER_CONFIG[platform];
  if (!config) {
    return {
      done: false,
      state: 'Not scheduled',
      detail: 'Choose a supported platform before scheduling auto-fetch.'
    };
  }

  const counts = countTriggersByHandler_();
  const allHandlers = getAllPlatformTriggerHandlers_();
  const expectedFull = getExpectedTriggerHandlers_(platform, true);
  const expectedWorkerOnly = getExpectedTriggerHandlers_(platform, false);

  const missing = expectedFull.filter(handler => !counts[handler]);
  const duplicates = allHandlers.filter(handler => (counts[handler] || 0) > 1);
  const stale = allHandlers.filter(handler => {
    return expectedFull.indexOf(handler) === -1 && (counts[handler] || 0) > 0;
  });

  if (duplicates.length || stale.length) {
    return {
      done: false,
      state: 'Needs cleanup',
      detail: `Trigger setup needs repair. Stale: ${stale.length}. Duplicates: ${duplicates.length}.`
    };
  }

  if (missing.length === 0) {
    return {
      done: true,
      state: 'Scheduled',
      detail: `${config.label} auto-fetch is scheduled.`
    };
  }

  const hasWorkerOnly = expectedWorkerOnly.length > 0 &&
    expectedWorkerOnly.every(handler => (counts[handler] || 0) === 1) &&
    expectedFull.some(handler => expectedWorkerOnly.indexOf(handler) === -1 && !counts[handler]);

  if (hasWorkerOnly) {
    return {
      done: false,
      state: 'Manual worker only',
      detail: 'Run Now can continue in the background, but daily auto-fetch is not scheduled.'
    };
  }

  return {
    done: false,
    state: 'Not scheduled',
    detail: 'Auto-fetch is not scheduled yet.'
  };
}

function getExpectedTriggerHandlers_(platform, includeDaily) {
  const config = PL_PLATFORM_TRIGGER_CONFIG[platform];
  if (!config) return [];

  return [
    includeDaily ? config.daily : '',
    config.worker || ''
  ].filter(Boolean);
}

function getAllPlatformTriggerHandlers_() {
  const handlers = [];
  Object.keys(PL_PLATFORM_TRIGGER_CONFIG).forEach(platform => {
    const config = PL_PLATFORM_TRIGGER_CONFIG[platform];
    [config.daily, config.worker].concat(config.legacy || []).forEach(handler => {
      if (handler && handlers.indexOf(handler) === -1) handlers.push(handler);
    });
  });
  handlers.push('runAllLabelCalculations');
  return handlers;
}

function countTriggersByHandler_() {
  const counts = {};
  ScriptApp.getProjectTriggers().forEach(trigger => {
    const handler = trigger.getHandlerFunction();
    counts[handler] = (counts[handler] || 0) + 1;
  });
  return counts;
}

function dedupeTriggersForHandler_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers().filter(trigger => {
    return trigger.getHandlerFunction() === handlerName;
  });

  triggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function createDailyTrigger_(handlerName) {
  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyDays(1)
    .atHour(PL_DAILY_START_HOUR)
    .create();
}

function createWorkerTrigger_(handlerName) {
  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyMinutes(PL_WORKER_INTERVAL_MINUTES)
    .create();
}

function savePlatformTriggerMetadata_(platform, mode) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PL_TRIGGER_META_PLATFORM, platform);
  props.setProperty(PL_TRIGGER_META_MODE, mode);
  props.setProperty(PL_TRIGGER_META_UPDATED_AT, new Date().toISOString());
}
