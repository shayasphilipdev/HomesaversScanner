# Homesavers Scanner — Project Status

A self-contained snapshot of the whole app as it stands today. If you are a
fresh Claude session opening this repo cold, **read this file first** — it has
the architecture, data model, every module, recent changes, known issues, and
the project memory all in one place.

*Last updated: 2026-06-26.*

---

## 1. What it is

A mobile-first retail web app for **Homesavers Ireland** (~55 stores). Two
systems live side by side:

1. **HO Tasks** — store staff scan a product (HID scanner gun, phone camera, or
   manual entry) and log an issue/query against one of **11 task types**. Head
   Office ("Support Office") reviews each record. Records can carry a two-way
   **message thread** between store and HO.
2. **Store Tasks** — a configurable daily checklist (form-builder templates →
   per-day instances) that managers monitor for compliance.

Plus supporting modules: **Space Plan** (store equipment/department count
collection), **Reports** (Excel/CSV), **Dashboard** (stats + charts),
**Product Query** board, **Suppliers** admin, **Product Master** browse, and a
scheduled **status-report email**.

Installable PWA; works offline (service worker + IndexedDB outbox).

---

## 2. Where it lives

| Thing | Value |
|---|---|
| Live app | https://homesaversscanner.pages.dev/ |
| GitHub | https://github.com/shayasphilipdev/HomesaversScanner (public) |
| Local source (primary dev box / back-office PC) | `C:\Scraping\homesavers-scanner` |
| Supabase project | `eggspkdengnxktwkdwpw` · https://eggspkdengnxktwkdwpw.supabase.co (Postgres 17) |
| Sync secret file | `C:\Homesavers\.sync-secret` (shared by sync jobs + aging report) |
| Logs | `C:\Homesavers\logs\` |

No secrets in the repo (`.gitignore` covers `.env`, `.dev.vars`,
`aging-report.config.json`, `node_modules`).

**Deploy:** every push to `main` auto-builds on Cloudflare Pages
(`cd client && npm install && npm run build` → `client/dist`). The Pages
Function `functions/api/[[route]].js` is the entire backend.

> ⚠️ Constraints to respect (from the user, standing):
> - Do **not** touch `C:\Scraping\PriceTracker` — a separate project.
> - **No Supabase Auth / no RLS** — access is controlled at the application layer.
> - The sync secret at `C:\Homesavers\.sync-secret` must never be exposed.

---

## 3. Tech stack & architecture

- **Frontend:** React 18 + Vite, plain JS (no TypeScript), react-router-dom v6.
  Single hand-written `client/src/App.css` themed via `[data-theme]` (no CSS
  framework). Charts are inline SVG (no chart lib). Camera = `html5-qrcode`
  (lazy). Excel export = `xlsx` (SheetJS, lazy).
- **Backend:** one Cloudflare Pages Function `functions/api/[[route]].js`
  handling all `/api/*`. Web Crypto HMAC tokens, fetch-only (no Node deps). It
  holds the Supabase key and proxies PostgREST + Storage.
- **Database:** Supabase Postgres, **RLS disabled**, anon role granted on all
  tables. The browser never talks to Supabase directly.
- **Storage:** Supabase bucket `task-photos` (public-read) for Task B photos.
- **Local data-sync server:** a Python helper on the back-office PC
  (`http://localhost:8765`) parses big VRS Excel files (pandas/openpyxl) into
  `alt_barcodes` / `prices`. See `scripts/` README files.

```
Browser (React PWA) ──/api/*  Bearer <HMAC token>──▶ Cloudflare Pages
   (sw.js + IndexedDB outbox)                          ├─ serves client/dist
                                                        └─ functions/api/[[route]].js
                                                              │ SUPABASE_URL (wrangler.toml [vars])
                                                              │ SUPABASE_ANON_KEY (CF Secret)
                                                              │ SESSION_SECRET (CF Secret)
                                                              │ PRODUCT_SYNC_SECRET (CF Secret)
                                                              ▼
                                                        Supabase Postgres + Storage
```

**Cloudflare secrets:** `SUPABASE_ANON_KEY`, `SESSION_SECRET`,
`PRODUCT_SYNC_SECRET` (gates the secret-authed sync + `/reports/aging`
endpoints). `SUPABASE_URL` is non-secret in `wrangler.toml`.

---

## 4. Auth & roles (current model — "single login")

No PIN-per-store any more. **Every employee logs in with username + PIN** →
`POST /api/users/verify-pin` → HMAC-signed session token.

- **Roles** (single role per user), defined in `client/src/lib/roles.js` and
  mirrored in the backend:
  - `STORE_ROLE_KEYS` = `sales_assistant · supervisor · assistant_store_manager · store_manager` → session `mode='store'`
  - `HQ_ROLE_KEYS` (BO) = `area_manager · support_admin · buying_manager · buying_head · admin` → `mode='backoffice'`
- **Scope:** `users` carries `all_stores (bool)`, `store_ids uuid[]`,
  `area_ids uuid[]`. The backend helper `scopedStoreIds(db, session)` resolves
  these to a concrete store-id set (`null` = all/admin, `[]` = none) and drives
  every multi-store filter (records, store tasks, reports, dashboard, space plan).
- **Per-employee toggles:** `can_access_hq_tasks`, `can_access_store_tasks`
  (hide either system for a person; enforced server-side + in nav).
- **Session storage:** `mode==='backoffice'` → `sessionStorage` (clears on tab
  close); `mode==='store'` → `localStorage` (24h). Token hours:
  store 24h, back-office 12h.
- **Area managers:** role `area_manager` is in `BO_ROLES` (mode backoffice) and
  gets the multi-store dashboard, BUT the frontend deliberately excludes them
  from `isBO` for **record-clearing** so they get the store-style ✓ Clear /
  bulk-clear UI. (Backend `isBackOffice()` still treats them as BO.)
- Backend role guards: `isBackOffice`, `isAdminRole` (admin · buying_manager),
  `canCreateTasks`, `userCanAccessHQTasks/StoreTasks`. Admin pages require
  admin/buying_manager via `AdminGuard`.

---

## 5. Data model (current — `public` schema, RLS off)

Grouped by area. (Exact columns live in the SQL editor; the important shape is
below.)

**HO Tasks**
- `task_types` — 11 rows. `code · name · frequency · sort_order · is_active`.
  Order/codes: **K Price Check**, **J Department Check**, B Non-Scans,
  C Wrong Prices, D Wrong Description, A UOM Errors, E Price Marked Products,
  F DRS Errors, G Promotion Error, H Stock Count (once-off), I Miscellaneous
  (once-off). (J and K are high-volume scan/confirm checks; A–F are the query
  types that appear in reports/aging.)
- `task_records` (30 cols) — main fact table. Key: `store_id · task_type ·
  status (pending|completed|no_change_needed|store_completed|cleared) ·
  product_code · product_barcode · barcode_no · item_name · description ·
  product_name_label · supl_id · supplier_code · item_status · barcode_status ·
  uom · quantity · notes · review_notes · details (jsonb) · photo_*_url ·
  marked_for_deletion · cleared_at · completed_at · store_completed_at ·
  reviewed_at · created_at · updated_at`. Type-specific fields go in `details`
  (e.g. `item_group` for J/K, `reason_code`, prices, `drs_size`, `shop_floor_count`).
- `task_record_events` — append-only audit ledger of every status transition.
- `task_record_messages` — per-record two-way thread. `record_id · author_id ·
  author_name · author_role · body · is_read_by_store · is_read_by_bo · created_at`.

**Product data** (read-only master, synced from VRS Excel)
- `alt_barcodes` — `barcode_no (scanned key) · ean_barcode · item_name ·
  supl_id · supplier_code · item_status · barcode_status · is_primary · …`.
- `prices` — `ean_barcode · item_group · item_subgrp_id · product_type · sale_rate`.
- `product_master` (**view**) — joins alt_barcodes + prices, one row per
  primary barcode. Columns: `product_code(=ean) · product_description · selling_price ·
  category(=item_group) · subcategory(=item_subgrp_id) · product_barcode(=barcode_no) ·
  product_status · barcode_status · product_type · supplier(=supl_id)`.
- **Scan lookup chain:** scan → `alt_barcodes.barcode_no` → `ean_barcode` →
  `prices.ean_barcode` → `item_group` (department).

**Suppliers**
- `suppliers` — `supplier_code · supplier_name · is_active · timestamps`.
  Created this session (the table was missing); **82 loaded once** from distinct
  `alt_barcodes.supplier_code` with `initcap(supl_id)` proper-case names.
  Product Master is filtered to **active** suppliers by default (resolves
  supplier_code → supl_id via alt_barcodes).

**Space Plan** (store equipment count collection)
- `space_plan_equipment` — 23 types, `is_active` DEFAULT **false** (hidden by
  default; admin unhides when a store should collect it).
- `space_plan_equipment_subcategory` — subcategory tier. Currently only
  **PRIMARY BAYS** has 5: Outers 2m/2.6m, Inners 1.8m/2m/2.6m.
- `space_plan_categories` — 26 departments.
- `space_plan_planned` — planned count per (store, equipment) — the
  de-duplicated source-file "Column C".
- `space_plan_counts` — audited count per (store, equipment, **subcategory**,
  category); latest value only; `subcategory_id` nullable; unique index
  `(store, equipment, subcategory, category) NULLS NOT DISTINCT`.
- Seeded from `C:\Users\shayas\Data\Homesavers\PROJECTS\Space Plan\SpacePlanCountCollection.xlsx`
  (54 stores matched; codes 1003,1073–1077 not in app, skipped).

**Store Tasks**
- `store_task_templates` (24 cols) — form-builder: `blocks (jsonb)` ordered
  input blocks, `assigned_to_role(s)`, `assigned_to_user_ids[]`, scope,
  `start_at/end_at`, category, frequency, requires_photo/notes.
- `store_task_instances` — per-day materialised tasks; `answers (jsonb)` keyed
  by block id; status pending|completed|missed.

**Other**
- `stores` — `store_code (e.g. '1015') · store_name · region · area_id ·
  is_active`. Store codes match the planogram/Excel numeric codes.
- `areas` — area master.
- `lookup_options` — generic dropdown master (`kind` = reason_code | drs_size |
  task_category | …; `task_types[]`).
- `users` (20 cols) — see Auth above.
- `product_questions` / `product_question_answers` — the Product Query board.
- `sync_runs` — history of data-sync / generation jobs (shown in Admin → Settings).
- `app_settings` — key/value (`backoffice_pin_hash`, retention days, etc.).

---

## 6. Modules & features (current)

- **HO Tasks** (`/tasks`, `pages/Tasks.jsx`): task-type picker → `TaskForm` →
  one of `forms/Task[A-K]Form.jsx`; records list (`TaskRecordList.jsx`) with
  status badges, ✓ Clear (store), Mark complete (BO), 💬 message thread, and
  audit history. Every form uses the shared **`ScannerInput`** (see §7).
- **Reports** (`/reports`): filter by date/store/task-type/status; on-screen
  table with BO bulk-review and **store bulk-clear**; Excel/CSV export
  (`/reports/task-records`, paginated past the 1000-row cap). Also "Master
  Reports" (Product Master, lookups) for admin/buying_manager.
- **Dashboard** (`/dashboard`): KPI cards, 14-day activity chart, by-task-type
  bars, **HO task allocation donut**, **status breakdown** card, by-store (BO),
  recent activity (shows product description, not code). Stats via the
  `dashboard_stats` Postgres RPC.
- **Space Plan** (`/space-plan`, admin `/admin/space-plan`): per-store grid,
  Equipment Variance summary (planned vs audited total), auto-save, Excel
  export. PRIMARY BAYS renders subcategory sub-rows (mobile: collapsible). Admin
  hides/unhides equipment and edits planned counts.
- **Messages:** clickable mail icon in the header (`Nav.jsx`) → dropdown of
  threads with unread messages (one-line preview, per-thread + total unread
  count) → clicking opens the record's thread in HO Tasks. Endpoints
  `/task-messages/threads`, `/task-messages/unread-count`, `/task-records/:id/messages*`.
- **Store Tasks** (`/store-tasks`), **Product Query** (`/product-query`),
  **Suppliers** admin (`/admin/suppliers`), **Product Master** browse.
- **Status-report email** — see §9.

---

## 7. Scanner input (`components/forms/ScannerInput.jsx`)

Shared by all HO task forms. Behaviour (after several iterations):
- **Auto-focus** the barcode field on open and re-focus when it clears
  (after Save/Clear), via `requestAnimationFrame` (reliable on tablets).
- **Global capture-phase key listener** buffers an HID scanner gun's keystrokes
  when no input is focused; recognises Enter via `e.key` OR `keyCode 13/10`.
- The focused-input path also recognises Enter via keyCode (some guns send
  `e.key='Unidentified'`).
- **Terminator-independent lookup:** a debounced "auto-settle" effect fires the
  lookup ~250 ms after the scanned value stops changing, so it works even for
  guns that send no Enter/Tab. A `lastConfirmed` guard prevents duplicate
  lookups. (This fixed "lookup only fires after a button press".)
- **Mobile soft-keyboard suppression:** `inputMode='none'` keeps the field
  focused for the gun without popping the on-screen keyboard; a real tap flips
  it to `inputMode='text'` for manual entry; resets to none when the field clears.
- Optional camera scanner (lazy `html5-qrcode`, N-of-3 confirmation), shown only
  when an admin enables it (`hs_camera_enabled`).

---

## 8. Offline (PWA)

- `client/public/sw.js` service worker — **NOTE:** the repo registers `/sw.js`
  but the file may not be present in `public/`, so the SW often fails to
  register (no stale-cache problems, but also no offline shell). Verify before
  relying on offline.
- IndexedDB outbox `lib/outbox.js` — queues records (`simple` / `with_photos`),
  drains on `online` / `visibilitychange` / first mount / manual `/sync` tap.
  Bounded retries (5) for server errors; `drain()` also enriches offline records
  with the alt-barcode/price lookup before posting.

---

## 9. Scheduled status-report email (`scripts/aging-report.py`)

Runs on the back-office PC via Windows Task Scheduler — task name **"Homesavers
Aging Report"**, schedule **every Wednesday 08:00** (`schtasks /SC WEEKLY /D WED
/ST 08:00`). Config in `scripts/aging-report.config.json` (git-ignored, holds
the Brevo SMTP key). Setup doc: `scripts/AGING-REPORT-SETUP.md`.

- Pulls PENDING query records (types A–F) from `GET /api/reports/aging`
  (secret-authed), plus `created_last7` per type (any status, incl. J/K).
- Email body: green-gradient header; KPI boxes (Total pending · Pending over 3
  days · Longest wait); **"Pending queries by type"** table (6 types, light
  green gradient headers, days-pending buckets); **"Created in the last 7 days"**
  strip of small boxes (incl. Department Check / Price Check); per-category Excel
  attachments. Professional copy, no "aging/calculation" jargon. Subject
  "Homesavers Store Query Status Report - DD/MM/YYYY".
- Recipients: **To** naeem@a-i-m.ie · jeff@homesavers.ie · shauna@supplychain1.ie;
  **Cc** shayas.philip@supplychain1.ie · chamya.herath@supplychain1.ie.
- Test: `py scripts\aging-report.py --dry-run` (writes `aging-report-preview.html`,
  no send).

---

## 10. Key files

```
functions/api/[[route]].js     ALL backend logic (sb() helper, auth, every endpoint)
client/src/
  App.jsx            routes + Shell (wide-container logic) + session
  App.css            single themed stylesheet ([data-theme] light/dark, glass)
  main.jsx           React mount + SW registration
  lib/
    api.js           fetch wrapper + every endpoint helper + token storage
    roles.js         role catalogue + predicates (mirror of backend guards)
    currentStore.jsx CurrentStoreProvider (scoped store picker)
    excel.js         downloadExcel (lazy SheetJS)
    outbox.js        IndexedDB offline queue
    taskTypes.js     TASK_FORMS metadata (name per code)
  components/
    Nav.jsx          top bar + messages dropdown
    Sidebar.jsx / BottomNav.jsx   ≥1024 sidebar / ≤720 bottom tabs
    TaskForm.jsx · TaskRecordList.jsx · RecordMessages.jsx
    forms/ScannerInput.jsx + Task[A-K]Form.jsx + useTaskForm.jsx
  pages/
    Dashboard.jsx · Tasks.jsx · Reports.jsx · StoreTasks.jsx · ProductQuery.jsx
    SpacePlan.jsx · Admin*.jsx (Stores/Areas/Users/Employees/Lookups/Products/
                                Suppliers/SpacePlan/Settings/Reports/TaskTemplates)
scripts/
  aging-report.py (+ .config.json/.example, AGING-REPORT-SETUP.md)
  sync product scripts (README-sync-*.md, WINDOWS-SERVICE.md)
docs/  user-manual.html · department-check-guide.html · phase8-roles-...md
```

---

## 11. Recent work (this session — 2026-06)

- **Dept-check race fix:** generation counter in `useTaskForm` + `priceInfo`
  state in `TaskJForm`; backfilled 1,344 historical null records.
- **Offline enrichment** of records at sync time.
- **Scan reminder banner** ("scan the product barcode, not the SEL"), once/session.
- **Per-record message threads** → now a **clickable header dropdown** with
  previews + open-record + unread badge, visible on every page incl. mobile.
- **Suppliers:** created the missing `suppliers` table, loaded 82 (proper-case),
  removed the self-service seed; Product Master filtered to active suppliers.
- **Task NAME everywhere** (no bare letters); guides updated to all 11 tasks.
- **Reports:** store bulk-clear; column reorder to requested numbering; Details
  shows bare category (no "Category:"); **fixed 1000-row export cap** (HS
  Tallaght 1015 = 6,112 records).
- **Space Plan** module built end-to-end; later added the **subcategory** tier
  under PRIMARY BAYS; layout iterations (full-width → capped/centred, square
  category cells with borders, bigger fonts; mobile collapsible bold subcats).
- **Status-report email**: CC support, redesign, Wednesday-08:00 schedule, 6
  query types, "Created in the last 7 days" strip, "Support Office" wording.
- **Scanner:** focus-on-open / refocus-after-save; terminator-independent
  lookup; mobile keyboard suppression.
- **Dashboard:** HO task allocation donut + status breakdown.
- **Theme:** greener gradient + green card headers (like the email), deeper
  glass; bottom-nav HO/Tasks swap + Space Plan accent icon.

---

## 12. Known issues / watch-outs

- **Service worker `/sw.js` may be absent** in `public/` → SW registration
  fails silently; no offline shell. Hashed assets + HTML still deploy fresh.
- **Local end-to-end is hard to drive here:** the app is session-authed and
  needs Cloudflare-only secrets + a login PIN; the scanner needs real hardware.
  Most verification is at build + DB-logic level. The `/reports/aging` feed is
  the one secret-authed endpoint testable from the back-office PC.
- **Messages "open record"** reliably works for **store logins** (their records
  are in their HO Tasks list); for BO users on a different current store the
  record may not be in the loaded list.
- **Space Plan grid** is intentionally wide (26 category squares) — scrolls
  horizontally inside the centred container on smaller screens.
- Older docs (`docs/phase8-...md`, parts of `CLAUDE.md`) describe earlier
  designs; this file is the current source of truth.

---

## 13. Backlog / planned (not yet built)

Items requested but deliberately deferred — to be built later.

- **In-app feedback form** *(requested 2026-06-26)* — let any logged-in user
  submit feedback / suggestions / bug reports from inside the app. Not yet
  implemented; placeholder for the future build. Likely shape when picked up:
  - **DB:** new `feedback` table — `id · user_id · user_name · role · store_id
    (nullable) · category (suggestion|bug|other) · message · status
    (new|reviewed|closed) · created_at`. Grant anon, no RLS (mirror the rest).
  - **Backend:** `POST /api/feedback` (insert, stamps the session user) and
    `GET /api/feedback` (admin/buying_manager only, for review).
  - **Frontend:** a small `/feedback` route + nav entry (or a header/footer
    "Send feedback" button opening a modal); admin sees submissions under
    Reports or Admin. Keep it lightweight — one textarea + a category select.

---

## 14. Local dev & ops

```powershell
# Terminal 1 — Vite
cd C:\Scraping\homesavers-scanner\client ; npm install ; npm run dev   # :5173

# Terminal 2 — Pages Functions (needs .dev.vars with the secrets)
cd C:\Scraping\homesavers-scanner ; npx wrangler pages dev --proxy 5173 # :8788
```

- DB changes: use the Supabase MCP (`apply_migration` for DDL, `execute_sql`
  for data) against project `eggspkdengnxktwkdwpw`. RLS off; grant anon on new
  tables and mirror the no-RLS setup.
- Deploy: just `git push` to `main`.
- Common ops: add a store (Admin → Stores / SQL); manage employees (Admin →
  Employees, scope via `ScopePicker`); enable Space Plan equipment (Admin →
  Space Plan); manage suppliers (Admin → Suppliers).

---

## 15. Project memory (mirrors `~/.claude/.../memory/`)

These are the auto-loaded memory facts, embedded here so a cold session has
them even before recall kicks in.

**Project overview** — Homesavers retail scanner; React+Vite on Cloudflare
Pages; Supabase Postgres (`eggspkdengnxktwkdwpw`); no Supabase Auth / no RLS;
deploy = push to `main`. Don't touch `C:\Scraping\PriceTracker`; never expose
`C:\Homesavers\.sync-secret`.

**Architecture facts** — single login (username + PIN, `/users/verify-pin`);
roles drive `mode` store/backoffice; `scopedStoreIds` resolves multi-store
scope; area managers are BO-mode but get store-style clear UI;
`product_master` view exposes `supl_id AS supplier` (so the supplier filter must
map supplier_code → supl_id via alt_barcodes); message author's own side is
marked read immediately, the opposite side unread.

**Feature history** — see §11 above (kept in sync with
`memory/feature_history.md`).

---

*Maintainers: keep §11 and §12 current after each batch of work; re-pull the
table list (§5) from the DB if the schema changes.*
