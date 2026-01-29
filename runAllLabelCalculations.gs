/**
 * @file runAllLabelCalculations.gs
 * @description Main orchestrator script to run all individual label calculation functions sequentially.
 * This provides a single entry point for a trigger to update all labels in the "Metrics" sheet.
 * It logs the progress of each step and the total execution time.
 *
 * Changelog (v2.0 - Optimized):
 * - Updated function calls to match the refactored, optimized individual calculation scripts
 * (e.g., calling runRevenueLabels instead of processRevenueLabelsForSheet).
 * - Maintained robust logging and error handling for background execution.
 */
function runAllLabelCalculations() {
  const startTime = new Date();
  Logger.log("============================================================");
  Logger.log("Starting master label calculation process at: " + startTime.toLocaleString());
  Logger.log("============================================================");

  try {
    // Note: The order of execution can matter if some labels depend on others.
    // This sequence seems logical based on the script functions.

    Logger.log("--- (1/7) Starting: Revenue Labels ---");
    runRevenueLabels();
    Logger.log("--- Completed: Revenue Labels ---");

    Logger.log("--- (2/7) Starting: Price Interval Labels ---");
    runPriceLabels();
    Logger.log("--- Completed: Price Interval Labels ---");

    Logger.log("--- (3/7) Starting: Order Volume Labels ---");
    runOrdersLabel();
    Logger.log("--- Completed: Order Volume Labels ---");

    Logger.log("--- (4/7) Starting: Available Variants Labels ---");
    runAvailableVariantsLabel();
    Logger.log("--- Completed: Available Variants Labels ---");

    Logger.log("--- (5/7) Starting: Performance Index Labels ---");
    runPerformanceIndexLabel();
    Logger.log("--- Completed: Performance Index Labels ---");

    Logger.log("--- (6/7) Starting: Trend Labels ---");
    runTrendLabelCalculation();
    Logger.log("--- Completed: Trend Labels ---");

    Logger.log("--- (7/7) Starting: New Product Labels ---");
    runNewProductLabelCalculation();
    Logger.log("--- Completed: New Product Labels ---");


    const endTime = new Date();
    const executionTime = (endTime.getTime() - startTime.getTime()) / 1000;
    Logger.log("============================================================");
    Logger.log("All label calculations completed successfully!");
    Logger.log(`Total execution time: ${executionTime.toFixed(2)} seconds.`);
    Logger.log("Finished at: " + endTime.toLocaleString());
    Logger.log("============================================================");

  } catch (e) {
    const errorTime = new Date();
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Logger.log(`CRITICAL ERROR during runAllLabelCalculations at: ${errorTime.toLocaleString()}`);
    Logger.log(`Message: ${e.message}`);
    Logger.log(`Stack: ${e.stack}`);
    Logger.log("The process was halted. Subsequent calculations did not run.");
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // Re-throw the error if this function might be called by another that needs to know about the failure.
    // throw e; 
  }
}
