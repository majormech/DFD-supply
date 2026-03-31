Subject: DFD Supply Inventory System Overview + Page-by-Page Quick Guide

Hi Team,

Here is a quick and simple breakdown of the DFD Supply Inventory system, what each page does, and how to use the features.

---

## 1) Quick system breakdown (what it does)

The DFD Supply Inventory system is a shared inventory tool used by Supply and Stations 1–7.

In simple terms, it helps us:
- Keep one master inventory list for all supply items.
- Add new items, restock items, and issue items to stations.
- Track station requests from submission to completion.
- See low-stock items that need to be reordered.
- Search usage history and export reports.
- Manage admin email settings for request notifications.

---

## 2) Page-by-page breakdown

### A) Main Page (`/index.html`)
**What it does:**
- Shows a high-level inventory snapshot.
- Shows station request status by station.
- Shows shopping list (items below low-stock threshold).
- Lets users search inventory items quickly.

**How to use it:**
1. Review **Station Request Status** to see which stations have pending requests.
2. Review **Shopping List** for items that need reorder/restock.
3. Use **Search items** to find an item by name or SKU.
4. Use **Actions** in the inventory table (such as item edit/QR actions).

---

### B) Inventory Actions Page (`/inventory.html`)
**What it does:**
- Creates brand-new inventory items.
- Captures QR code, optional barcodes, stock quantity, low-stock level, and cost.
- Includes review/confirmation before final submit.

**How to use it:**
1. Scan or generate the item QR code.
2. (Optional) Scan barcode(s), or leave “Skip barcode scan” checked.
3. Enter item details (name, quantity, low-stock level, cost, etc.).
4. Enter date/time and completed-by information.
5. Click **Add item** to open review.
6. Check the confirmation box and submit.

---

### C) Restock Page (`/restock.html`)
**What it does:**
- Adds quantity to existing items.
- Finds items by barcode/QR scan.
- Allows optional new barcode capture after QR identification.

**How to use it:**
1. Scan/type an item code (barcode or QR).
2. Confirm selected item details.
3. Enter quantity being restocked.
4. (Optional) update cost/unit and notes.
5. Enter date/time and completed-by info.
6. Submit restock.

---

### D) Issue Page (`/issue.html`)
**What it does:**
- Shows stations with active requests.
- Lets supply issue requested items to a station.
- Updates request progress (pending → partial → complete).

**How to use it:**
1. Open the station card with active requests.
2. Review requested items and requested quantities.
3. Enter issue quantities for items being sent now.
4. Submit issue transaction.
5. Repeat until all request items are fulfilled.

---

### E) Search & Usage Page (`/search.html`)
**What it does:**
- Filters usage by date, station, item, and text search.
- Shows usage by item, by station, trend over time, and transaction-level details.
- Exports reports (CSV, TSV, XLSX, PDF, JSON).

**How to use it:**
1. Set quick date range (or custom start/end dates).
2. Add optional filters (station/item/search term).
3. Click **Search**.
4. Review tables and trend chart.
5. Choose export format and click **Download export**.

---

### F) Admin Settings Page (`/admin.html`)
**What it does:**
- Stores supply officer email and admin email list.
- Uses admin key if environment requires secure admin access.

**How to use it:**
1. Enter Admin key (if required).
2. Enter/update supply officer email.
3. Enter/update admin emails (comma-separated).
4. Click **Save settings**.

---

### G) How-To Guide Page (`/how-to.html`)
**What it does:**
- Built-in training/reference page.
- Documents standard workflows: add, edit, issue, restock, search/export.

**How to use it:**
- Open when training new users or for process refresher.
- Follow the listed step-by-step instructions for each workflow.

---

## 3) Station Request Pages (ST01–ST07) — one standard breakdown for all

**Pages:**
- `/request-ST01.html`
- `/request-ST02.html`
- `/request-ST03.html`
- `/request-ST04.html`
- `/request-ST05.html`
- `/request-ST06.html`
- `/request-ST07.html`

All seven station pages use the same request workflow and features.

### What these pages do
- Let station members submit inventory requests to Supply.
- Show recent request history for that station.
- Show request status with color coding:
  - **Red/Pink:** Pending
  - **Yellow:** Partially completed
  - **Green:** Completed
  - **Gray:** Canceled
- Allow open requests to be **modified** or **canceled** with required reason fields.

### How to use station request features

#### 1) Submit a new request
1. Click **Request item**.
2. Enter **Requested by** name.
3. Add items using either:
   - **Scan QR/barcode**, or
   - Check **I do not have the QR code or barcode** and search by item name/SKU.
4. Set quantity and click **Add item**.
5. Repeat as needed.
6. Click **Submit request**.

#### 2) Modify an open request
1. In the recent requests list, click **Modify request**.
2. Enter modification reason.
3. Update quantities, add/remove items.
4. Save changes.

#### 3) Cancel an open request
1. Click **Cancel request** on an open request.
2. Enter who canceled and reason.
3. Confirm cancellation.

#### 4) Track request progress
- Watch card color/status and item-level progress:
  - Pending items show remaining quantities.
  - Partial requests show what has been issued and what is still remaining.
  - Completed requests show fulfilled status.

---

## 4) Suggested closing line

If you would like, I can also send a one-page “quick start” version (short checklist) for station members and a separate operations checklist for Supply staff.

Thanks,
[Your Name]
