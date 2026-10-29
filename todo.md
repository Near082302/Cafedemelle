# Cafe de Melle — TODO

Status: GREEN (main / live on Render) = 100% working. Never touched by new work.
All new work happens on the `dev` branch = BLUE.

---

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

Goal: Support true Many-to-Many relationships between bulk containers and menu items, unify EOD shift financial logging with automated inventory usage calculations, and establish a stress-free operational balance between automation and real-world variance.

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
  - **Final Action**: **"Confirm Closeout & Deduct Inventory"** (security-gated) hits `POST /api/admin/inventory/unified-closeout`, which in ONE SQLite transaction saves: `shift_closeouts` (financial), `shift_closeout_items` (itemized sales), inventory stock deductions, `usage_logs` remainder rollovers, and all-recipe-links kill-switches. Any step failing rolls back everything.
- [x] Legacy `POST /api/admin/inventory/close-shift` kept for compatibility: still stores financials/itemized rows, no longer does the old single-link unit deduction (smart engine owns deductions now).

### 2.4 Phase 3: Stress-Free Operational Design & Real-World Variance Rules
*Philosophy: Avoid corporate micro-management (like StoreHub/Jollibee IMS) by separating physical reality from theoretical math.*
- [x] **Two-Tier Counting Rule (Enforced Policy)**:
  - Staff *never* counts grams or milliliters physically on the shelf during audits.
  - Staff only counts **whole, unopened units** physically. Open active containers are handled digitally via background remainder tracking.
  - *Implemented on dev (blue)*: two-tier policy note enforced in the Shift Evening Audit form; live "System Expectation" hint appears when a container is picked (`POST /api/admin/inventory/audit/preview` expectation-only mode shows whole unopened containers + the digital opened-remainder, and explicitly tells staff not to weigh).
- [x] **Explicit Waste vs. Operational Variance Separation**:
  - **Explicit Waste (Log Spillage / Wastage Tab)**: Strict tracking for items physically destroyed or thrown away and *never* touching a customer (e.g., shattered syrup bottles, expired milk in the fridge).
  - **Operational Variance (Shift Evening Audit Reconciliation)**: When physical shelf counts differ slightly from smart calculations due to rush-hour heavy pours, customer customizations (extra pump of syrup), or barista tastings, the system **does not auto-punish or log false wastage**.
  - *Implemented on dev (blue)*: soft-reconciliation path (`reason_code` on the audit endpoint) writes to a new `audit_variances` ledger with ZERO `wastage_logs` entries and ₱0 financial punishment; legacy no-reason-code path kept untouched for compatibility; new "Variance (Evening Audit)" filter pill + badge in the Stock-Out & Spillage ledger (exports included).
- [x] **Soft Audit Reconciliation Modal / Prompt**:
  - During the **Shift Evening Audit**, if a discrepancy is found between physical count and system calculation, present a gentle prompt with a non-scary **Reason Code Dropdown**:
    - `[Customer Customization / Extra Serving]`
    - `[Barista Heavy Pour / Shift Variance]`
    - `[Staff Tasting / Quality Check]`
    - `[Unrecorded Loss / Shrinkage]`
  - Hitting "Reconcile & Reset" silently updates the base inventory to match reality, logs the variance for managerial transparency, and keeps operations flowing smoothly without barista stress.
  - *Implemented on dev (blue)*: submitting the audit first previews the discrepancy; if counts match → clean closure with no punishment; if mismatched → gentle "Small Mismatch Found — No Worries" modal with the reason code dropdown, and "Reconcile & Reset" snaps base stock to shelf reality.

### 2.5 Testing Checklist (Blue only)
- [x] Register a single bulk container and link multiple menu items to it (verified locally on dev: container linked to 2 menu items, one menu item linked to 2 containers — true many-to-many).
- [x] Verify usage math: 20 Americanos × 20 g = 400 g + 5 lattes × 20 g = 500 g → correct whole containers/remainder; also verified via a live run on a 250 g bag (600 g → 3 whole + 50 g remainder, stock 12 → 9).
- [x] Test remainder carry-over between shifts.
- [x] Ensure menu items with no recipe links display safe warnings during preview without blocking the transaction (NO_RECIPE_LINK warning shown, sale still saved, nothing deducted).
- [x] Verify existing tables (shipments, audit, waste, pos-sync) remain untouched and fully operational.
- [x] Soft audit reconciliation + variance reason codes verified locally on dev: preview endpoint, gentle modal flow, `audit_variances` ledger row, zero false `wastage_logs` entries on reconcile, legacy `EVENING_AUDIT_STOCKOUT` path still intact, variance filter pill + CSV export working. (Remaining: red-team during real evening shifts on blue.)
- [ ] Once stable on blue → merge `dev` → `main` and deploy green.