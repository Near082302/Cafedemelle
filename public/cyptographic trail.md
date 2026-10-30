# PART 3-B — Audit Trail Overhaul Strategy
## "Legit Cryptographic Audit Logs" — readable by baristas, managers & owners

> **Status: PLANNED — NOT YET IMPLEMENTED.**
> Target branch: `dev` (BLUE) only. Never touch `main` (GREEN/live).

---

## 1. Locked Decisions

| Topic | Decision |
|---|---|
| Default view | **Story View** (plain-language timeline); Technical View one click away |
| Cryptography | **YES — real SHA-256 hash chain** with a Verify Trail button (tamper evidence) |
| Visibility | **Layered**: everyone sees Story View + filters; Technical View, Verify Trail, Export CSV = Admin & above |
| Branch rule | Never touch `main` (GREEN/live); all work on `dev` |

---

## 2. Why the current trail fails (confirmed in code)

1. `action` codes are machine SNAKE_CASE (`EVENING_AUDIT`, `SMART_RECIPE_LINK`, `UNIFIED_EOD_CLOSEOUT`) — meaningless to staff.
2. `details` are dense run-on blobs — timestamps, item names, variances, ₱ figures and notes all glued into one string.
3. `performed_by` is inconsistent: `admin (Admin)`, `Customer / Web`, `System Guard`, `Smart Tracker`, `System Routine`.
4. `GET /api/admin/audit-logs` = flat `SELECT * ... LIMIT 500` — no date range, no category, no who-filter, no search, no pagination (~`server.js:2183`).
5. The Audit tab (`tab-audit` in `admin.html`) is a bare table — the Operational Ledgers tab already has the perfect toolbar pattern (From/To + pills + search + CSV export) that was never applied here.
6. Nothing cryptographic in `audit_logs` — plain 4 columns (`id, timestamp, action, details, performed_by`); anyone with DB access can edit or delete history undetected.
7. Frontend action→human translation is copy-pasted in 3 places (`loadDashboardData` recent-activity feed + dashboard micro security tracker + nothing on the audit tab itself).

---

## 3. Layer 1 — Event Taxonomy (server-side single source of truth)

One map in `server.js` covering all ~28 action codes:
`{ category, icon, humanLabel, severity, storyTemplate }`

Categories (= filter pills):

| Category | Action codes | Story example |
|---|---|---|
| 🔐 **Security & Access** | USER_LOGIN, USER_LOGIN_FAILED, USER_LOGOUT, SECURITY_REAUTH_SUCCESS/FAILED, USER_CREATE, USER_DELETE, CREDENTIALS_UPDATE | "❌ 3 failed login attempts for 'staff_x' today" |
| 🎟️ **Cashier & Promo** | PROMO_CODE_CLAIMED, PROMO_CODE_REDEEMED | "🙋 Ana redeemed voucher MELLE-1234 for customer Santos — 2:14 PM" |
| 📦 **Inventory & Supply** | STOCK_IN, EVENING_AUDIT, STOCK_WASTAGE, POS_SALES_SYNC, EOD_SHIFT_CLOSEOUT, UNIFIED_EOD_CLOSEOUT, INVENTORY_ITEM_CREATED/UPDATED/DELETED, SMART_RECIPE_LINK/UNLINK, SMART_SHIFT_USAGE | "🥛 John logged 2 spilled milk bottles — ₱170.00 loss (SPILLAGE)" |
| 🍽️ **Menu & Storefront** | MENU_ITEM_CREATED/TOGGLE/PRIORITY_UPDATE/DELETED/REORDER, HERO_SLIDE_CREATED/DELETED/REORDER, STORE_SETTINGS_UPDATED | "🍽️ Ana marked 'Iced Matcha Latte' out of stock" |
| 🤖 **System & Automation** | MENU_KILL_SWITCH, DATA_PRIVACY_PURGE | "⚠️ System auto-disabled 2 menu items — Oat Milk ran out" |

Story templates render plain sentences — start minimal (original sparse action set)
and grow freely as new event types arrive, while老 legacy `action` codes keep their mapping.

---

## 4. Layer 2 — Real Cryptographic Hash Chain (tamper evidence)

Migration via `PRAGMA table_info(audit_logs)` + `ALTER TABLE ADD COLUMN`:
- `category TEXT` (backfilled from taxonomy for existing rows)
- `prev_hash TEXT`, `entry_hash TEXT` (NULL for legacy rows → they are honestly shown
  as "unsealed legacy entries", never faked)

`logAudit()` upgrade:
1. Fetch the last row's `entry_hash` (ORDER BY id DESC LIMIT 1).
2. `entry_hash = SHA256(timestamp | action | details | performed_by | prev_hash)`.
3. Insert. Single-threaded SQLite ⇒ no fork risk.

New endpoint `GET /api/admin/audit-logs/verify` (AdminOrAbove):
- Walks the chain last→first validating every link; returns
  `{ integrity: true, entries: N, chained_since: <first hashed entry id/date> }`
  or `{ integrity: false, broken_at: <id + timestamp> }`.
- UI banner: ✅ *"Trail intact — 1,243 linked entries since Oct 29, 2026"* /
  🔴 *"Chain broken at entry #1157 — edited or deleted history detected"*.

---

## 5. Layer 3 — Filterable API (mirrors the Ledgers tab)

`GET /api/admin/audit-logs` gains query params:
`start_date, end_date, category, performed_by, search (free text on details), limit, offset`

- Response includes per-row translated `{ category, icon, label, severity, story }` —
  rendering happens server-side ONCE, never duplicated in the frontend.
- New `GET /api/admin/audit-logs/people` (or distinct-performer list) feeds the
  "Performed by" dropdown.

---

## 6. Layer 4 — The Tab Rebuild (`admin.html` tab-audit + `admin.js` + `admin.css`)

- **Toolbar** (same components as Operational Ledgers):
  From/To date pickers · category pill bar · Performed-by dropdown · search box ·
  Clear Filters · Export CSV (Admin+) · Print.
- **Story View (default):** day-grouped timeline cards — icon chip, plain sentence,
  "who" chip role-colored (Staff bronze / Admin slate / Owner gold / Developer dark),
  time on the right. Day headers: Today / Yesterday / actual dates.
- **Technical View (toggle, Admin & above only):** raw table
  (Timestamp · Action code · Details · Performed by · Hash) for developer/owner
  forensic review.
- **Integrity banner** at top + "Verify Trail" button (Admin+), showing chain status
  and last-verified time.
- **Load-more pagination** (offset) instead of the flat 500-row dump.
- **RBAC:** Staff = Story View + date/category filters only — enforced server-side
  (Technical fields, hash column, and export stripped for Staff role, 403 on verify).

---

## 7. Layer 5 — Kill the duplicate frontend translators

- Delete the inline hand-written action maps in `loadDashboardData()` (Recent
  Activity feed) and the dashboard micro security tracker; both consume the same
  server-returned taxonomy (story strings arrive pre-translated from the API).
- Dashboard feed switches to the same day-grouped Story-card style so both
  surfaces look like one product.

---

## 8. Implementation Order (when approved — dev only)

1. Migration (category + hash columns, backfill categories)
2. `logAudit()` chain writer + taxonomy map
3. Filter/pagination API upgrade + `/verify` endpoint
4. Rebuild `tab-audit` UI (toolbar, Story/Technical views, integrity banner)
5. Rewire dashboard feeds to shared taxonomy
6. Blue testing (restart server to reset in-memory limiter between rounds)
7. Tick `todo.md`

## 9. Test Notes
- Dev DB `database.sqlite`; never print `.env` values.
- Verify-chain test: log events → banner must show ✅; manually run
  `UPDATE audit_logs SET details=...` in dev DB → Verify must flip 🔴 with the correct
  broken-at id; revert, re-verify ✅.
- Audit tab visible as Staff test account (login as a Staff user) to confirm Story
  View renders and Technical/export/verify are 403'd server-side.
- Clean up test rows afterward.


Key Things to Watch Out For During Implementation
Session Regeneration Fixes: Pay close attention to req.session.regenerate() during the login rewrite (P3 in securityplan.md). Ensure you copy over user profiles/permissions after regeneration so the session cookie changes ID, completely neutralizing session-fixation vulnerabilities.   
MD
Rate-Limiter Isolation: Remember that the per-account lockout (locked_until datetime column in the DB) should be independent of your in-memory IP rate limiter. If the server restarts, the IP memory resets, but database locks (locked_until) will safely persist.   
MD
Staff Tab Restrictions: When building the audit log UI for Staff (Layer 4 & 6), double-check that the backend strictly filters responses or blocks requests to the /verify endpoint and Technical View data before it ever hits the browser. Don't rely solely on CSS hiding.