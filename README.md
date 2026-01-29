# Performance Labels for E-Commerce

This Google Apps Script project automates the calculation and assignment of performance labels to e-commerce products. It integrates with WooCommerce, Shopify, and Google Analytics (GA4) to analyze product data and generate actionable insights in a Google Sheet.

## 📌 Project Overview

The system fetches product data and metrics, processes them, and assigns various labels (e.g., High Revenue, Trending, New Product) to help with inventory management, marketing strategies, and performance tracking.

**Key Features:**
- **Multi-Platform Support:** Analyzes data from WooCommerce and Shopify.
- **Automated Labeling:** Calculates 7 different types of performance labels.
- **Configurable Thresholds:** Users can adjust logic (e.g., what counts as "High Revenue") directly from the Google Sheet.
- **Modular Data Sources:** You can use any combination of sources (e.g., WooCommerce + Google Ads, OR Shopify + Google Ads). The system dynamically handles the data present.

## 📂 Project Structure

| File | Description |
|------|-------------|
| `runAllLabelCalculations.gs` | **Main Entry Point.** Orchestrates the execution of all label calculation functions sequentially. |
| `selectSourceConfig.gs` | Manages the "Config" sheet UI, showing/hiding options based on the selected platform. |
| `CommonUtilities.gs` | Shared helper functions for config loading, date formatting, and sheet management. |
| `calculate*.gs` | Individual scripts for calculating specific labels (Revenue, Price, Orders, etc.). |
| `*Data.gs` | Connectors for fetching data from external sources (Shopify, WooCommerce, GA4). |
| `GoogleAdsData.gs` | **Google Ads Script.** Fetches product performance data (clicks, conversions) from the Ads interface. |

## 🏷️ Label Types

The system generates the following labels in the **Metrics** sheet:

1. **Revenue Labels** (`calculateRevenueLabel.gs`)
   - `LABEL_REVENUE_SIMPLE`: `has_revenue` vs `no_revenue`.
   - `LABEL_REVENUE_ADVANCED`: `low_revenue`, `avg_revenue`, `high_revenue` (based on account average).

2. **Price Interval Labels** (`calculatePriceLabel.gs`)
   - Categorizes products into price ranges.

3. **Order Volume Labels** (`calculateOrdersLabel.gs`)
   - Classifies products based on the number of orders.

4. **Available Variants Labels** (`calculateAvailableVariantsLabel.gs`)
   - Tracks stock and variant availability.

5. **Performance Index Labels** (`calculatePerformanceIndexLabel.gs`)
   - A composite score indicating overall product health.

6. **Trend Labels** (`calculateTrendLabel.gs`)
   - Identifies trending products based on recent performance vs. historical data.

7. **New Product Labels** (`calculateNewProductLabel.gs`)
   - Flags products added within a specific recent timeframe.

## ⚙️ Setup & Configuration

### 1. Google Sheets Setup
You can use the following template to get started quickly:
[**📄 Google Sheet Template**](https://docs.google.com/spreadsheets/d/1AWjSOfx4P6USb-Yjy_luq80MkxcL-b2xoeejVxWQ9G8/edit?gid=1110638176#gid=1110638176)

The script expects two main sheets:
- **`Config`**: Contains configuration settings.
    - **Cell B20**: Platform selector (WooCommerce, Shopify, Analytics).
    - **Thresholds**: Rows for defining logic (e.g., "Low Revenue Threshold", "High Revenue Threshold").
- **`Metrics`**: The main data table.
    - **Required Columns**: `id`, `Total Revenue`, and other metric columns populated by the data fetchers.

### 2. Google Apps Script Setup
1. Open the Google Sheet.
2. Go to `Extensions > Apps Script`.
3. Copy the project files into the script editor.
4. **Enable Services**: Ensure the **Google Analytics Data API** is enabled in the Services section `appsscript.json`.

### 3. Configuration
1. Go to the **Config** sheet.
2. Select your platform in cell **B20**.
3. Fill in the required API keys (Shopify/WooCommerce) and Google Analytics Property ID.
4. Adjust the threshold percentages for label calculations if needed.

### 4. Google Ads Integration (Optional)
This script runs **inside** the Google Ads interface, not in the Google Sheet's Apps Script.
1. Log in to your Google Ads Account.
2. Go to **Tools & Settings > Bulk Actions > Scripts**.
3. Create a new script and paste the contents of `GoogleAdsData.gs`.
4. Replace `YOUR_SPREADSHEET_URL_HERE` with your sheet's URL.
5. Authorize and Run. This will push Ads metrics into the **Metrics** sheet for label calculation.

## 🚀 Usage

### Manual Execution
To update all labels manually:
1. Open the script editor.
2. Select the `runAllLabelCalculations` function.
3. Click **Run**.
4. Check the "execution transcript" for progress logs.

### Automating with Triggers
You can set up a time-driven trigger to run `runAllLabelCalculations` daily or weekly to keep your labels up to date automatically.
1. In the Apps Script editor, go to **Triggers** (clock icon).
2. Click **+ Add Trigger**.
3. Select `runAllLabelCalculations` -> `Time-driven` -> `Day timer`.

## 🛠️ Development

- **Adding a New Label**:
    1. Create a new `calculateNewFeatureLabel.gs` file.
    2. Implement the logic following the pattern in `calculateRevenueLabel.gs`.
    3. Add a call to your new function in `runAllLabelCalculations.gs`.

- **Debugging**:
    - Use `Logger.log()` to print messages.
    - Check the "Executions" tab in the Apps Script dashboard for detailed logs and error messages.
