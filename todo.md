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

## PART 2 — Ultra Smart Inventory Tracker (additive only)

Goal: every bulk container gets a card of all menu items linked to it + grams/ml used per serving. At end-of-day shift, entering items sold computes exact usage in whole containers + remainder.
Example: 20 Americano × 20 g = 400 g → "0 bags, 600 g left of the 1000 g bag". 1200 g → "1 full bag + 200 g".

### 2.1 Database (NEW tables only — existing tables untouched)
- [x] `recipe_links`: id, menu_item_id, inventory_item_id, usage_amount, usage_unit ('g'|'ml'), container_quantity (g/ml per whole container), unique(menu_item_id, inventory_item_id)
- [x] `usage_logs`: id, inventory_item_id, menu_item_id, items_sold, total_used, whole_containers, remainder, opened_before, created_at, logged_by
- [x] Added via `CREATE TABLE IF NOT EXISTS` in `initDatabaseSchema()` — same migration-safe pattern as the rest of server.js.

### 2.2 Backend (server.js — NEW routes only)
- [x] GET    /api/admin/recipes/:menuItemId — recipe links for a menu item
- [x] POST   /api/admin/recipes — link menu item → container with g/ml per serving
- [x] DELETE /api/admin/recipes/:id — remove a link
- [x] GET    /api/admin/inventory/container-cards — bulk container cards + linked menu items + remainders
- [x] POST   /api/admin/inventory/calc-shift-usage — end-of-day engine:
       per link: items_sold × usage_amount = total g/ml;
       deducts from stock, wraps containers (opened_before closeout carries to 0 remainder);
       runs in a transaction; supports `preview: true` to dry-run without writing.

### 2.3 Frontend (admin)
- [x] "Smart Inventory" tab in admin.html + admin.js:
      container cards, per-serving usage editor, end-of-day sold-entry form with
      CALCULATE PREVIEW (shows bags used + remainder before saving) and confirm-deduct.

### 2.4 Testing checklist (blue only)
- [ ] 20 × 20 g = 400 g → 0 whole, 400 remainder of opened container
- [ ] 1200 g → 1 whole container + 200 g
- [ ] Remainder carry-over between days (600 g left + 400 g = 1 whole container, 0 remainder)
- [ ] Menu item with no recipe link → shown as a warning in preview, not deducted/silently skipped on confirm
- [ ] Existing routes (shipments, audit, waste, pos-sync, close-shift) unaffected
- [ ] After stable on blue → merge dev → main and deploy green
