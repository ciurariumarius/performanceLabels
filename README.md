# Performance Labels for Google Merchant Center

**Automated Product Segmentation & Labeling System**

This project creates a "Labels Feed" for your Google Merchant Center by combining data from your store (Shopify/WooCommerce) and Google Ads. It automatically calculates performance metrics like ROAS, Sales Trends, and Stock Ratios, allowing you to segment your shopping campaigns efficiently (e.g., "High ROAS", "New Products", "Dead Stock").

---

## 🚀 Features

*   **Platform Agnostic**: Supports both Shopify and WooCommerce.
*   **Google Ads Integration**: Syncs Clicks, Cost, and Conversion data daily.
*   **Dynamic Labeling**:
    *   **Revenue**: High / Average / Low / No Revenue.
    *   **Trend**: Up-Trend / Down-Trend / Stable (comparing last 14 days vs prior period).
    *   **Performance Index**: Scores products based on ROAS & Volume.
    *   **Stock Health**: "3/5 Variants In Stock".
    *   **Price Ranges**: Group products by price (e.g., `price_0_50`).
*   **Worker Pattern**: Handles huge catalogs (10k+ products) without timing out.
*   **Zero-Maintenance**: Fully automated triggers.

---

## 🛠️ Installation & Setup

### 1. Project Setup
1.  Open the Google Sheet associated with this script.
2.  Ensure you have the following sheets (tabs):
    *   `Config` (Settings)
    *   `GAds` (Raw Ads Data)
    *   `Metrics` (Auto-generated data consolidation)
    *   `Labels Feed` (Final Output)
    *   `AccountData` (Status Logs)

### 2. Google Ads Script
To get ROAS data, you need to push data *from* Google Ads *to* this Sheet.
1.  Copy the code from `google_ads_script_export.js` (found in this repo or artifacts).
2.  Paste it into **Google Ads > Tools > Scripts**.
3.  Set the `SPREADSHEET_URL` variable in that script to your Sheet's URL.
4.  Schedule it to run Daily (e.g., 4:00 AM).

### 3. Apps Script Automation
1.  Open the Apps Script Editor (`Extensions > Apps Script`).
2.  Run `TriggerSetup.gs` -> `setupShopifyComplete()` (or `setupWooCommerceComplete` for Woo).
3.  This sets up the daily fetch (5:00 AM) and the chunk worker (every 5 min).

---

## ⚙️ Configuration (Thinking "Feed First")

Control everything from the **`Config`** sheet. No code changes needed.

### **Header Mapping**
Map internal Label IDs to your Merchant Center `custom_label` columns.

| Internal ID (Col A) | Output Header (Col B) | Description |
| :--- | :--- | :--- |
| `LABEL_REVENUE_ADVANCED` | `custom_label_0` | e.g. `high_revenue`, `low_revenue` |
| `LABEL_TREND` | `custom_label_1` | e.g. `up_trend`, `down_trend` |
| `LABEL_NEW` | `custom_label_2` | `new_product` label |
| `LABEL_PRICE_INTERVAL` | `custom_label_3` | e.g. `price_0_50` |
| `LABEL_AVAILABLE_VARIANTS`| `custom_label_4` | e.g. `3/5` (In Stock / Total) |
| `LABEL_GADS_ROAS` | `custom_label_5` | `high_roas`, `low_roas` |
| `LABEL_GADS_CONV_RATE` | `custom_label_6` | `high_cvr` |
| `LABEL_GADS_CLICKS` | `custom_label_7` | `high_clicks`, `no_clicks` |

### **Thresholds**
Define what "Good" looks like for you.
*   **Timeframe**: `30` (Analysis window in days).
*   **High Revenue Threshold**: `150` (Percent of average).
*   **High ROAS**: `4.0` (for GAds labels).

---

## 📊 Usage

### **Automatic**
Once setup, the system runs daily:
1.  **4:00 AM**: Google Ads Script pushes data to `GAds`.
2.  **5:00 AM**: Apps Script fetches Product/Order data.
3.  **~6:00 AM**: Labels are calculated and written to `Labels Feed`.

### **Manual**
Use the custom menu **"Performance Labels"** in the spreadsheet:
1.  **"Fetch Data"**: Pulls fresh data immediately.
2.  **"Update All Labels"**: Re-runs logic on existing data.

---

## 📁 File Structure
*   `ShopifyData.gs` / `WooCommerceData.gs`: Data fetchers.
*   `GoogleAdsData.gs`: Spreadsheet-side handler for Ads data.
*   `calculate{Type}Label.gs`: Individual logic for each label type.
*   `runAllLabelCalculations.gs`: The main brain that orchestrates the flow.
*   `TriggerSetup.gs`: One-click setup utility.
