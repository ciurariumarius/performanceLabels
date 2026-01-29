/**
 * @file selectSourceConfig.gs
 * @description Contains an onEdit(e) simple trigger that shows or hides configuration
 * sections in the "Config" sheet based on a user's selection in cell B20.
 * This version ONLY handles the user interface changes and does not trigger any calculations.
 */

/**
 * A simple trigger that runs automatically when a user edits the spreadsheet.
 * This function handles showing and hiding platform configuration rows.
 * @param {object} e The event object passed by the onEdit trigger.
 */
function onEdit(e) {
  const editedCell = e.range;
  const sheet = editedCell.getSheet();

  // Define the cell that controls the visibility and the sheet name
  const TRIGGER_CELL = "B20";
  const CONFIG_SHEET_NAME = "Config";

  // Only proceed if the specific cell on the "Config" sheet is edited
  if (sheet.getName() === CONFIG_SHEET_NAME && editedCell.getA1Notation() === TRIGGER_CELL) {
    Logger.log(`onEdit triggered by edit in cell ${TRIGGER_CELL}.`);
    const selectedPlatform = editedCell.getValue();
    Logger.log(`Selected platform: "${selectedPlatform}"`);

    // Define the row blocks for each platform configuration based on the provided image
    const platformRowConfigs = {
      "WooCommerce": { startRow: 22, rowCount: 5 },
      "Analytics":   { startRow: 27, rowCount: 3 },
      "Shopify":     { startRow: 30, rowCount: 4 }
    };

    // Use a try-catch block for safety, in case sheet structure changes
    try {
      if (selectedPlatform === "Show All") {
        Logger.log("Action: Showing all platform configurations.");
        for (const platformKey in platformRowConfigs) {
          const config = platformRowConfigs[platformKey];
          sheet.showRows(config.startRow, config.rowCount);
        }
      } else {
        Logger.log(`Action: Showing configuration for "${selectedPlatform}".`);
        for (const platformKey in platformRowConfigs) {
          const config = platformRowConfigs[platformKey];
          if (platformKey === selectedPlatform) {
            sheet.showRows(config.startRow, config.rowCount);
          } else {
            sheet.hideRows(config.startRow, config.rowCount);
          }
        }
      }
      Logger.log("Row visibility processing finished.");

    } catch (error) {
      Logger.log(`Error during onEdit execution: ${error.message}`);
    }
  }
}
