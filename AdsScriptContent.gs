/**
 * @file AdsScriptContent.gs
 * @description Reads the copy-only Google Ads script from GoogleAdsData.html.
 */

function getGoogleAdsScriptContent() {
  const html = HtmlService.createHtmlOutputFromFile('GoogleAdsData').getContent();
  const match = html.match(/<script[^>]*id=["']google-ads-script["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error('Google Ads script template was not found.');
  }

  return match[1]
    .replace(/const SPREADSHEET_URL = ".*?";/, `const SPREADSHEET_URL = "${SpreadsheetApp.getActiveSpreadsheet().getUrl()}";`)
    .replace(/const PL_CENTRAL_LOG_SHEET_URL = ".*?";/, `const PL_CENTRAL_LOG_SHEET_URL = "${PL_CENTRAL_LOG_SHEET_URL}";`)
    .trim();
}
