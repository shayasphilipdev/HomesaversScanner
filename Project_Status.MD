# Homesavers Scanner — Project Status

A self-contained snapshot of the whole app as it stands today. If you are a
fresh Claude session opening this repo cold, **read this file first** — it has
the architecture, data model, every module, recent changes, known issues, and
the project memory all in one place.

*Last updated: 2026-09-11.*

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

### Branch rule (standing, from the user)

| Branch | Builds | Purpose |
|---|---|---|
| `main` | Live app — https://homesaversscanner.pages.dev/ | Production, 55 stores |
| `test` | Test app — https://test.homesaversscanner.pages.dev/ | Trying things that can't be tested on live |

**The rule is one-directional:**

- **Anything `main` gets, `test` gets.** Every change landed on `main` must also be
  propagated to `test` (cherry-pick), so `test` is never behind live.
- **Anything specific to `test` stays on `test` only.** Test-only experiments must
  never be pushed to `main` until they are ready to go live.

So `test` should always be **`main` plus whatever is still under test** — never a
branch that is missing live features.

> 📌 **Current reality (2026-08-27):** the rule applies **going forward**. `test` is
> *not* yet caught up — it is missing roughly 25 commits of live work (Dead Stock
> report, CN-code master sync, B&M daily sync, most of the Dashboard evolution,
> message-thread photo attachments, the pricing scroll fix, the 21-day retention
> standardisation). Bringing it level would be `git merge main` into `test`, with
> conflicts expected wherever the same change was already cherry-picked. The user
> has decided to **leave this gap as-is for now** — do not "fix" it unprompted.
> Note `git log test..main` overstates the gap (~40), because many of those commits
> have same-content twins on `test` with different hashes from cherry-picks.
>
> Practical consequence: do not assume a feature present on `main` exists on `test`.
> Check before relying on it — e.g. message-thread photo attachments exist only on
> `main`, so screenshot paste support could not be wired into that component there.

> ⚠️ Both apps share **one** Supabase database. A schema or `task_types` change is
> visible to live immediately, regardless of which branch's code you deployed. Ship
> the gating code to **both** branches *before* running a migration that activates
> something new. Task-type visibility is gated client-side via `isTestEnv()`
> (hostname check), not by any database flag.

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

**Record retention — now server-side via pg_cron (changed 2026-08-04):** the old
retention only auto-deleted `cleared`/`store_completed` rows, so ~140k **pending**
J/K piled up. Now a **pg_cron** job `purge-old-task-records` (daily 02:00 UTC)
runs `SELECT public.purge_old_task_records()`, which deletes every `task_records`
row older than `app_settings.scan_record_retention_days` (14) **EXCEPT** still-
pending HO query records (A–I) — i.e. rule `created_at < cutoff AND (task_type IN
('J','K') OR status <> 'pending')`.
**IMPORTANT (fixed 2026-08-10):** this MUST be a plain FUNCTION called via
`SELECT` doing ONE `DELETE` — the original was a PROCEDURE with a batched
`COMMIT` loop called via `CALL`, which pg_cron cannot run (`invalid transaction
termination`), so it silently failed every night for ~5 days. The cron role has
no `statement_timeout`, so a single DELETE is safe even for a large backlog; at
steady state it's tiny. `delete_old_task_records_batch(cutoff, limit)` remains
as a single-batch helper for manual, business-hours backlog clears (SKIP LOCKED,
short locks). Check it's actually running: `SELECT j.jobname, d.status,
d.start_time, d.return_message FROM cron.job_run_details d JOIN cron.job j USING
(jobid) ORDER BY d.start_time DESC;`. Runs entirely in
the DB (independent of the Cloudflare login-triggered `runAutoCleanup`, which
still handles photo + product-query cleanup). Backlog of 165k was purged
2026-08-04, table 302k→137k. Manage: `SELECT * FROM cron.job;` /
`cron.unschedule('purge-old-task-records')`. Photos of deleted rows are reclaimed
by the existing age-based photo cleanup, not by this job.

**Disk space ≠ row count (gotcha, 2026-08-04):** a `DELETE` does NOT return disk
to the OS — it only marks rows dead; autovacuum frees them for *reuse inside the
file*, so `pg_database_size` stays at the high-water mark. After the 165k-row
purge the DB still showed ~350 MB (70% of the 500 MB free-tier cap). Ran
`VACUUM (FULL, ANALYZE) task_records;` and `... task_record_events;` (rewrites
table + rebuilds indexes, briefly ACCESS-EXCLUSIVE-locks the table) → DB dropped
to **191 MB**. Steady-state now self-balances (daily deletes ≈ daily inserts, space
recycled). **Automated nightly compaction (added 2026-08-05):** two pg_cron jobs
run VACUUM FULL just after the 02:00 purge — `vacuum-task-records` (02:30 UTC)
and `vacuum-task-events` (02:40 UTC) — so the day's deletions (nightly purge +
ad-hoc J/K deletes) are returned to the OS each night while stores are closed
(03:30 Irish). VACUUM FULL takes an ACCESS-EXCLUSIVE lock, so it MUST stay at
the off-hours slot — never run it after individual deletes. Check sizes:
`SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM
pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;`. task_record_events
cascade-deletes with task_records (FK), so it shrinks in step.

**Index audit (2026-08-12):** full pass over every table — all hot paths hit
indexes (alt_barcodes 17.7M idx scans vs 788 seq; prices 8.7M vs 440;
task_records 3.1M vs 1,920 — the seq scans are the nightly sync/purge jobs,
where a full scan is the correct plan). No additions needed: a trial composite
`(task_type, created_at)` on task_records was EXPLAIN-verified and reverted —
the 14-day retention keeps every real date window small enough that
`idx_tr_created_at` always wins, and rare-type wide scans use `idx_tr_task_type`.
Dropped four never-scanned indexes (`idx_sti_period`, `idx_sti_completed_by`,
`idx_tre_user`, `idx_tr_cleared_at` — the last was malformed: it indexed
`cleared_at WHERE cleared_at IS NULL`, i.e. only NULLs). DB 171 MB = 34% of the
500 MB cap. If Admin → Reports "Activity by user" filtering ever becomes a real
workflow, recreate `idx_tre_user ON task_record_events (by_user_id)`.

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
- `task_record_messages` — per-record thread. `record_id · author_id ·
  author_name · author_role · body · priority (normal|high) · msg_type
  (query|information|action) · photo_urls (jsonb, main only) · created_at`.
  **Audience (added 2026-09-10):** `audience` (`all` default · `backoffice` ·
  `area_managers`) + `recipient_id`/`recipient_name` (a "To: X" display +
  visibility hint, does not by itself widen who can see the message) restrict
  a message to a role group instead of the whole store↔BO thread — see §6
  Messages and §11. Three independent read/dismiss sides:
  `is_read_by_store`/`is_dismissed_by_store`,
  `is_read_by_bo`/`is_dismissed_by_bo` (also used for `backoffice`-audience
  rows), `is_read_by_am`/`is_dismissed_by_am` (added with `audience`, used for
  `area_managers`-audience rows).
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
  **Key is `(barcode_no, ean_barcode)`, not `barcode_no`** — a barcode can belong
  to two different products (273 do), and keying on the barcode alone silently
  dropped one of them. `UNIQUE NULLS NOT DISTINCT`, because two NULL eans would
  otherwise never conflict and the nightly upsert would duplicate them for ever.
  See `supabase-migration-alt-barcode-collision.sql`.
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
- `task_stats_daily` (added 2026-09-02) — **per-day statistics only, no records.**
  One row per `(day, store_id, task_type)` with `records · pending · completed ·
  no_change_needed · store_completed · cleared · photos`. PK `(day, store_id,
  task_type)`, no FKs (deliberate — `task_records.store_id` is ON DELETE SET
  NULL, and orphans fold into an all-zeros sentinel uuid). Written nightly at
  01:30 UTC by `rollup_task_stats_daily()`, **before** the 02:00 purge; kept 180
  days by `purge_task_stats_daily()` at 02:10. ~25 rows/day (~8,000 records
  compress ~300:1) — 64 kB for the first week, ~1.6 MB expected at 6 months.
  This is what makes dashboard history survive the record purge; see §11.
  **Real-time capture (added 2026-09-10):** two triggers on `task_records`
  (`trg_task_stats_capture_insert`/`_update`) now write into this table the
  instant a record is created or its status/photo changes, instead of only at
  the nightly rollup — closes the gap where a store could scan and
  immediately hard-delete a J/K record before that night's job ever ran,
  losing it from statistics entirely (see §11). The nightly job is unchanged
  and still runs as a reconciling backstop (`GREATEST()` upsert can only
  raise a count, never lower one the trigger already captured). No trigger
  fires on DELETE, by design.

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
- **Dashboard** (`/dashboard`): KPI cards, activity chart over a **selectable
  range**, by-task-type bars, **HO task allocation donut**, **status breakdown**
  card, by-store (BO), recent activity (shows product description, not code).
  Range picker (`components/DateRangePicker.jsx` + `lib/dateRange.js`, added
  2026-09-02): today · yesterday · this/last week · last 7 · this/last month ·
  last 30/90 · last 6 months · custom, defaulting to `last_30` (identical to the
  old rolling "This month" button). The chart buckets by day / week / month
  automatically from the range length — the Worker's old hardcoded 14-day fill
  loop is gone. Stats via the `dashboard_stats_v2` RPC, which reads
  `task_stats_daily` for past days and live `task_records` for today, so the
  numbers survive the nightly purge (§11, 2026-09-02). `work_mem='32MB'` is set
  on the function itself (since 2026-07-31 — eliminates a disk-spill sort; see
  §12 for the recurring-timeout issue that isn't fully resolved). The
  "No Department Check" card **follows the range picker** (changed
  2026-09-10 — it originally had its own fixed 7-day window; users found a
  card that never moved when they changed the range confusing, so it now
  answers "who hasn't checked in *this* range" like every other card; see §11
  for the trade-off that motivated the original fixed window and why it was
  reversed). `dashboard_stats` (v1) is still deployed unchanged as the
  rollback target.
- **Space Plan** (`/space-plan`, admin `/admin/space-plan`): per-store grid,
  Equipment Variance summary (planned vs audited total), auto-save, Excel
  export. PRIMARY BAYS renders subcategory sub-rows (mobile: collapsible). Admin
  hides/unhides equipment and edits planned counts.
- **Messages:** clickable mail icon in the header (`Nav.jsx`) → dropdown of
  threads with unread messages (one-line preview, per-thread + total unread
  count) → clicking opens the record's thread in HO Tasks. Endpoints
  `/task-messages/threads`, `/task-messages/unread-count`, `/task-records/:id/messages*`.
  **Restricted audiences (added 2026-09-10):** a back-office login can target
  a message at **Store (everyone)** (default, unchanged), **Back office**
  (`REVIEWER_ROLES` only), or **Area managers** (`area_manager` only) via a
  "To:" selector in `RecordMessages.jsx`, plus name one person in that group
  (a "To: X" hint — doesn't narrow visibility beyond the group). Stores,
  store managers, and the *other* HQ group see nothing of a restricted
  message — no thread, no preview, no badge. Either HQ group can post to the
  other ("both directions"); visibility is **strict by group** — you see a
  restricted message only by role, by being its author, or by being named on
  it, with no "whoever replied stays in the thread" widening (see §11 for the
  full model and the accepted trade-off on the shared read-flag). New `GET
  /message-recipients` (active users only) feeds the person picker. The
  composer was also compacted the same week: To/Priority/Type share one row,
  attach+snip controls collapse onto one line, and the **"Canned" reply
  picker is now labelled "Pre-set"** (the underlying `lookup_options` kind
  stays `canned_reply`).
- **Competition** (`/competition`, added 2026-08-13): per-store competitor
  capture for all users — dropdown-driven form (retailer from a shared,
  user-extensible `competitor_retailers` list seeded with ~100 Irish chains;
  type/size/status/distance band + numeric km/m/travel/direct/price/threat/
  setting + freehand details), records listed below the form, collected-by/
  updated-by from the session. Reports → Competition tab + Excel. Admin →
  Settings toggle `competition_enabled` (default on) hides the module
  everywhere when off. Tables: `store_competitors`, `competitor_retailers`.
- **Pricing** (`/pricing`, added 2026-08-13, back-office logins only):
  Reports → HO records selection bar gains "€ Send to Pricing" → snapshot
  copies into `pricing_items` (full record jsonb — survives the 14-day
  retention purge; duplicates skipped via unique `task_record_id`). Grid
  shows record columns + Cost (`prices.cost` = ItemMaster LandedCost) +
  Current SP, editable New Selling Price / VAT Rate / Notes. VAT dropdown
  Standard 23 · Reduced 13.5 · Nine 9 · Zero 0 · Exempted 0, pre-filled from
  `prices.tax_id`; unrecognised values display the 9999 sentinel. Margin % =
  (Net SP − Cost) ÷ Net SP × 100, Net SP = New SP ÷ (1 + VAT) — computed live
  client-side, recomputed server-side on save (authoritative). Save requires
  New SP + VAT → status `priced`, stamps `task_records.priced_at` → Reports
  shows a gold € bubble in the Product Id column. Delete removes only the
  pricing copy. Status filter (All/To price/Priced) + Excel export respect
  the filter. **ItemMaster sync now also carries `Tax_Id` + `LandedCost`**
  (python `sync-prices.py` COLUMN_MAP, `/prices/sync`, `/prices/import`,
  `/prices/upload-excel` → `prices.tax_id`/`prices.cost`). Non-scan records
  without an ItemMaster match keep Cost/Margin empty by design.
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
- **Mobile soft-keyboard suppression: REMOVED, and it must not come back.**
  `inputMode='none'` was tried twice in June (b5d1aa8, 49214ff) and reverted
  both times (9099e68, 88f2862). Measured on the real handhelds 2026-09-18:
  it blocks the gun outright — 0 characters arrive. The scan is delivered
  through the Android IME, so suppressing the keyboard suppresses the scan
  with it. Same result for `readOnly` and `virtualkeyboardpolicy="manual"`.
  See §11 (2026-09-18) for the full measurement table.
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
- **Fixed 2026-08-11:** the email failed silently every Wed from 15 Jul —
  `/reports/aging` was 500-ing because its "created in the last 7 days" count
  paged J/K (~46k rows) with `OFFSET`, hitting the statement timeout. Now counted
  via the `aging_created_last7(p_since)` GROUP BY aggregate RPC (one fast query).
  If the email stops again, dry-run first and check whether the 500 is the fetch
  (endpoint) or the SMTP send (Brevo key in `aging-report.config.json`).

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

### 2026-09-21 — Combined scan lookup ⚠️ TEST BRANCH ONLY

> Same do-not-merge rule as the 2026-09-18 entry below.

**`GET /scan/lookup?barcode=…`** resolves both halves of a Department Check
lookup in one request. Department Scan previously called
`/alt-barcodes/lookup`, waited for the EAN to come back to the device, then
called `/prices/lookup` with it — two round trips over shop wifi, strictly
sequential because the second needs the first's answer. Both Supabase queries
now happen inside the edge Worker, so the slow device link is crossed once.
Returns the `alt_barcodes` row with the price row nested under `price` (a
superset of what the two endpoints returned separately).

Per Department Check item: **3 Worker requests → 2.** At ~143,800 records per
three weeks that also matters for the 100k/day account-wide Cloudflare cap,
which was at 76% in July: Task J drops from roughly 20k to 13k requests/day.

Both original endpoints are untouched and still serve every other task form
(A–M); only `DeptScan.jsx` uses the combined one. `client/src/lib/api.js`
gains `scanLookup()`.

**Not yet done** from the same list: returning the department in the save
response (would reach 1 request/item), dropping or deferring the per-create
audit-event write (a second Supabase write on every scan), a client-side
barcode→department cache, and batched writes.

**Way off the page fixed (same day).** Stores reported being unable to leave
Department Scan. `Exit` worked, but it was a 44×25 chip in the extreme
top-right — roughly half the Android minimum touch target, in the hardest
corner to reach, labelled in a way that does not read as navigation. With all
three nav bars hidden on this page that left no usable exit. Replaced with an
85×44 "← Back" button on the left. The bottom nav stays hidden by explicit
decision: the screen space is worth more than the shortcut.

**Detail table below the scan.** The recent-scans list is now a table, with
columns `Product Id` (ean_barcode) · `Product Desc` (item_name) · `Department`
(item_group) · `Product Status` (product_type — header wording is the
business's) · `Product Active` and `Barcode Active` (item_status /
barcode_status rendered Yes/No) · `Barcode` (the scanned code). It is
deliberately **wider than the screen and scrolls sideways** (764px on a 375px
handheld) rather than cramming seven columns in; the page itself still does not
scroll. A barcode with no `alt_barcodes` row shows only the barcode plus
"HO will update it soon" — the scan is still saved, and the operator has done
nothing wrong.

### 2026-09-18 — Department Scan + Scan Doctor ⚠️ TEST BRANCH ONLY

> **Do not merge or cherry-pick any of this to `main`.** Explicit instruction
> from the business owner: "Do any changes only in the Test App. Do not edit
> any codes in live app." This is the "anything specific to Test branch, only
> Test branch gets" half of the standing branch rule (§2). Everything in this
> entry lives on `test` alone. Live is still on API_REVISION
> `2026-09-11-am-unify-msg-delete` and must stay there until asked otherwise.

**Why.** Department Check (Task J) is >90% of everything the estate records —
~143,800 rows in three weeks. Stores reported it as slow, specifically "multiple
tap to scan-save-clear", and later, more precisely: *the keyboard covers the scan
box, the Save button and the data from the first save onwards.*

**What the numbers said before any code was written.**
- Continuous scanning (gaps ≤30s, same 22 stores on both apps): live median
  **8.29s**/item, test median **7.79s**. p10 4.87s, p90 16.42s.
- Test was already faster because commit `608e69d` (19 Aug, "not for main until
  store-tested") has been live on `test` the whole time. It was finally
  store-tested on 2026-09-18 and it works — so the double-tap fix is worth
  **~7%**, not the drastic win being asked for. Taps were never the main cost.
- Across 143,818 live Task J rows: **zero notes, zero quantities.** Every stored
  field is derived from the barcode, so the Save tap confirms nothing a human
  entered. Department auto-resolves 93.1% of the time.
- 2,194 scans (1.5%) repeat the previous barcode; 1,289 within 10s.

**Scan Doctor (`client/src/pages/ScanDoctor.jsx`, route `/scan-doctor`).** A
diagnostic instrument, not a feature. Eight attempts to kill the Android
double-tap were tried and reverted over six days in June, every one a guess
about device behaviour nobody had measured. This measures it: per scan it
records characters, keyCodes, inter-character timing, terminator, `keyCode 229`
/ `Unidentified` / composing flags, function keys and their position in the
burst, and whether the soft keyboard is up. Five focus modes (nothing focused /
normal box / read-only / `inputMode="none"` / `virtualkeyboardpolicy="manual"`).
Results upload with one tap — see the diagnostics endpoint below — because
reading JSON off a handheld and retyping it is the very friction being studied.

**MEASURED HARDWARE FACTS (HS Tallaght, generic Chinese Android handheld
"V520", Android 10, Chrome 152). These are settled; do not re-litigate them.**

| Focus mode | Barcode arrives? | What actually happens |
|---|---|---|
| Nothing focused | **No** — 0 chars | Only F1 arrives; one burst was 6 keydowns, all F1 |
| Normal editable box | **Yes** | But **2 keydowns for 13 digits**, `keyCode 229` + `Unidentified` |
| Read-only | **No** — 0 chars | Blocked |
| `inputMode="none"` | **No** — 0 chars | Blocked (confirms the June reverts, with data) |
| `virtualkeyboardpolicy="manual"` | **No** — 0 chars | Blocked; `kc229` never fires, IME never engages |

- **The gun delivers through the Android IME, not as keystrokes.** That is the
  root cause of the composition re-injection, of the keyboard, and of why
  `ScannerInput`'s global key listener never helped (it filters
  `e.key.length === 1`; these events are `Unidentified`).
- **Suppressing the keyboard suppresses the scan.** Four independent mechanisms,
  one result. On this hardware, with this scanner output mode, there is no
  web-side way to have the scan without the keyboard.
- **The gun sends `F1` (keyCode 112) as a PREFIX** (`@start`), not a terminator.
  On a page that does not `preventDefault` it opens Chrome's help site — which
  is why `ScannerInput.jsx` has swallowed F-keys since ff68555. Being a prefix,
  it does **not** allow the 250ms auto-settle to be removed.
- Escape hatch not yet tried: switching the device's scanner output from "text
  fill" to **keystroke simulation**. That would make real key events arrive, the
  no-focus mode start working, and zero-tap/no-keyboard become possible. Verify
  any settings change in 10 seconds via Scan Doctor Mode A.

**Department Scan (`client/src/pages/DeptScan.jsx`, route `/dept-scan`).** The
Task J loop rebuilt around the constraint above rather than around a hope.
- The keyboard **is** going to be up, so the layout assumes it: header, result,
  scan box and the actions row occupy a ~210px strip at the top, nothing that
  matters is ever placed where the keyboard covers it, and the page never
  scrolls. Sized from `visualViewport`. Full-bleed — `body.deptscan-full` hides
  nav, sidebar and bottom bar (rule in `App.css`).
- **No Save tap.** The record commits on lookup; a large Undo replaces the
  confirmation step, per the zero-notes/zero-quantities finding above.
- **Duplicate inside 3s** is refused with a distinct two-tone alert + vibration.
  A sub-second repeat is already swallowed one layer down by `ScannerInput`'s
  IME-echo guard — correct, that is an echo, not a second trigger pull.
- **No department found saves normally and stays silent** — explicit business
  rule, it is a normal outcome and must not be flagged.
- WebAudio tones (no asset to fetch); audio is unlocked on first touch, since
  browsers block it until a gesture and the first thing wanting to beep is a
  scan, not a tap.
- Menu entry "Dept Scan" in all three nav bars immediately after HO Tasks,
  gated on `isTestEnv()` as well as `canDoHQTasks`.

**`ScannerInput` gained `compactActions`** — opt-in prop that shrinks the camera
button and shares one row with the caller's own buttons. Without it the camera
keeps its full-width line, exactly as every other task form (A–M) expects; only
Department Scan opts in.

**Worker: `POST /task-records` now accepts `scanned_at`.** `created_at` is
stamped server-side at insert, so anything going through the offline outbox
landed timestamped at **reconnect**, not when the shelf was walked — HS Wicklow
Abbey St shows a 0.44s median gap and Tullamore 1.06s, which are drain bursts,
not scanning. `resolveScanTime()` accepts a client stamp inside a sane window
(no more than 5 min ahead, no older than 30 days) and falls back to the server
clock otherwise. **This fix is on `test` only; live still has the bug.**

**New table `device_diagnostics`** (migration `device_diagnostics`, applied to
the shared DB) + **`POST /device-diagnostics`** on the test Worker: field
diagnostics uploaded straight from a handheld so results are readable with SQL.
The table is additive and inert on live — only the test Worker exposes a write
path. Any signed-in session may write; a store user is precisely who runs it.

**Also on `test`: a darker palette.** `data-testenv="1"` is stamped on `<html>`
before first paint (`main.jsx`), darkening the ground tokens a step in both
themes (light `#DDE5F1 → #C2CFE3`, dark `#0C0F17 → #070A11`) so staff can tell
the test app from live at a glance without reading the top banner. The red
TESTING MODE banner stays.

**Still open:** the Monday store test of Department Scan (does the keyboard now
stay clear of the top strip, is the duplicate alert audible, and what does the
`source='test'` timing say against the 8.29s/7.79s baseline); the scanner
output-mode question above; and test-app load time (~590KB main bundle),
reported as slow but not yet measured.

**Stale doc corrected:** §7 still described `inputMode='none'` as current
behaviour. It was reverted in June and is now measured to block the gun
outright.

### 2026-09-15 — Prev/Next record navigation + in-app photo Lightbox; Pricing hides HO review buttons

**Prev/Next between records.** The Details popup (`RecordDetailModal.jsx`)
now takes `onPrev`/`onNext` props and shows header buttons (and ArrowLeft/
ArrowRight keys, guarded against typing in a text field) to move to the
adjacent record without closing/reopening the modal. `Reports.jsx` supplies
these from the currently-loaded `records` array's index around
`detailRecord` — no separate fetch, so it naturally disables at either end
of what's loaded on screen; a "Load more" fetch doesn't retroactively
extend it until the popup is reopened.

**In-app photo Lightbox.** New `client/src/components/Lightbox.jsx` — a
full-screen overlay (not a literal new OS window) with zoom (0.5x-4x via
CSS `transform: scale()`, +/- keys or buttons) and Prev/Next sliding
between every photo in the current set (Esc/←/→ keys). Replaces the old
`<a target="_blank">` behaviour in two places: `RecordDetailModal.jsx`'s
own Product/Barcode photos, and `RecordMessages.jsx`'s per-message
`photo_urls` attachments (each message opens its own photo set). Since
`RecordDetailModal`'s Escape/arrow-key record-navigation handler and a
nested `RecordMessages` Lightbox both listen on `document`, the record-nav
handler checks for `[data-lightbox]` in the DOM (not just its own local
lightbox state) before acting, so a message-photo viewer correctly "wins"
the key over sliding to the next record or closing the whole modal.

**Pricing page.** `Pricing.jsx`'s copy of `RecordDetailModal` now passes
`allowReview={false}` — Complete/No change belong to the HO review workflow
in Reports, not to a page about pricing a record.

**Verified:** `npx vite build` clean on both `main` and `test` (client-only
change, no `API_REVISION` bump needed). Not interactively verified in a
browser this session — no local `.dev.vars`/wrangler backend or test PINs
were available to log in and click through it live.

### 2026-09-11 — area_manager unified as back office everywhere; admin can delete messages

**Unify `isBO`.** The entry above (server-side role gate) documented, but
deliberately preserved, an inconsistency: `TaskRecordList.jsx` excluded
`area_manager` from `isBO` (so they'd see the store-side J/K clear UI on the
HO Tasks page) while `Reports.jsx`, `RecordMessages.jsx`, and the server's
own `isBackOffice()`/`BO_ROLES` already treated them as full back office
everywhere else. Resolved on request: area managers already get
back-office login treatment in every other respect (`mode:'backoffice'`,
`sessionStorage`, the 12h token vs. the store 24h one), so `isBO` in
`TaskRecordList.jsx` now matches everywhere else exactly
(`session.mode === 'backoffice'`, no exclusion). Consequence for area
managers: "Mark complete" replaces the store-style "Clear" button on the HO
Tasks page, and the J/K bulk-clear checkbox toolbar there is gone for them
too (Reports.jsx never gave them either anyway — genuinely one rule now,
not a new restriction relative to the rest of the app). Server's
`STATUS_SETTERS` updated to match: `store_completed`/`cleared` via
`PATCH /task-records/:id` now require plain `STORE_ROLES` (no more
`+ area_manager`); `completed`/`no_change_needed` already included them via
`BO_ROLES`, unchanged.

**Admin can delete a message.** New
`DELETE /task-records/:recordId/messages/:messageId` — permanently removes
one message (+ best-effort photo cleanup from storage, same pattern as the
record hard-delete). Strict `admin` only, server-enforced — not an
author's-own-message action, no dismiss/soft-delete nuance. Client: a small
🗑 next to the author/time line in `RecordMessages.jsx`, visible only to
admin, behind a native `confirm()` (no undo, so no optimistic remove either
— waits for the server to confirm first).

**Verified:** every real `TaskRecordList.jsx`/`Reports.jsx` call site
re-checked by hand against the updated `STATUS_SETTERS` map; the
message-delete write sequence proven live in a `BEGIN…ROLLBACK` transaction
(insert a message with a `photo_urls` entry, confirm the endpoint's exact
select+delete removes it, roll back).

### 2026-09-11 — Server-side role gate on status transitions (+ a leftover-flag audit)

**The gap.** `PATCH /task-records/:id` applied any `status` the client sent,
once scoped to the session's own store, with no role check at all — the
buttons in Reports.jsx/TaskRecordList.jsx/RecordDetailModal.jsx were the only
thing stopping e.g. a store session from PATCHing `{status:'completed'}`
directly. Found while adding the Reverse feature above, deliberately not
fixed there (kept that change scoped), flagged separately, then fixed now on
request.

**Fix — new `STATUS_SETTERS` map**, values taken from *current* client
gating, not a redesign:
- `completed` / `no_change_needed` → `BO_ROLES` (matches Reports.jsx's
  `isBO`, which already includes `area_manager` — the operative real-world
  gate today).
- `store_completed` / `cleared` → store-side roles + `area_manager`, matching
  `TaskRecordList.jsx`'s own `isBO` (which *excludes* `area_manager` for
  these two, i.e. treats them as store-like there). `cleared` here only
  covers the single-record PATCH path; back office still clears through the
  separate, already-scoped `/task-records/bulk-clear` endpoint.
- Strict `admin` bypasses the map entirely — same precedent as
  reverse-status's "admin may reverse any record".
- `'pending'` is deliberately **absent** — rejected outright, admin included.
  Reverting to Pending only ever goes through
  `POST /task-records/:id/reverse-status` (2026-09-11, above), which has its
  own stricter admin-or-own-action check and correctly resets
  `marked_for_deletion`; allowing `'pending'` here too would let anyone
  bypass that check with a plain PATCH.

**Bonus fix**, found auditing every status-writing path: `POST /task-records`
(creation) now always forces `status='pending'` server-side instead of
trusting `body.status` — every task form already only ever creates pending
records, so this closes the same class of gap on creation for free.

**Verified** every current real call site by hand against the new map
(`RecordDetailModal` `ReviewButtons`, `TaskRecordList`
`markCompleted`/`markCleared`, `Reports.jsx` `reviewOne`) — all pass
unchanged; only a direct API call outside those buttons is newly rejected.

**Left alone, on purpose:** `TaskRecordList.jsx`'s `markStoreCompleted` has
**zero call sites** anywhere in the client (dead code) — nothing currently
sets `status='store_completed'` through any button. The `STATUS_SETTERS`
entry for it is evidence-based (the function's own store-side placement +
CLAUDE.md's v1 description) but unverifiable against a live UI path; harmless
either way since it's unreachable today. See §12 for the `isBO` inconsistency
between Reports.jsx and TaskRecordList.jsx that this fix deliberately
preserved rather than silently resolving.

### 2026-09-11 — Reverse a status change back to Pending

New `POST /task-records/:id/reverse-status`: undoes a record's current
status (Completed by HO, No change needed, Store confirmed, Cleared) back to
**Pending**, nulling the four status timestamps
(`reviewed_at`/`completed_at`/`store_completed_at`/`cleared_at`) and logging
the reversal in `task_record_events` like every other transition (`from` the
old status `to` `pending`, `note: 'Reversed'`).

**Permission — three tiers, from the user's own framing:**
- **`admin`** (the strict role, not the wider `buying_manager`/`buying_head`
  set that also counts as "back office" elsewhere in the app) — may reverse
  **any** record, regardless of who set the status.
- **Everyone else** — store roles, `area_manager`, `support_admin`,
  `buying_manager`, `buying_head` — may reverse **only a status change they
  personally made themselves**. Checked against the most recent
  `task_record_events` row whose `to_status` matches the record's current
  status; if `by_user_id` isn't the requesting session's own `user_id`
  (or there's no such event), it's refused with a clear 403. Store scope
  still applies on top, same as every other record action — this check is
  additive, not a replacement for it.
- Reversal target is always **Pending**, not "whatever status came before" —
  simplest, and matches both examples the user gave.

**Client:** a "↩ Reverse" button in Reports → HO records (both store and
back-office row-action columns, shown whenever a row isn't Pending — the
server's specific error message explains a denial rather than the client
trying to predict one), and a more precisely gated "↩ Reverse to Pending" in
`RecordDetailModal` (uses the record's already-loaded event history to only
render when this session could plausibly succeed — admin always, otherwise
only if their own `session.userId` — **camelCase, the client session shape**,
see the `ProductQuery.jsx` gotcha this repo already learned once — matches
the last event's `by_user_id`).

No new DB objects: this reuses the existing `task_record_events` audit
ledger and the **2026-09-10 real-time `task_stats_daily` triggers**
unchanged — a reversal is just another status UPDATE, already handled
correctly by that generic OLD/NEW-status trigger (see below).

**Verified** with a `BEGIN…ROLLBACK` transaction against a real `cleared`
record (store-set, by a real sales_assistant login): the exact write
sequence correctly flips it to `pending`, nulls `cleared_at`, and logs a
`cleared → pending` audit event — then rolled back, nothing persisted.

### 2026-09-10 — Restricted-audience messages (Back office / Area managers)

**The ask.** Back office needed a way to post a note on a record that's
visible only to fellow reviewers, or only to area managers — not to stores,
not to store managers, and not to the other HQ group. Named as "send a
message to Chamya, so Chamya and the rest of back office can see it,
excluding area managers" — and the same for area managers.

**Model.** `task_record_messages.audience`: `all` (default, every
pre-existing row, unchanged behaviour) · `backoffice` (visible to
`REVIEWER_ROLES` — `admin`/`buying_manager`/`buying_head`/`support_admin`) ·
`area_managers` (visible to `area_manager` only). `recipient_id`/
`recipient_name` name one person as a display + visibility hint — the row is
still visible to the whole audience group; naming someone does not narrow it,
it only guarantees a non-group viewer (e.g. the sender, if their own role
isn't in that group) can also see it. Design decisions taken with the user,
each with a real trade-off:
- **Person + group**, not group-only — a message can be addressed to a named
  colleague as well as broadcast to their group.
- **Both directions** — either HQ group may post into the other's audience,
  not just back office → area managers.
- **Strict groups**, not "whoever joined the thread" — you see a restricted
  message only by role, by being its author, or by being named on it. No
  per-record participation widening. Consequence accepted: a cross-group
  reply is invisible to the original sender unless the replier names them.
- **Per-record thread**, not a standalone inbox — restricted notes live in
  the same per-record thread as everything else, just filtered.

**Read/dismiss:** a third "side" (`am`) joins the existing `store`/`bo` pair.
`backoffice`-audience rows track on the existing `is_read_by_bo` (all
reviewers share one flag, same as `all` already does for BO); `area_managers`
rows use the new `is_read_by_am`. **Accepted wart:** because the flag is
shared per side, seeding a restricted row unread-for-the-whole-group (so
everyone gets the "you've got a message" badge) also makes the *author's own*
badge count it until they reopen the thread — a per-user read table is the
real fix, deliberately out of scope for this.

**Server (`functions/api/[[route]].js`):** `msgVisibleTo(session, row)` +
`msgSide(session, audience)` gate every message read path — `GET .../messages`,
the header dropdown (`/task-messages/threads`), the unread badge
(`/task-messages/unread-count`), `mark-read`, `dismiss` — plus a
`POST`-time guard (`canPostAudience`) so a store login can only ever post
`all`. New `GET /message-recipients` (any back-office login; `is_active=true`
only) feeds the person picker. `awaiting_reply_threads` now ranks off
`audience='all'` rows only — a restricted note is an internal aside, not an
HO↔store SLA obligation, so a record whose only messages are restricted never
appears in that queue.

**Verified** with a DB-predicate harness (all six role combinations against a
scratch thread carrying one message of each audience matched intent exactly)
before touching the client. Migration: `supabase-migration-message-audiences.sql`.

**Branch note:** `test`'s `RecordMessages.jsx` doesn't have the message-photo
feature `main` has (never cherry-picked, or built after `test` diverged) —
each cherry-pick for this work conflicted there and was resolved by hand,
keeping `test`'s no-photos version and layering the audience UI on top of it.
This is *not* one of the deliberately main-only features (§ branch rule) —
it's an unrelated pre-existing divergence worth closing eventually.

Same week: the compose area was shortened (To/Priority/Type on one row;
attach+snip controls collapsed onto one line, in order — file picker → paste
snip chip → capture button — instead of a tall dashed box) and the "Canned"
reply picker relabelled **"Pre-set"** everywhere in the UI (button, tooltip,
empty state) — the `lookup_options` kind stays `canned_reply`, so nothing
changes in Admin → Lookups.

### 2026-09-10 — Dashboard stats: same-day delete gap closed, Department Check card follows the picker

**The bug (found by the user, not by testing).** `task_stats_daily` (2026-09-02,
above) was only populated once a night at 01:30 UTC. Store users are allowed
to permanently delete their own J/K (Department Check/Price Check) records at
any time (`functions/api/[[route]].js`, the record DELETE handler — "Store
users may permanently delete Department/Price Check records in their
stores"), so a record created and deleted the **same day**, before that
night's rollup ever ran, was captured nowhere — not in `task_records`
(deleted), not in `task_stats_daily` (rollup hadn't run yet) — and the store
looked like it had skipped a check it actually did.

**Fix:** two triggers (`trg_task_stats_capture_insert`/`_update`, see §5) now
write into `task_stats_daily` the instant a record is created or its
status/photo changes, so a check is durably counted before any delete can
race it. Deliberately no DELETE trigger — that's the entire point. The
nightly rollup is unchanged and keeps running as a reconciling backstop.
`dashboard_stats_v2`'s `dept_check_7d` sub-query needed one bound widened
(`day <= v_today - 1` → `day <= v_today`) so the now-real-time "today" row
can stand in for a same-day-deleted live record; every other part of that
function is untouched. **Proved non-destructively** with a `BEGIN…ROLLBACK`
harness against the live triggers before and after applying the migration:
insert a J record for a store with zero J history → `records` 0→1 → hard-
delete it (confirmed gone from `task_records`) → `records` stays 1 and the
store now correctly appears in `dept_check_7d.store_ids`.

**Then, in the same conversation:** the user pushed back on the
"No Department Check" card showing the *same* 10 stores no matter what range
was selected on the Dashboard (1 day / 1 month / 6 months all identical).
That was by design (see the 2026-09-02 entry) — a deliberate fixed 7-day
window, on the theory that a range-following card would read "all clear" on
long ranges and be useless. Once that trade-off was explained, the user chose
to make it follow the picker anyway. `dept_check_7d` → **`dept_check_range`**:
the same query, but keyed on the caller's actual `p_from`/`p_to` instead of a
hardcoded `today-6..today`. Verified live: a 7-day call still returns the
same 49/59 stores present as before; a 30-day call returns 58/59 (only the
one store with zero Department Checks *ever* remains flagged) — confirming
the list now genuinely responds to the range instead of staying static.
Migrations: `supabase-migration-realtime-stats-capture.sql`,
`supabase-migration-dept-check-follows-range.sql`.

### 2026-09-04 — Backoffice Comments (an internal note on any record) + a pre-existing exposure fix

Added a `review_notes` editor (`BackofficeComments` in
`RecordDetailModal.jsx`) visible only when `showInternal` (back-office
sessions) — "may be you can call this Backoffice Comments, this should be
visible to backoffice users." While wiring it, found that `review_notes` was
**already** readable *and* writable by any session — store included — through
three endpoints (`GET /task-records`, `PATCH /task-records/:id`,
`GET /reports/task-records`); the client-side `showInternal` gate was the
only thing hiding it, not real access control. Not something the user
reported — found by checking what "visible to backoffice users" actually
required at each endpoint rather than trusting the existing UI gate. Fixed
server-side in all three: the field is omitted from non-BO `GET` responses
and stripped from non-BO `PATCH` bodies before they reach the database.

### 2026-09-03/04 — HO Tasks split for store logins; Reports gets per-row store actions

**HO Tasks (`/tasks`)** now renders differently for store vs. back-office
logins instead of one shared table+toolbar for everyone. Store mode: no
status-filter tabs, no bulk-select toolbar, no per-row Clear/Msg/Delete
column (`TaskRecordList` gained `showBulkToolbar`/`showRowActions` props) —
just the scan form and a plain history list; those actions remain reachable
at Reports → HO records against the same records, so store users lose a
duplicate path, not a capability. Landed after three rounds of correction
(first pass over-removed table columns *and* buttons; a fix over-corrected by
restoring buttons that were meant to stay gone) — resolved by giving the two
concerns independent, precisely-scoped props instead of one combined toggle.

**Reports (`/reports` → HO records)** then gained the store-mode equivalent:
a right-hand actions column with **Clear** (self, once reviewed/store-
completable), **Msg** (thread toggle, now unconditional rather than BO-only),
and **Delete** (`HARD_DELETABLE` = J/K only, matching the existing store
delete permission) — explicitly excluding the Canned/"Pre-set" picker from
that row set per request. Caught and fixed one bug before shipping: the Clear
button's condition initially let a *back-office* row that happened to be
`reviewed` show Clear too (missing an `!isBO` guard on half the condition) —
caught via a harness screenshot comparing back-office vs. store views.

### 2026-09-03 — Smaller fixes this batch

- **Manual upload server (`scripts/local_upload_server.py`)** — fixed two
  independent bugs that were silently blocking uploads (a `cp1252` print
  crash on certain filenames, and an expired-certificate `urllib` failure),
  then made it survive reboots via a real Windows Scheduled Task
  (`scripts/install-upload-server-task.cmd`, run-at-logon,
  `scripts/startup-sync.vbs`) instead of needing to be started by hand.
- **Nav badge** simplified to show only the login mode, no working-store suffix.
- **Bottom nav** redesigned with a hand-drawn SVG icon set (replacing Unicode
  glyphs) and fixed alignment, verified across 5/8/11-item role cases in both
  themes.
- **Dashboard** date picker made dropdown-only (defaulting to Last 7 days);
  **Pricing** page's Delete button moved out of the Details modal onto the
  row itself.

### 2026-09-03 — alt_barcodes stopped losing products to shared barcodes

**The bug.** `alt_barcodes.barcode_no` was `UNIQUE`, but a barcode in the ALT
Barcode Master can legitimately belong to two different products — 273 do:

    EAN 01-01-351-00  KETTLE CHIPS S&VIN 130G   barcode 5017764128128
    EAN 01-01-070-00  KETTLE 130G S/S BALSAMIC  barcode 5017764128128

Only one row per barcode could exist, so one product was silently overwritten
and disappeared from every `ean_barcode` lookup, and from Product Master.

**Which one survived was arbitrary.** The "prefer the Active barcode" rule in
`/alt-barcodes/sync` only applies inside one 2,000-row chunk; across chunks it
is a plain merge-duplicates upsert where the later chunk wins. The sync sorts
its payload by `ean_barcode`, so two products sharing a barcode land in
different chunks and the winner is decided by **alphabetical EAN order**.
Sometimes the discontinued product won and the live one vanished.

**Measured** by replaying the real sync against the real file. The replay
reproduced production exactly — 212,109 prepared → 211,957 written → 211,834
rows → 97,106 distinct EANs, all four matching — then predicted 89 lost EANs:
89 predicted, 89 actually missing, zero false positives. Reproduced again the
next day against that day's file (211,863 rows / 97,128 EANs, both exact).

**Not all of the gap was this bug.** prices had 3,321 EANs with no
`alt_barcodes` row: **89** this collision, **664** whose every row in the file
has a blank `Barcode_No` (dropped by design — the sync needs a barcode; one for
the file owner), **2,568** simply absent from the ALT Barcode Master.

**The fix.** `UNIQUE NULLS NOT DISTINCT (barcode_no, ean_barcode)`; all three
upserts `on_conflict=barcode_no,ean_barcode`; all three chunk-dedup maps keyed
to match; `/alt-barcodes/lookup` ordered `barcode_status.asc,item_status.asc`
so a shared barcode resolves to the **Active** product instead of whichever row
Postgres happened to return. Safe because every shared barcode is exactly one
Active + one Inactive — checked across the whole master, so it never has to
break a genuine tie.

**Live after backfilling the 274 missing rows:** 212,137 rows, 97,216 distinct
EANs (+88 products), 0 duplicate pairs, and **0 EANs left without an
`is_primary` row (44 before)** — those were invisible in Product Master even
though the product was in the table. All 96 reported examples present.

**Two things worth keeping.**

- The migration is deliberately **two steps that straddle the deploy** — add
  the new key, deploy, drop the old one. `ON CONFLICT` errors outright without
  a matching index, so there is no single moment where old-code/new-schema or
  new-code/old-schema are both valid. The nightly sync **truncates before it
  uploads**, so the wrong order at 06:30 would have emptied the product master
  and then failed every chunk, unattended.
- Because of that, `GET /api/ping` (already public) now returns
  `rev: API_REVISION`, so `curl` says which build is live without a login.
  Bump `API_REVISION` by hand whenever a deploy has to be confirmed before
  something unattended depends on it.


### 2026-09-02 — Dashboard statistics survive the purge; richer date ranges

**The bug.** Every dashboard number was computed live from `task_records`, which
is a rolling window: `purge_old_task_records()` deletes rows older than
`scan_record_retention_days` (**live value 21**, not the 14 quoted in older notes)
where `task_type IN ('J','K') OR status <> 'pending'` — so Department Check (J)
and Price Check (K) go after 21 days *regardless of status*. Any range longer
than that was computed over data that no longer existed, so "No Department
Check" listed stores that had done one. Confirmed on live: zero J records older
than 25 days.

**`task_stats_daily`** (`supabase-migration-stats-rollup.sql`) — counts only, no
records; see §5 for the shape. Two rules in one UPSERT are what make it work:
`records`/`photos` use `GREATEST(old, new)` so they can never shrink (immune to
the purge *and* to manual bulk deletes), while the status columns are mirrored
so `pending → completed` transitions are still tracked. Statuses are columns
rather than part of the key precisely so those two rules can coexist — with
status in the key, a transition would force a decrement, and a decrementing job
is a mirror of the source, which is what would let a delete erase history.
Recompute window is 7 days, clamped at run time to `retention - 3` with
`GREATEST()` as a second, independent safety.

**`dashboard_stats_v2`** (`supabase-migration-dashboard-stats-v2.sql`) — reads
the rollup for past days, live `task_records` for today, **and live records for
any past day the rollup does not cover** (pre-deployment history, or a night the
job failed). That third arm is not optional: without it the 30-day view dropped
from 135,769 to 47,305 on deploy day. Verified byte-equal to v1 across 7/30/90-day
ranges. v1 is left deployed untouched — rollback is one string in
`functions/api/[[route]].js`.

Also fixed here:
- **The Worker's 14-day `by_day` cap is gone.** It silently discarded days 15-30
  of a 30-day range and made longer ranges impossible to chart. Bucketing is now
  day/week/month chosen by range length, gap-filled in SQL (the Worker has a
  10 ms CPU budget and must not loop 180 days in JS).
- **`stores_missing_dept_check_v2`** — same shape and semantics, reads the rollup
  *and* live records, so the weekly aging email stays correct if the window is
  widened or retention shortened. Output identical today (7 < 21).
- **The No-Department-Check card no longer follows the range picker** — it always
  asks "last 7 days", which is the actionable signal and matches the email. Over
  a 6-month range the old behaviour would have reported everyone compliant.
  **Reversed 2026-09-10** — see that entry below: users found a card that never
  moved when they changed the range confusing rather than reassuring, and
  explicitly asked for it to follow the picker once the trade-off was explained.
- **Latent duplicate-React-key bug in `ActivityChart`**, exposed by this work:
  `dd` duplicates the sole point on a one-day range to draw a flat line while
  keying by date. Unreachable before (the Worker always returned exactly 14
  days); reachable the moment "Today" existed, and it left stale axis labels
  behind. Keys are index-qualified now.

**Client:** new `lib/dateRange.js` (presets: today · yesterday · this/last week ·
last 7 · this/last month · last 30/90 · last 6 months · custom) and
`components/DateRangePicker.jsx`. It states the local-vs-UTC convention in one
place for the first time — calendar maths on the local clock, boundaries emitted
as UTC day edges, which also matters for correctness because the rollup is
day-grained. Dashboard only for now; the seven copy-pasted date helpers on the
report pages are a deliberate follow-up (three compute "today" in UTC and three
locally, so converting them will shift some defaults by a day).

**Known limits, by design:** statistics start the day this shipped — there is no
real history before it, and the UI says so rather than drawing a fake flatline.
Once a day leaves the recompute window its status split is frozen, so on long
ranges "Pending review" stops matching a live query (`records` itself stays
correct). `rebuild_task_stats_daily(from, to)` is the escape hatch and refuses
any day whose source is already purged.

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
- ~~`area_manager` can Complete/No-change records via Reports.jsx but not via
  TaskRecordList.jsx~~ — **resolved 2026-09-11**, same day it was found: unified
  toward "area manager = back office everywhere" (see §11). Left here as a
  pointer in case anything else surfaces still keyed on the old, narrower
  `TaskRecordList.jsx` definition of `isBO`.
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
marked read immediately, the opposite side unread; a message's `audience`
(`all`/`backoffice`/`area_managers`) gates visibility server-side on every
read path, not just in the UI — see §11 (2026-09-10).

**Feature history** — see §11 above (kept in sync with
`memory/feature_history.md`).

---

*Maintainers: keep §11 and §12 current after each batch of work; re-pull the
table list (§5) from the DB if the schema changes.*
