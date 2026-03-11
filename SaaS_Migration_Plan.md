# SaaS Migration Analysis: Performance Labels

This document outlines the complete plan to upgrade the existing Google Apps Script (GAS) ecosystem to a dedicated web server (Netcup VPS). 

## 1. Project Scope & Baseline Data
*   **Max Users**: 10
*   **Max Projects (Stores)**: 50
*   **Average Products per Store**: 2,000
*   **Total Maximum Database Size**: ~100,000 to 150,000 products.
*   **Google Ads Flow**: A Google Ads script will continue to run *inside* the client's Ads account, but it will **PUSH** data to the VPS instead of reading/writing to a Google Sheet.

**Analysis of Size**: 150,000 rows in a database is extremely small for modern databases like PostgreSQL. This means we do *not* need expensive, high-tier servers. Our primary constraint is memory (RAM) needed for the Node.js workers to fetch and parse JSON payloads concurrently at midnight.

---

## 2. Platform Architecture & Stack

To keep the platform robust, extremely fast, and maintainable, this is the recommended technology stack:

### Server & Infrastructure
*   **Hosting**: Netcup Root Server (VPS)
*   **OS**: Ubuntu 24.04 LTS
*   **Deployment**: Docker & Docker Compose (Containerizes everything so it’s easy to backup and restore).
*   **Reverse Proxy**: Nginx or Traefik (handles SSL/HTTPS automatically via Let's Encrypt).

### The Software Stack
*   **Database**: PostgreSQL 16 (Relational, perfect for tracking `Users` -> `Projects` -> `Products`).
*   **Backend API**: Node.js with Express.js or NestJS (TypeScript).
    *   *Why*: Required for creating the `/webhooks/gads` endpoints to receive data from Google Ads, and to serve the label feed back to Google Ads.
*   **Background Workers**: Node.js + Redis + BullMQ.
    *   *Why*: At midnight, a cron job fires 50 events (one for each store). Background workers pick up these events one by one, scrape Shopify/WooCommerce, calculate labels, and save them to PostgreSQL. If a store fails to fetch, BullMQ automatically retries the job.
*   **Frontend Dashboard**: React (Next.js or Vite) + Tailwind CSS.
    *   *Why*: Provides the UI for you (Admin) and your clients to log in and configure their stores.

---

## 3. Server Requirements (Netcup Estimate)

Given the maximum load of 150k products across 50 stores, you can comfortably run this entire stack on a very affordable Netcup server.

**Recommended Tier: Netcup Root Server RS 1000 G11 (or similar ARM64/x86 equivalent)**
*   **CPU**: 4 vCores (Plenty of compute for concurrent Node.js scraping).
*   **RAM**: 8 GB (This is the most critical spec. Node.js processing arrays of 2,000 products takes RAM. 8GB ensures 4-5 background workers can run simultaneously without crashing).
*   **Storage**: 160 GB NVMe SSD (PostgreSQL storing 150k rows will use less than 2GB of disk space. You have infinite headroom here).
*   **Network**: 2.5 Gbps (Netcup provides excellent bandwidth, ensuring API calls to Shopify/Woo are lightning-fast).
*   **Cost**: ~€8.00 to €10.00 / month.

---

## 4. Google Ads Integration: The "Push" Webhook

Since we are keeping the script *inside* the client's Google Ads account, the workflow changes slightly from the current Google Sheets model.

**How it will work:**
1.  In your SaaS Dashboard, the client clicks "Add Store" and gets a unique `project_id` and a `secure_api_key`.
2.  You provide them a standard Google Ads Scripts template to paste into their account.
3.  The client puts their `project_id` and `secure_api_key` at the top of the script.
4.  **Data Push (Daily)**: The Ads script runs its GAQL query, gathers the clicks/cost/conversions, and executes a `UrlFetchApp.fetch()` POST request to your VPS: `https://api.yourdomain.com/webhooks/gads/push`.
5.  Your Node.js backend receives this JSON payload, verifies the API key, and updates the `Metrics` table in PostgreSQL.
6.  **Data Pull (Hourly)**: When the Google Ads "Feed" script needs the final labels to apply to campaigns, it executes a simple GET request: `https://api.yourdomain.com/feed/labels?project_id=XYZ&key=SECRET`. Your API instantly returns a clean, pre-calculated CSV of product IDs and labels.

---

## 5. Migration Timeline & Detailed Steps

Building a SaaS requires a systematic approach. Expect this to take a skilled developer **4 to 6 weeks**.

### Phase 1: Infrastructure & Database (Week 1)
1.  **Server Setup**: Purchase Netcup VPS, install Ubuntu, secure with UFW (Firewall) and SSH keys.
2.  **Docker Setup**: Install Docker. Write the `docker-compose.yml` file to spin up PostgreSQL and Redis.
3.  **Database Design (Schema)**: 
    *   `Users` (Admin vs Client roles).
    *   `Projects` (id, user_id, type [shopify/woo], domain, api_keys, is_active).
    *   `Products` (project_id, product_id, title, price...).
    *   `Metrics` (project_id, product_id, date, clicks, cost, conversions... built from the Google Ads push).

### Phase 2: Core Backend Logic (Weeks 2-3)
*This is the most time-consuming phase, as we must port Google Apps Script logic to Node.js.*
4.  **API Framework**: Initialize Express.js/NestJS.
5.  **Shopify/Woo Scrapers**: Rewrite `ShopifyData.gs` and `WooCommerceData.gs` to use standard Node.js `fetch()`. Configure them to loop through pagination and insert arrays into PostgreSQL.
6.  **Label Logic**: Port the calculation scripts (`calculateOrdersLabel.gs`, etc.) to run on the PostgreSQL data.
7.  **Job Queue**: Configure BullMQ. Set a cron job that triggers every day at 00:00. The job queries `SELECT id FROM Projects WHERE is_active = true` and pushes 50 jobs into the Redis queue for the scrapers to execute.
8.  **Google Ads Webhooks**: Build the `POST /webhooks/gads/push` endpoint and the `GET /feed/labels` endpoint.

### Phase 3: Frontend Dashboard & Admin Panel (Week 4)
9.  **Auth**: Integrate an authentication system (Clerk, Supabase, or custom JWT).
10. **Client Dashboard**: Build a React UI where a client can log in, view their configured projects, update their Shopify keys, and see a basic table indicating if their last sync was "Success" or "Failed."
11. **Admin Dashboard**: Build a master view for you. This view lists all 50 projects, shows system health, and has a simple toggle to pause/disable a project if a client stops paying.

### Phase 4: Google Ads Script Rewrite & Shadow Testing (Week 5)
12. **Ads Script Rewrite**: Rewrite the current `GoogleAdsData.gs` script. Remove all `SpreadsheetApp` references and implement the robust `POST` payload to dump data to your webhook.
13. **Parallel Run**: Do not turn off the Google Sheets yet. Configure 1 or 2 test clients on the Netcup VPS. Run it for 3 days alongside the Google Sheets version.
14. **Validation**: Check that the labels generated by the VPS match the labels generated by Google Sheets exactly.

### Phase 5: Production Cutover (Week 6)
15. **Onboarding**: Move the remaining 48 projects onto the VPS by entering their credentials into the dashboard.
16. **Cutover**: Install the new PUSH/PULL Google Ads scripts into the clients' Ads accounts.
17. **Decommission**: Stop the triggers in the Google Sheets instances. The SaaS is now live.
