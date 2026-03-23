# DFD Supply Inventory

A Cloudflare Worker + D1 inventory app for tracking master stock and issuing supplies to seven fire stations.

## What the app does

- Stores one master inventory list in Cloudflare D1.
- Seeds 7 stations automatically.
- Lets staff create inventory items with SKU, barcode, or QR values.
- Supports two workflows:
  - **Issue stock** to a specific station, which subtracts units from the master inventory and records station allocations.
  - **Restock stock** into the master inventory from a delivery or count correction.
- Supports manual entry or camera scanning using the browser `BarcodeDetector` API when available.
- Keeps a recent transaction history for auditing.

## Project structure

- `src/index.js` — Worker API and static asset handler.
- `public/` — front-end UI (HTML/CSS/JS).
- `migrations/0001_initial.sql` — D1 schema and seeded stations.
- `wrangler.toml` — Cloudflare deployment configuration.
