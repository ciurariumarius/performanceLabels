/**
 * @file calculateGoogleAdsLabels.gs
 * @description Calculates performance labels for Google Ads data.
 * Pure function architecture - processes provided array data and returns a mapping.
 */

// Output Headers
const HEADER_LABEL_ROAS = "LABEL_GADS_ROAS";
const HEADER_LABEL_CVR = "LABEL_GADS_CONV_RATE";
const HEADER_LABEL_CLICKS = "LABEL_GADS_CLICKS";

const MIN_CLICKS_THRESHOLD = 10;

/**
 * Main orchestrator function to run Google Ads label calculations conceptually in memory.
 * Returns { headers: string[], labels: string[][] }
 */
function runGoogleAdsLabelCalculation(data, headers, globalConfig) {
  try {
    const config = {
      roasGood:   getConfigValue(globalConfig, "ROAS Good",            'float', 4.0),
      roasBad:    getConfigValue(globalConfig, "ROAS Bad",             'float', 2.0),
      cvrGood:    getConfigValue(globalConfig, "Conversion Rate Good", 'float', 1.5),
      cvrBad:     getConfigValue(globalConfig, "Conversion Rate Bad",  'float', 0.5),
      clicksHigh: getConfigValue(globalConfig, "Clicks High",          'float', 100),
      clicksLow:  getConfigValue(globalConfig, "Clicks Low",           'float', 20)
    };
    
    const indices = getGAdsColumnIndices_(headers);
    const labels = data.map(row => calculateRowLabels_(row, indices, config));

    const roasHeader = getConfigValue(globalConfig, HEADER_LABEL_ROAS, 'string', HEADER_LABEL_ROAS);
    const cvrHeader = getConfigValue(globalConfig, HEADER_LABEL_CVR, 'string', HEADER_LABEL_CVR);
    const clicksHeader = getConfigValue(globalConfig, HEADER_LABEL_CLICKS, 'string', HEADER_LABEL_CLICKS);
    
    return {
      headers: [roasHeader, cvrHeader, clicksHeader],
      labels: labels
    };

  } catch (e) {
    Logger.log(`Error in runGoogleAdsLabelCalculation: ${e.message}`);
    return null;
  }
}

/**
 * Helper to get column indices for raw metrics.
 */
function getGAdsColumnIndices_(headers) {
  const indices = {
    clicks: headers.indexOf("Clicks"),
    impressions: headers.indexOf("Impressions"),
    cost: headers.indexOf("Cost"),
    conversions: headers.indexOf("Conversions"),
    conversionValue: headers.indexOf("Conv Value")
  };
  
  const missing = Object.keys(indices).filter(key => indices[key] === -1);
  if (missing.length > 0) {
    throw new Error(`Required Google Ads columns not found in Metrics sheet: ${missing.join(", ")}`);
  }
  return indices;
}

/**
 * Calculates labels for a single row of data.
 */
function calculateRowLabels_(row, indices, config) {
  const clicks = parseFloatSafe(row[indices.clicks], 0);
  const cost = parseFloatSafe(row[indices.cost], 0);
  const conversions = parseFloatSafe(row[indices.conversions], 0);
  const conversionValue = parseFloatSafe(row[indices.conversionValue], 0);
  // impressions removed since ctr is not used.

  const cvr = clicks > 0 ? (conversions / clicks) * 100 : 0;
  const roas = cost > 0 ? conversionValue / cost : 0;

  // 1. ROAS Label
  let labelRoas = "avg_roas";
  if (conversionValue === 0) {
    labelRoas = "no_roas";
  } else if (clicks >= MIN_CLICKS_THRESHOLD) {
    if (roas >= config.roasGood) labelRoas = "high_roas";
    else if (roas < config.roasBad) labelRoas = "low_roas";
  }

  // 2. CVR Label
  let labelCvr = "avg_cvr";
  if (conversions === 0) {
    labelCvr = "no_cvr";
  } else if (clicks >= MIN_CLICKS_THRESHOLD) {
    if (conversions >= 1 && cvr >= config.cvrGood) labelCvr = "high_cvr";
    else if (cvr < config.cvrBad) labelCvr = "low_cvr";
  }

  // 3. Clicks Label
  let labelClicks = "avg_clicks";
  if (clicks === 0) labelClicks = "no_clicks";
  else if (clicks >= config.clicksHigh) labelClicks = "high_clicks";
  else if (clicks < config.clicksLow) labelClicks = "low_clicks";

  return [labelRoas, labelCvr, labelClicks];
}
