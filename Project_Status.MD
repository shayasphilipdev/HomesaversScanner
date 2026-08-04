# Homesavers Scanner — Project Status

A self-contained snapshot of the whole app as it stands today. If you are a
fresh Claude session opening this repo cold, **read this file first** — it has
the architecture, data model, every module, recent changes, known issues, and
the project memory all in one place.

*Last updated: 2026-07-31.*

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
endpoints), `CLOUDFLARE_API_TOKEN` (added 2026-07-31 — Account Analytics: Read
+ Workers Scripts: Read; powers the Settings → Cloudflare requests chart, §6).
`SUPABASE_URL` and `CLOUDFLARE_ACCOUNT_ID` are non-secret in `wrangler.toml`.

**Platform limits to design around (discovered 2026-07-31):** the Cloudflare
account is on the **Free** Workers/Pages plan — 100,000 requests/day
account-wide, **10 ms CPU time per request** (hard kill, not catchable), 50
subrequests per request. A single long-lived request that loops internally
making many Supabase calls, or that does heavy per-row JS (JSON.stringify
over thousands of rows), will silently die against these caps with no
JS-catchable error — the client just sees a truncated response or a bare
500/503. New features that touch large datasets must page from the
**client**, keep each request's own JS work minimal (push formatting into
Postgres where possible), and avoid frequent polling / reload-after-every-
mutation patterns. See §11 (2026-07-31) and §12 for what this broke and how
it was fixed.

**DB statement_timeout — root cause of the `57014` timeouts (fixed 2026-08-04):**
the app has **no Supabase Auth**, so every query runs through the Pages Function
as the **`anon`** Postgres role. Supabase had `anon` capped at
`statement_timeout=3s` (vs 8s for `authenticated`/`authenticator`), so any query
over the 320k-row `task_records` (reports, batch deletes, dashboard) that took
>3s was cancelled with `57014 canceling statement due to statement timeout`.
Raised with `ALTER ROLE anon SET statement_timeout = '15s'; NOTIFY pgrst,
'reload config';`. To check/change: `SELECT rolname, rolconfig FROM pg_roles
WHERE rolname='anon';`. This is the first thing to check if broad timeouts
reappear — it is NOT bloat (table was only ~5% dead, autovacuum healthy).

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
- **Scale (as of 2026-07-31):** ~294k rows, ~251k not `cleared`, growing
  ~40-75k/week. Indexes added for this volume: `idx_tr_active_store_date
  (store_id, created_at) WHERE status<>'cleared'`, `idx_tr_active_created_at
  (created_at) WHERE status<>'cleared'`, `idx_tr_created_at_id (created_at, id)`
  — the last one backs keyset (seek) pagination via `ROW(created_at,id) >
  ROW(cursor)`, which only plans as an index seek when written as a literal
  row-comparison in raw/dynamic SQL — PostgREST's REST filter syntax and a
  plain `OFFSET` loop both degrade badly at this size (see §11).

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
  (`/reports/task-records`). **Rebuilt 2026-07-31** for data volume — the
  client now drives pagination itself, calling `?format=json` once per page
  (cursor via `after_created_at`/`after_id`) and accumulating rows before
  building the `.xlsx`, instead of the server assembling the whole export in
  one long-lived request (see §11 for why that stopped working). Each page
  hits `report_task_records_flat_page`, which does the store/task-type joins
  and `details`/date formatting **in Postgres** (`fmt_task_details`,
  `to_char(... 'Europe/Dublin' ...)`) so the Worker just passes the response
  text through instead of looping over rows in JS. Plain CSV
  (`report_task_records_page`, still server-streamed, unused by the current
  UI) is kept working for any direct link. Also "Master Reports" (Product
  Master, lookups) for admin/buying_manager.
- **Dashboard** (`/dashboard`): KPI cards, 14-day activity chart, by-task-type
  bars, **HO task allocation donut**, **status breakdown** card, by-store (BO),
  recent activity (shows product description, not code). Stats via the
  `dashboard_stats` Postgres RPC (`work_mem='32MB'` set on the function itself
  since 2026-07-31 — eliminates a disk-spill sort at current row counts; see
  §12 for the recurring-timeout issue that isn't fully resolved).
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
- **Settings** (`/admin/settings`, `admin` role only): retention windows,
  maintenance (manual photo/record cleanup — see §12 re: automation),
  Supabase capacity meters, and (added 2026-07-31) a **Cloudflare requests**
  chart — 7 days of daily Worker/Pages Functions request counts vs. the
  100k/day free-tier cap, via `GET /admin/cloudflare-usage` calling
  Cloudflare's own GraphQL Analytics API (`workersInvocationsAdaptive`,
  dimension `date` — note: **not** `...AdaptiveGroups`/`datetimeDay`, which
  don't exist despite matching Cloudflare's naming convention elsewhere).
  Loaded on page-open + manual refresh only, never polled, so it doesn't add
  to the number it's tracking.
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

## 11. Recent work

### 2026-07-31 — Data volume: purge, dashboard/report performance, Cloudflare limits

Triggered by `task_records` reaching ~325k rows (55 stores, months of live
scanning) and the DB size alarm crossing 60%+.

- **One-time purge + reclaim:** deleted `cleared`/`store_completed` rows past
  `scan_record_retention_days` (14d) — 40,634 rows — then `VACUUM FULL` on
  `task_records` + `task_record_events` (320MB → 262MB). **Not automated** —
  see §12, only 401 rows are eligible on a normal day since the 14-day window
  is already "caught up"; the bulk of current size is legitimate active data,
  not un-purged bloat.
- **Dashboard (`dashboard_stats`) statement timeouts (`57014`):** several
  layered causes, fixed as found —
  1. Missing index for the unscoped ("all stores") case → added
     `idx_tr_active_created_at`.
  2. `work_mem` defaults to ~2.1MB on this Supabase compute tier → the
     function's own GROUP BY/sort steps were spilling ~176MB to disk per call.
     Fixed with `ALTER FUNCTION dashboard_stats(...) SET work_mem = '32MB'`
     (function-scoped, not instance-wide).
  3. A store-scope array covering *every* active store (rather than a true
     `NULL`/admin session) forced Postgres into ~13x more index pages read
     (59 small per-store scans merged, vs. one clean scan). Fixed in
     `/dashboard/stats` by normalizing such an array back to `null` before
     calling the RPC.
  - **Still open:** recurring `57014`s continue under real concurrent load
    even though every isolated test after the above fixes runs in 1-3s — see
    §12. Proposed but not built: short-TTL caching of `dashboard_stats`
    results so concurrent dashboard opens within the same window share one
    computation.
- **Excel export (`/reports/task-records?format=json`) — rebuilt three times
  as each fix exposed the next bottleneck:**
  1. `OFFSET`-based Worker-side pagination → replaced with keyset seek
     pagination (`report_task_records_page`, `idx_tr_created_at_id`).
  2. Still failed on large exports (500/503, `Unexpected end of JSON input`)
     — root cause was the **Cloudflare Free plan's 50-subrequests-per-request
     and 10ms-CPU-per-request limits** (see §3), not the DB. A single
     long-lived Worker request doing 20-40+ internal Supabase calls, or
     looping JS-side `flatten()`+`JSON.stringify()` over 10k+ rows, silently
     exceeds these — not a catchable error, so the client just got a
     truncated/dead response.
  3. Fixed by moving pagination to the **client** (`Reports.jsx` calls one
     page at a time via `after_created_at`/`after_id`, accumulates, then
     builds the `.xlsx`) and moving row **formatting into Postgres**
     (`report_task_records_flat_page` — joins + `fmt_task_details` +
     `to_char(...)` server-side, Worker does a cheap string-concat passthrough
     instead of a JS parse+rebuild). Page size raised to 50k rows/page since
     the Worker's own CPU cost per request is now near-zero. Added
     retry-with-backoff per page for transient Supabase blips.
- **Cloudflare daily request cap (hit 76%):** found and fixed the actual
  dominant cause — every scan-save across **all 10 task forms**
  (`Task[A-K]Form.jsx`) called `load()` afterward, re-fetching the entire
  task-records list (500 rows) even though the save's own response already
  returns the full created record. That's 3 Worker requests per scan
  (lookup, save, reload) × 55 stores scanning all day. Each form now passes
  the created record through `onSaved`; `Tasks.jsx` appends it to local state
  instead of refetching (falls back to `load()` only for the rare
  offline-queued case, which has no server record yet).
- **Settings → Cloudflare requests chart** added for ongoing visibility — see
  §6. Needed a **`Workers Scripts: Read`** token permission in addition to
  the documented `Account Analytics: Read` — the latter alone gave
  `"authorization denied"` on `workersInvocationsAdaptive` even though it's
  what Cloudflare's own docs say to use.
- **One-off manual DB export:** full raw `task_records` dump to CSV
  (290,364 rows, 102MB) via direct Supabase access, paginated 20k rows/call
  server-side (using two temporary SQL helper functions, dropped after) —
  not an app feature, a one-time ask.

### 2026-06 (previous session)

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
- **`dashboard_stats` still times out (`57014`) intermittently under real
  load**, despite the fixes in §11 (2026-07-31). Every isolated test after
  those fixes completes in 1-3s regardless of scope (admin/null or a 10-store
  area-manager array), with locks, autovacuum, checkpoint I/O overlap, and
  table bloat all ruled out directly against Postgres logs/stats. What's left
  is CPU contention on a small, shared Supabase compute tier — several
  concurrent multi-second aggregation queries (e.g. several BO/area-manager
  dashboards opened around the same time) can plausibly stack into the full
  2-minute timeout even though no single query is ever that slow alone. Query
  tuning has hit its ceiling here; the two realistic remaining levers are a
  short-TTL cache in front of `dashboard_stats` (proposed, not built) or a
  paid Supabase compute tier.
- **`task_records` retention purge is manual, not automated.** The 14-day
  window for `cleared`/`store_completed` rows is "caught up" after the
  2026-07-31 one-time purge (only ~400 rows eligible on a normal day), but
  nothing runs `/admin/cleanup/task-records` on a schedule — it's a button in
  Settings → Maintenance. Active (non-cleared) rows grow ~40-75k/week
  regardless of this and are NOT something the purge addresses (they're live
  pending/reviewed data, not stale). Automating the purge call (Cloudflare
  Cron Trigger or an external cron hitting the endpoint, same pattern as the
  existing Supabase keepalive ping) was discussed and deferred by request.
- **Cloudflare Free plan limits are real design constraints now**, not just
  theoretical — see §3. Confirmed empirically 2026-07-31: 50
  subrequests/request and 10ms CPU/request killed the Excel export outright
  until fixed; the account also hit 76% of the 100k/day request cap from
  normal operation (mostly the since-fixed reload-after-save pattern). Any
  new feature touching bulk data or firing on a high-frequency action should
  be checked against these before shipping.

---

## 13. Backlog / planned (not yet built)

Items requested but deliberately deferred — to be built later.

- **`dashboard_stats` short-TTL cache** *(proposed 2026-07-31, not yet
  approved/built)* — cache the RPC result for ~30-60s (keyed on
  from/to/store_ids) so concurrent dashboard opens in the same window share
  one computation instead of each triggering the full aggregation. Aimed at
  the recurring statement-timeout issue in §12 that query tuning alone
  couldn't fully resolve.
- **Automate the `task_records` retention purge** *(discussed 2026-07-31,
  deferred by request)* — currently a manual button
  (`/admin/cleanup/task-records`) in Settings → Maintenance. Wire it to a
  schedule (Cloudflare Cron Trigger, or an external cron hitting the endpoint
  like the existing Supabase keepalive ping) so it doesn't need a person to
  remember to click it.
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
