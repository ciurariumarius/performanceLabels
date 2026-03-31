/**
 * @file Config.gs
 * @description Centralized configuration for the Performance Labels project.
 * 
 * -----------------------------------------------------------------------------------------
 * HOW TO USE THIS FILE (For Non-Programmers):
 * 1. Modify the values (numbers or text inside quotes) to match your business rules.
 * 2. ONLY change what comes AFTER the equals sign (=).
 * 3. Never delete the semi-colons (;) at the end of the lines.
 * 4. IMPORTANT: API Keys are NOT stored here for security reasons. 
 *    Use the menu in Google Sheets: "⚡ Performance Labels" -> "🔧 Setup & Fetch" -> "🔑 Set API Keys (Secure)".
 * -----------------------------------------------------------------------------------------
 */

// ==============================================================================
// ⏱️ TIMEFRAMES 
// ==============================================================================
// How many days of past data should we analyze? (Default: 30)
const TIMEFRAME_DAYS = 30;

// Products created within this many days get the "New" label. (Default: 30)
const NEW_PRODUCT_DAYS = 30;


// ==============================================================================
// 🎯 GOOGLE ADS THRESHOLDS (ROAS & Clicks)
// ==============================================================================
// If a product's ROAS is >= this number, it gets labeled as "high_roas"
const ROAS_GOOD = 5;

// If a product's ROAS is < this number, it gets labeled as "low_roas"
// (Anything between Good and Bad gets labeled as "avg_roas")
const ROAS_BAD = 3;

// If a product's Conversion Rate is >= this %, it gets labeled as "high_cvr"
const CONVERSION_RATE_GOOD = 4;

// If a product's Conversion Rate is < this %, it gets labeled as "low_cvr"
// (Anything between Good and Bad gets labeled as "avg_cvr")
const CONVERSION_RATE_BAD = 0.5;

// If a product has >= this many clicks, it gets labeled as "high_clicks"
const CLICKS_HIGH = 50;

// If a product has < this many clicks, it gets labeled as "low_clicks"
// (Anything between High and Low gets labeled as "avg_clicks")
const CLICKS_LOW = 30;


// ==============================================================================
// 💰 REVENUE THRESHOLDS 
// ==============================================================================
// Products making >= this percentage of the average account revenue get labeled as "high_revenue"
// Example: 150 means 150% of the overall average revenue.
const HIGH_REVENUE_THRESHOLD = 150; 

// Products making < this percentage of the average account revenue get labeled as "low_revenue"
// Example: 50 means 50% of the overall average revenue.
// (Anything in between is labeled "avg_revenue")
const LOW_REVENUE_THRESHOLD = 50;  


// ==============================================================================
// 📦 SALES & PRICING
// ==============================================================================
// A product needs >= this many absolute orders to be labeled as "high_orders"
// Products below this will be "average_orders", "one_order", or "no_orders".
const MINIMUM_ORDERS_THRESHOLD = 5;

// We group products into price intervals of this size (e.g., "0-50", "50-100")
const PRICE_INTERVAL_STEP = 50;


// ==============================================================================
// 🔑 ID SETTINGS
// ==============================================================================
// --- Shopify ID Format (for GA4 / GTM tracking) ---
// Format used when building the Shopify product ID sent to GA4 / GTM.
// Options:
//   'shopify'    => shopify_{COUNTRY}_{productId}_{variantId}   (default)
//   'variant_id' => variant ID only
//   'parent_id'  => product ID only
const SHOPIFY_PRODUCT_ID_FORMAT = 'shopify';

// Country code embedded in the Shopify ID (e.g. 'zz', 'us', 'de').
const SHOPIFY_COUNTRY_CODE = 'zz';

// --- Secondary Feed ID Modifier (for Facebook / Meta Catalog) ---
// When set, a second feed sheet (GMC_Feed_2) is generated with modified IDs.
// Leave both empty ("") to skip GMC_Feed_2 entirely.
// Example: ID_PREFIX = "wc_post_id_"  =>  "wc_post_id_12345"
const ID_PREFIX = "";
const ID_SUFFIX = "";


// ==============================================================================
// 🏷️ LABEL COLUMN MAPPING
// Determine which column name each calculated metric should be written to.
// - To export to Google Merchant Center: Use "custom_label_0" through "custom_label_4".
// - To disable a calculation entirely: Leave the string completely empty ("").
// ==============================================================================
const FEED_EXPORT_MAPPING = {
  // --- GOOGLE ADS METRICS ---
  LABEL_GADS_ROAS:          "custom_label_2",           // Outputs: "high_roas", "avg_roas", "low_roas", "no_roas"
  LABEL_GADS_CONV_RATE:     "custom_label_3",           // Outputs: "high_cvr", "avg_cvr", "low_cvr", "no_cvr"
  LABEL_GADS_CLICKS:        "custom_label_4",           // Outputs: "high_clicks", "avg_clicks", "low_clicks", "no_clicks"

  // --- REVENUE METRICS ---
  LABEL_REVENUE_SIMPLE:     "custom_label_0",           // Outputs: "has_revenue", "no_revenue"
  LABEL_REVENUE_ADVANCED:   "",                         // Outputs: "high_revenue", "avg_revenue", "low_revenue", "no_revenue"

  // --- SALES & PRODUCT METRICS ---
  LABEL_ORDERS:             "",                         // Outputs: "no_orders", "one_order", "average_orders", "high_orders"
  LABEL_PRICE_INTERVAL:     "custom_label_1",           // Outputs: "price_{min}_{max}" (e.g., "price_0_50"), "invalid_price"
  LABEL_AVAILABLE_VARIANTS: "",                         // Outputs: "{inStock}/{total}" (e.g., "3/5"), ""
  LABEL_TREND:              "",                         // Outputs: "up_trend", "down_trend", "stable_trend", "no_trend"
  LABEL_NEW:                "",                         // Outputs: "new_product", ""
  
  // --- OVERALL METRICS ---
  LABEL_PERFORMANCE_INDEX:  ""                          // Outputs: "INDEX", "NO-INDEX", "NEAR-INDEX", "LOW-INDEX", "EXCLUDE-INDEX"
};










// 🛠️ ===========================================================================
// DO NOT EDIT BELOW THIS LINE - System Code
// This maps your simple variables above to the system structure used by the rest of the scripts.
// ==============================================================================
const AppConfig = {
  TimeframeDays: TIMEFRAME_DAYS,
  NewProductDays: NEW_PRODUCT_DAYS,
  IdPrefix: ID_PREFIX,
  IdSuffix: ID_SUFFIX,
  Shopify: {
    ProductIdFormat: SHOPIFY_PRODUCT_ID_FORMAT,
    CountryCode: SHOPIFY_COUNTRY_CODE
  },
  ROAS: { Good: ROAS_GOOD, Bad: ROAS_BAD },
  ConversionRate: { Good: CONVERSION_RATE_GOOD, Bad: CONVERSION_RATE_BAD },
  Clicks: { High: CLICKS_HIGH, Low: CLICKS_LOW },
  Revenue: { LowThresholdPercent: LOW_REVENUE_THRESHOLD, HighThresholdPercent: HIGH_REVENUE_THRESHOLD },
  Orders: { Threshold: MINIMUM_ORDERS_THRESHOLD },
  PriceIntervalStep: PRICE_INTERVAL_STEP,
  
  LabelsMapping: {
    LABEL_GADS_ROAS:          FEED_EXPORT_MAPPING.LABEL_GADS_ROAS,
    LABEL_GADS_CONV_RATE:     FEED_EXPORT_MAPPING.LABEL_GADS_CONV_RATE,
    LABEL_GADS_CLICKS:        FEED_EXPORT_MAPPING.LABEL_GADS_CLICKS,
    LABEL_REVENUE_SIMPLE:     FEED_EXPORT_MAPPING.LABEL_REVENUE_SIMPLE,
    LABEL_REVENUE_ADVANCED:   FEED_EXPORT_MAPPING.LABEL_REVENUE_ADVANCED,
    LABEL_PRICE_INTERVAL:     FEED_EXPORT_MAPPING.LABEL_PRICE_INTERVAL,
    LABEL_PERFORMANCE_INDEX:  FEED_EXPORT_MAPPING.LABEL_PERFORMANCE_INDEX,
    LABEL_AVAILABLE_VARIANTS: FEED_EXPORT_MAPPING.LABEL_AVAILABLE_VARIANTS,
    LABEL_ORDERS:             FEED_EXPORT_MAPPING.LABEL_ORDERS,
    LABEL_TREND:              FEED_EXPORT_MAPPING.LABEL_TREND,
    LABEL_NEW:                FEED_EXPORT_MAPPING.LABEL_NEW
  }
};
