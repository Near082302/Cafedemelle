# Cafe de Melle — TODO

Status: GREEN (main / live on Render) = 100% working. Never touched by new work.
All new work happens on the `dev` branch = BLUE.



## PART 1 — Blue/Green Deployment (Render)

### 1.1 Setup (one-time, done in Render dashboard by owner)
- [x] Current live service stays as-is (green). Never rename its branch or settings.
- [x] `dev` branch created from `main` in local repo (feature work lives here).
- [ ] Owner: push `dev` to GitHub → `git push origin dev`
- [ ] Owner: Render dashboard → New + → Web Service → same repo → **branch: `dev`** → name it `cafede-melle-blue`
      - Build: same Dockerfile. Start: `node server.js`. Env vars: same keys as green (PORT, SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, ENCRYPTION_KEY, NODE_ENV) — copy same values, render already keeps green's, fine to reuse for blue testing.
- [ ] Blue database: blue gets its OWN database.sqlite (auto-created fresh on the blue instance). Do NOT attach green's disk to blue.

### 1.2 Workflow
1. New features/fixes → commit on `dev` → blue auto-deploys → test on blue URL.
2. Bugs → fix on `dev` → blue redeploys. Green never sees it.
3. When stable → merge `dev` → `main` → green auto-deploys (that is "blue becomes green").
4. If green deploy misbehaves → Render → green service → Deploys → one-click rollback to previous deploy.

---

## PART 2 — Ultra Smart Inventory Tracker & Unified EOD Workflow

Goal: Support true Many-to-Many relationships between bulk containers and menu items, and unify EOD shift financial logging with automated inventory usage calculations into a single seamless screen.

### 2.1 Database & Schema Adjustments (Many-to-Many)
- [x] `recipe_links`: id, menu_item_id, inventory_item_id, usage_amount, usage_unit ('g'|'ml'), container_quantity (g/ml per whole container), unique(menu_item_id, inventory_item_id)
- [x] `usage_logs`: id, inventory_item_id, menu_item_id, items_sold, total_used, whole_containers, remainder, opened_before, created_at, logged_by
- [x] **Refactor** (done on dev): `linked_menu_item_id` removed from `inventory_items` via auto-migration (safe table rebuild keeps all data). All links live in `recipe_links`; kill-switches (stock-in / audit / waste / EOD) now toggle ALL linked menu items via `recipe_links`.

### 2.2 Phase 1: Container Registration & Many-to-Many Linking
- [x] **Streamlined Container Registration**: menu item dropdown removed from "Register Container" — creation is strictly name, unit type, initial stock, threshold, unit cost.
- [x] **Container Card Enhancements**: each bulk container card lists every linked menu item + grams/ml per serving + container capacity; inventory overview table shows a badge of all linked items.
- [x] **Quick Link Modal**: a `+ Link Menu Item` button sits directly on each bulk container card (opens the attach/detach modal pre-set to that container, with usage g/ml per serving).

### 2.3 Phase 2: Unifying EOD Shift Closeout & Smart Deductions
- [x] **Merge Tabs**: `Ultra Smart Tracker` merged into Inventory & Supply — "EOD Closeout & Smart Deductions" (unified closeout screen) + "Smart Recipe Links" (container cards) sub-tabs.
- [x] **Unified Screen Layout**:
  - **Top Section**: Shift date picker, Total POS Sales (₱) input, and Shift Discounts Deducted (₱) input.
  - **Middle Section**: Searchable + category-filtered grid of ACTIVE menu items with numeric ± steppers for "Units Sold Today" and a live tally bar (gross/net instant).
  - **Bottom Section (Preview Drawer)**: **"Calculate Usage & Preview Deduction"** reveals a per-container breakdown (total used from which items, opening remainder, whole containers deducted, stock before→after, ending remainder) plus the financial tally before final submission.
      - Example Preview view (as implemented):
        ```text
        📦 Nestle Coffee Bag
           • Sold this shift: 20 (from Iced Americano x20)
           • Total Used: 600 g · Opening Remainder: 200 g
           • Whole Containers Deducted: 3 (Stock: 12 → 9)
           • Ending Remainder in Open Container: 50 g
        ```
  - **Final Action**: **"Confirm Closeout & Deduct Inventory"** (security-gated) hits `POST /api/admin/inventory/unified-closeout`, which in ONE SQLite transaction saves: `shift_closeouts` (financial), `shift_closeout_items` (itemized sales), inventory stock deductions, `usage_logs` remainder rollovers, and all-recipe-links kill-switches. Any step failing rolls back everything.
- [x] Legacy `POST /api/admin/inventory/close-shift` kept for compatibility: still stores financials/itemized rows, no longer does the old single-link unit deduction (smart engine owns deductions now).

### 2.4 Testing Checklist (Blue only)
- [x] Register a single bulk container and link multiple menu items to it (verified locally on dev: container linked to 2 menu items, one menu item linked to 2 containers — true many-to-many).
- [x] Verify usage math: 20 Americanos × 20 g = 400 g + 5 lattes × 20 g = 500 g → correct whole containers/remainder; also verified via a live run on a 250 g bag (600 g → 3 whole + 50 g remainder, stock 12 → 9). *(Re-test on Render blue after push.)*
- [x] Test remainder carry-over between shifts (previous run's remainder feeds the next preview as Opening Remainder, and shows on the container card). *(Re-test on Render blue after push.)*
- [x] Ensure menu items with no recipe links display safe warnings during preview without blocking the transaction (NO_RECIPE_LINK warning shown, sale still saved, nothing deducted).
- [x] Verify existing tables (shipments, audit, waste, pos-sync) remain untouched and fully operational (only kill-switch paths were rebased onto `recipe_links`; closeout history ledger + master audit ticket still work).
- [ ] Once stable on blue → merge `dev` → `main` and deploy green.
