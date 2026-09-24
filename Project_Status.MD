# Homesavers Scanner — Project Status

A self-contained snapshot of the whole app as it stands today. If you are a
fresh Claude session opening this repo cold, **read this file first** — it has
the architecture, data model, every module, recent changes, known issues, and
the project memory all in one place.

*Last updated: 2026-09-21.*

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

> ### `test` = `main` + whatever is still under test
>
> That is the whole rule, in the owner's words (2026-09-21). Work in progress
> lives on `test` **only until it ships**; once it is on `main` it stops being a
> difference. So the set of differences should always be small, and should
> shrink every time something ships.
>
> ✅ **Caught up 2026-09-21.** The backlog recorded here on 2026-08-27 is closed —
> `git merge main` into `test` brought over Dead Stock, StoreBarList,
> StoresMissingDeptCheck, the CN-code and B&M daily syncs, the Dashboard
> evolution, message-thread photo attachments, the pricing scroll fix and the HO
> Tasks second-click fix. Keep it closed by propagating each `main` change to
> `test` as it lands, rather than letting a gap build up again.
>
> **Differences as of 2026-09-21** — nothing is currently mid-test, so only the
> two permanent ones remain:
>
> | Difference | Where | Permanent? |
> |---|---|---|
> | Scan Doctor page + `POST /device-diagnostics` + `postDeviceDiagnostic()` | `pages/ScanDoctor.jsx`, its route, the Worker, `lib/api.js` | Yes — owner decided 2026-09-21 it does not go to live |
> | Darker palette | `data-testenv` in `App.css`, stamped in `main.jsx` | Yes — it is how staff tell the two apps apart |
>
> ⚠️ The **TESTING MODE banner and the Test/Live toggle are NOT branch
> differences.** That code is on *both* branches and keyed on the hostname via
> `isTestEnv()`, as is the Task M gating. Do not "port" them, and do not count
> them when checking how far the branches have drifted.
>
> Note this distinction: since 2026-09-21 the Test/Live toggle *behaves*
> differently on the two builds — hidden on live, shown on test — but it is
> still **one piece of code on both branches**, not a branch difference. The
> asymmetry comes from the hostname guard, not from the branches diverging. To
> re-open the toggle on live for a future round of store testing, delete the
> `if (!test) return null` line in `TaskForm.jsx` **on both branches**.
>
> `git log test..main` overstates the gap, because many commits have
> same-content twins from earlier cherry-picks. `git diff main test --stat` is
> the authoritative view.

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

### 2026-09-24 (later still) — Duplicate highlighting, four Pricing states, full record History

Three requests, plus the filter option that came with the second.

#### 1. Duplicate-barcode highlighting

Records sharing a `barcode_no` under the same `task_type` are highlighted violet
in **Reports** and **Pricing** (`.tr-duplicate`, tint + left bar, so it composes
with the existing green/amber left borders instead of competing for them).

**Computed in Postgres, not the browser.** The grid pages 200 rows and appends on
*Load more*, so a client-side check calls a record unique whenever its twin sits
on an unloaded page — the one case worth catching. New RPC
`task_record_duplicate_keys`, on its own endpoint
(`POST /task-records/duplicate-keys`) rather than folded into the grid query:
`GET /task-records` is PostgREST and cannot express GROUP BY/HAVING, and the
Excel path is a CPU-tuned RPC that has already tripped the Worker budget once. If
the aggregate fails the grid still renders, unhighlighted.

**It asks only about the barcodes on screen, while still COUNTING over the whole
filtered set.** Without that narrowing, "Department Check over 30 days" returns
**19,197 keys (~290 KB)** every report run and an unfiltered report hits the
20,000 cap and silently under-reports. With it, **~49**.

**Scope is across all stores**, by the owner's decision. Measured before
building, because the number decides whether the feature is useful:

| task type | rows | dup across stores | dup same store |
|---|---|---|---|
| J Department Check | 171,303 | **94.4%** | 25.5% |
| K Price Check | 3,962 | 78.0% | 77.5% |
| B Non-Scans | 119 | 27.7% | 13.4% |
| C Wrong Prices | 66 | 28.8% | 9.1% |
| G Promotion Error | 30 | 56.7% | 20.0% |

Right for the reports back office actually runs — their default task-type filter
excludes J/K/H/M, leaving the 28–57% band where a shared barcode genuinely means
two stores hit the same problem. It degenerates only when the report is filtered
*to* Department Check, where nearly every row lights up because 55 stores
legitimately scan the same products.

#### 2. The Pricing bubble: two states → four

| state | derivation |
|---|---|
| In Pricing, not priced | `sent_to_pricing_at` set, other two null |
| Priced | `priced_at` set, `pricing_removed_at` null |
| Priced and deleted | both set |
| Not priced but deleted | `pricing_removed_at` set, `priced_at` null |

The old bubble **could not show the first state at all**: sending a record to
Pricing wrote nothing to `task_records`, and `pricing_items` is HARD deleted on
removal, so afterwards a join has nothing left to find. New
`sent_to_pricing_at` column, backfilled for all 67 records that ever touched
Pricing (2 in pricing · 0 priced · 52 priced-and-removed · 13 removed-unpriced).
States 3 and 4 were already distinguishable — removal stamps
`pricing_removed_at` and deliberately does **not** clear `priced_at`.

One definition in `client/src/lib/pricingState.js`, mirrored by the `or=` filter
in `GET /task-records` and the CASE in the duplicate RPC.

#### 3. The option: a Pricing filter

The four states as a back-office filter, server-side so it spans every page. The
same states are passed to the duplicate RPC — otherwise the highlight would stop
matching the rows on screen.

#### 4. Record History shows every change

It was a **status ledger and nothing else**: five writers, and every other
mutation invisible — note edits, photos, send/price/remove on Pricing, messages,
thread resolution.

It could not show more without a schema change: `to_status` was `NOT NULL` with a
CHECK limiting it to the five statuses, and there was no kind column, so a
non-status event was physically unstorable.

> **The trap, and why sequencing mattered.** The obvious workaround — reuse the
> record's current status as `to_status` — silently changes **permissions**. Both
> the API and `RecordDetailModal` decide who may reverse a status by finding the
> most recent event whose `to_status` equals the record's status and comparing
> its author to the session. A pricing event stamped with the current status
> would make whoever *priced* the record, rather than the reviewer who set its
> status, the only non-admin able to reverse it. Both gates were narrowed to
> `event_type = 'status'` **before any new writer existed**.

Schema: `event_type` (default `'status'`, so existing rows and all five existing
writers keep their exact meaning), `field` / `old_value` / `new_value`,
`to_status` relaxed to nullable, and the CHECK rewritten to constrain only rows
claiming to be status transitions. A second CHECK keeps the vocabulary closed.

New events: sent to Pricing (**one batched insert**, not one per record — a
Worker is capped at 50 subrequests and the old bulk-clear loop already lost 77%
of its events that way), priced, removed from Pricing, note added/changed/cleared,
photo added/replaced/removed, message posted, thread resolved/reopened.

Message events record only **that** a message happened. The thread is already on
the record, restricted audiences exist, and the History panel has no audience
filter — copying the body would leak an internal note to everyone who can see the
record.

#### Three bugs caught before shipping, each invisible to the obvious check

- **PGRST203.** `CREATE OR REPLACE FUNCTION` only replaces when the *signature*
  matches; adding `p_barcodes` and then `p_pricing_states` left **three
  overloads**, and PostgREST refuses every call when it cannot choose. Invisible
  to `execute_sql`, which resolves positionally without complaint — it only
  appeared when the RPC was called over REST, the way the app calls it.
- **A CHECK that passed on NULL.** `event_type <> 'status' OR to_status = ANY(...)`
  accepts a status row with `to_status` NULL, because `NULL = ANY(...)` is NULL
  and a CHECK passes on NULL rather than failing. With `NOT NULL` just removed,
  nothing else would have stopped it. Now requires `to_status IS NOT NULL`
  explicitly. Found by a BEGIN/ROLLBACK harness that deliberately tried to insert
  one.
- **An event kind the CHECK rejected.** The photo writer used `event_type 'photo'`
  before it was in the vocabulary. The constraint did its job — but
  `writeActivityEvent` is best-effort and swallows failures, so the only symptom
  would have been a history line that never appeared.

Also fixed in passing: Pricing rows hardcoded `background: #fff` inline, so every
unpriced row rendered white on a dark background. Now a class.

**Not done, deliberately:** the archiver's `d1_copied_at` stamp writes no event —
it is a separate Worker with no session, so it would attribute to 'unknown'
unless a system-actor convention is agreed. Deletes still destroy history via
`ON DELETE CASCADE` rather than appending a terminal event.

### 2026-09-24 (later) — Archived is just a status; dropdown toolbar holds two rows

**The "Include archived" checkbox is gone.** Archived is an ordinary status now,
picked from the back-office **Status** dropdown like any other. The checkbox was
a second control for one question and the two could disagree — tick the box,
then choose a status, and the box quietly meant nothing. The `includeArchived`
state went with it: `statusIds` is the single source of truth, and the store's
**Current / Archived** pair reads and writes it directly (`showingArchived =
statusIds.includes('cleared')`).

Stores keep their pair, because they do not get the Status dropdown at all.

**The Archive dialog named a control that no longer exists.** It said "go to
Reports and tick Archived". It now says *choose* Archived, and names the right
control for who is reading it — **Status** for back office, **Records** for a
store (`storeWording={!isBO}`). They genuinely see different controls, and an
instruction pointing at the wrong one is worse than no instruction.

**Dropdown toolbar (`MultiSelectDropdown`) now holds exactly two rows.** The
two-row structure was already in the code; what was missing was that the first
row could *wrap*. Measured against the deployed stylesheet, injected into the
real page so the real `.btn` metrics applied:

| panel width | 220px | 170px | 140px | while searching |
|---|---|---|---|---|
| before | 2 rows | **3** | **3** | **3** |
| after | 2 rows | 2 | 2 | 2 + the optional line |

Two causes, both fixed:

1. `flex-wrap: wrap` with `flex: 1`. A flex item defaults to `min-width: auto`
   and refuses to shrink below its content, so on a narrow panel **Clear all**
   dropped to its own line. Now `flex-wrap: nowrap` + `min-width: 0`, and the
   labels ellipsis rather than wrapping inside the button and doubling its
   height.
2. **The case that actually bit.** All three dropdowns named — Reports' *Stores*
   and *Task types*, Pricing's *Task type* — have 8+ options, so they show a
   search box (`searchable ?? options.length >= 8`). Typing added a third
   "✓ Every" button to the row, which pushed **Clear all** onto its own line at
   any width. That button now gets its **own full-width line**, so the two
   buttons that are always present are never squeezed by one that usually is not.

One shared component, so this covers the three dropdowns asked for and every
other toolbar dropdown with it.

**Pricing's Task type dropdown no longer shows a search box** (`searchable={false}`).
It appeared automatically at 8+ options and there are 12 task types, but they all
fit the panel without scrolling — so the field only cost a tap and took the focus.
It also pulled in the "Select every option" row, which means nothing when the list
is not filtered, so turning search off leaves exactly the two-row toolbar. Reports'
*Stores* dropdown keeps its search: 55 stores genuinely need it.

### 2026-09-24 — 7-week retention: 2 weeks live + 5 weeks archive

**The model.** A task record is kept `scan_record_retention_days` in Postgres,
then `archive_retention_days` in the Cloudflare D1 archive, then deleted for
good. Both are admin-editable on the Settings page.

```
created --[ scan_record_retention_days ]--> D1 --[ archive_retention_days ]--> gone
            (target 14, currently 21)            (35)
```

Dashboard statistics are **unaffected and stay 180 days**: they live in the
`task_stats_daily` rollup governed by `stats_rollup_retention_days`, which
survives both stages. That independence is the whole reason the record windows
can be shortened at all.

| Phase | What shipped |
|---|---|
| 1 | `archive_retention_days` setting + range validation on every retention field, client and server |
| 2 | Archive covers **every task type**, all 36 columns, whole `details` |
| 3a | **One** purge rule, archive-guarded, for every type |
| 4 | The D1 purge — which had never existed |
| 5 | `archived_at` → `d1_copied_at` (and why the status value was *not* renamed) |
| 6 | One **Archive** action; **Delete is admin-only** |

**Deliberately NOT a second Supabase-side setting.** The plan called for
`supabase_retention_days`. `scan_record_retention_days` already means exactly
"how long a record stays in Postgres" and is read in six places that each delete
or protect data (the purge, the rollup clamp, the rebuild guard,
`runAutoCleanup`, the admin cleanup endpoint, the archiver). Renaming it buys a
tidier name for six chances to leave one consumer reading a key that no longer
exists and silently falling back to a hardcoded 21. The Settings **label**
carries the meaning; the key name stays put.

**Deliberately NOT renaming status `'cleared'` → `'archived'`.** Also in the
plan; dropped after inventorying it. Eight functions embed the literal
(`dashboard_stats`, `dashboard_stats_v2`, `manager_overview`,
`report_task_records_flat_page`, `report_task_records_page`,
`rollup_task_stats_daily`, both realtime stats triggers), plus two CHECK
constraints, **two partial indexes** (`WHERE status <> 'cleared'`), the
`task_stats_daily.cleared` column and 5,678 rows. And this is a PWA sharing one
Supabase between live and test: a store on a cached bundle would keep sending
`status=cleared` against a constraint that no longer allowed it, so its Archive
action would fail until the device happened to refresh. Every user-visible
surface already reads **Archived**. The requirement was that only genuinely
archived records show as Archived — delivered in Phase 2, when
`/reports/archive` stopped hardcoding the status for every D1 row.

**The purge is now one rule.** Three branches (M's 180 days, J's archive guard,
and an `ELSE` exempting anything still `pending`) collapsed to:

```sql
DELETE FROM task_records
WHERE created_at < v_cutoff AND d1_copied_at IS NOT NULL;
```

Nothing is deleted until the archiver has confirmed D1 holds it. **The direction
of failure inverted**: the old rule deleted on a clock and trusted that the 01:30
Worker had run before the 02:00 job, so a dead archiver meant Postgres destroyed
unarchived records. Now a dead archiver means records accumulate in Postgres,
visible and recoverable, and the purge quietly does nothing.

Verified before applying: the old rule would have deleted 2 records, the new rule
0, because everything past the cutoff was still unarchived.

**Two paths bypassed the guard and now don't**: `runAutoCleanup` (fires on any
back-office login) and `POST /admin/cleanup/task-records`. Both issued their own
DELETE instead of calling the function, so either could permanently destroy a
record the archiver had not yet copied. Two deleters is tolerable; two rules is
not.

**Consequences accepted by the owner**, all measuring zero affected rows today:

- An unanswered head-office query (A–I) is no longer purge-exempt, so
  `/reports/aging` can never again show a backlog older than the total window.
  That report exists to chase exactly those records — its meaning has changed
  permanently.
- Task M (Expiry) drops from 180 days to the standard window.
  `expiry_record_retention_days` is left in `app_settings`, now unread.

**Storage, re-measured.** The `d1-archive-schema.sql` SIZING block was labelled
"measured, not estimated" and was wrong in both inputs: it said 5,310
records/day (real: ~8,150, and ~10,100 over the last week) and ~200 bytes/row
(real: ~390 — the old figure was text payload only, excluding the index and
SQLite's row overhead). The abandoned 6-month plan would have been ~598 MB,
**over** D1's 500 MB free limit, not the 42% claimed. At 5 weeks it is ~111 MB,
so the month-sharding escape hatch is no longer needed.

**Archiver throughput** went from 25s/60 pages to 180s/400. The old ceiling was
right for J-only steady state (~8,000 records, under 20 seconds) and far too
small for the catch-up that narrowing the window creates (~48,000 records at
once). The work is network I/O rather than CPU and the sweep is idempotent, so a
longer run risks nothing. The real ceiling during catch-up is D1's **100,000
rows/day write limit** — 2 writes per record — so a backlog spreads over two
nights.

**Delete became admin-only.** It was the one action that destroyed data with no
way back, offered to the least-trained users on the screens they use most.
Enforced on all three delete endpoints, not merely hidden. Admin may now delete
any task type; "Delete all matching" still requires an explicit task-type filter,
because one button meaning "delete everything in range" is not something to be
one click from.

**Archive confirms, and deliberately not in red.** Archiving is reversible;
dressing it in the delete modal's red trains people to click through warnings,
and the next warning they click through is the permanent one. The dialog states
the retention period and how to get the record back, reading both numbers from
`/app-config` so changing the setting cannot make it lie.

**Reports read D1 automatically** when the date range reaches past the live
window — the user picks dates and statuses, never a storage location. The
"Archived" control is now purely a **status** filter, applying in both stores.
Those were conflated before: whether a user archived a record and whether it has
aged out of Postgres are independent, and a record can be either, both or
neither. This is why `/reports/archive` gained mandatory status and task-type
filters — D1 now holds every status, so without them an archived row would
surface in a report whose filter excludes it purely because of where it lives.

Reverse needed no change: it already renders on any non-pending row, so it covers
Archived.

> **Phase 3b DONE, 2026-09-24:** `scan_record_retention_days` 21 -> 14, on the
> owner's instruction. The full 7-week chain is now live: 14 days in Postgres,
> 35 in D1.
>
> Measured at the moment of the flip: **49,892** records became due, **none** of
> them archived yet, and the purge predicate selected **0** — the guard doing
> exactly its job. At ~2 D1 writes per record the backlog is ~99,800 writes
> against a 100,000/day free limit, so it drains over **two or three nights**,
> and Postgres holds more than 14 days until it does. Nothing is at risk while
> that happens: the purge only ever deletes what the archiver has confirmed.
>
> Note this is also the FIRST night the all-types archiver and the rewritten
> purge run at all, and they run against the catch-up rather than the ~1,300
> records a pre-flip night would have given them. Worth checking
> `archive_runs` tomorrow.
>
> `photo_retention_days` was separately changed to **49** during the same
> session, which lines photo lifetime up with the full record window.

Archiver tests: 38 → 81 (`scratchpad/archiver.test.mjs`), including a non-J
record end to end, `details` round-tripping, a mixed-type sweep, the per-run
purge ceiling, and three refusals — shadow mode never deletes, a failed sweep
never purges, and a blank `archive_retention_days` falls back to 35 rather than 0
(which would delete the entire archive).

### 2026-09-23 — Archive Phases 4b and 5: reports read-through, and Current/Archived

**Phase 4b — "Include archived" on the export.** Back office only, OFF by
default. Wired into the Excel export, not the on-screen grid: those are separate
paths (`getTaskRecords` feeds the grid, the report endpoint feeds the export),
and the export is where six months of history is actually consumed. Extending
the grid is a deliberate non-goal, not an oversight.

Skipped entirely when the task-type filter excludes Department Check, since that
is all the archive holds.

Two bugs found by driving the real page, neither of which the unit tests could
have caught:

- **The endpoint rejected the date format the page actually sends.** Reports
  uses `datetime-local` inputs and passes `2026-08-24T00:00`; the endpoint
  appended a time to it, producing `2026-08-24T00:00T00:00:00Z`, and returned
  400 for *every* request the page made. The tests used bare dates because that
  is the format I assumed — the assumption was the bug, so a test written from
  it could never fail. Bounds now parse with `new Date(v)`, the same way the
  live export does, so the two paths cannot disagree about a range.
- **`rows.unshift(...archived)` would overflow the call stack.** Spreading an
  array as arguments is bounded by the engine's argument limit, and this list
  reaches ~844k rows at six months. It would have failed only after months of
  data accumulated. Replaced with `concat`.

Verified end to end: `archiveCalls 1 · archiveRowsReturned 547 · livePages 1 ·
xlsxBytes 6,934,041 · err null`.

**Phase 5 — stores see two states.** "Pending / Completed by HO / No change
needed / Store confirmed / Clear" is head-office vocabulary about who owes whom
an answer. A store only needs to know whether a record is live or archived, so
store logins now get **Current / Archived** and nothing else. Back office keeps
the real statuses, because the management performance reports are built on them.

> **Current is not a new filter.** It is exactly what a store already got by
> default — no status selected, so the server applies `neq.cleared`. The default
> view is byte-for-byte unchanged; only the control is simpler.

**The rename is DISPLAY ONLY.** Every stored value stays `'cleared'`. Live and
test share one Supabase and this is a PWA, so renaming the stored value would
break any store on a cached bundle — and a new status value is blocked by CHECK
constraints regardless. Verified after the change that the writes, the
`includeCleared` wire param and the dropdown id are all still the literal
`'cleared'`.

Renamed across three separate `STATUS_LABEL` maps, both copies of the row
actions (TaskRecordList and Reports each have their own), both bulk buttons, and
the detail modal's timestamp row. Dashboard's map had **no `cleared` entry at
all** — its consumer falls back to the raw DB value, so a cleared record printed
a lowercase `cleared` on screen. Fixed, since Phase 4 makes archived records
reachable.

Verified on the deployed test app: the back-office dropdown reads
*Pending · Completed by HO · No change needed · Store confirmed · **Archived***,
and back office correctly does **not** see the store control.

> ⚠️ **The store-side control is unverified.** It renders only for `!isBO`, and
> no store login has been available. Same blocker as the three outstanding UI
> checks.

### 2026-09-23 — Archive Phases 3–4a: the guard, and the read endpoint

**Phase 3 — the purge guard.** `task_records.archived_at` is stamped by the
archiver once D1 confirms it holds a record, and `purge_old_task_records()` now
refuses to delete a Task J record while it is NULL. Before this, "archiver at
01:30, purge at 02:00" was a convention about clock times: a failed archiver
meant Postgres deleted unarchived records with nothing to detect it. Now a
failed archiver leaves records in Supabase — visible and recoverable — because
nothing marked them. ~3 MB/day against 257 MB of headroom, so ~3 months to
notice.

Verified without deleting anything: with 547 J records past the cutoff and none
marked, the purge predicate selects **0** of them. H still selects its 514;
B/C/K unaffected.

> Stamping is safe against `trg_task_stats_capture_update`, which early-returns
> unless status or the photo columns change — so marking a three-week-old row
> does not rewrite that day's `task_stats_daily` and shrink a historical
> dashboard bar. Checked in the trigger body before relying on it.

**Phase 4a — `GET /api/reports/archive`.** A SEPARATE endpoint, not a branch
inside `/reports/task-records`. That export is tuned around the free-tier 10ms
CPU budget — its JSON path formats rows *inside Postgres*
(`report_task_records_flat_page`) because per-row Worker formatting was silently
killing requests. Merging a second source in would reintroduce exactly that, and
an archive fault could then break live reporting. Kept apart, the client
concatenates — cheap, because the sources are **disjoint by date** at the
retention cutoff.

Bounds are mandatory, not defensive: D1 bills rows SCANNED, and since
2026-09-01 the free plan *fails* queries past 5M rows/day. `from`/`to` required,
window capped at 200 days, store scope applied, keyset paging on the primary
key. Measured: a date-bounded page reports **`rows_read: 3` for 3 rows** — the
`WITHOUT ROWID` key doing its job. An id-only lookup, by contrast, reads the
whole table (547 for 2), so reports must never be unbounded.

`status` is returned as **'Archived'** whatever it was when the record moved;
the original value stays in D1 for back-office reporting.

> ⚠️ **Not yet verified end to end.** The endpoint is deployed and its SQL and
> read cost are proven directly against D1, but an authenticated call has not
> been made — so the D1 binding reaching the Pages Function runtime, and the row
> mapping, are unconfirmed. Needs a logged-in session.

**Two honest gaps in archived rows:** `selling_price` and `product_type` come
from a `prices` join the RPC does in Postgres, and D1 cannot reach Postgres, so
they are blank. And `source='test'` is not filtered — because the live reports
do not filter it either.

**Phase 4b (client checkbox) and Phase 5 (store Current/Archived) remain.**

### 2026-09-23 — Department Check archive to Cloudflare D1 (Phases 1–2 done)

Six months of retention cannot live in Supabase: the free tier is 500 MB, the
database is already at 243 MB, and six months of `task_records` would be ~542 MB
on its own. So a record now spends its first 21 days in Postgres
(`scan_record_retention_days`) and the rest of its life in D1.

**Scope is `task_type = 'J'` only** — Department Check, including Department
Scan. That is what keeps everything else intact: `/reports/aging` depends on
Tasks A–F being purge-exempt, and Expiry Overview depends on Task M keeping 180
days in Postgres. Measured, not assumed: Task J has **0 message threads and 0
`pricing_items` rows**, so the `ON DELETE CASCADE` on those tables is a non-issue
at this scope.

**Phase 1 — D1 database + schema.** `homesavers-archive`,
`6c728765-d614-4282-a648-4b3fc3bf78fe`. One table, `WITHOUT ROWID` with
`PRIMARY KEY (created_at_ms, id)` so the table is physically date-ordered —
which is what protects the 5M rows/day free read limit, since D1 bills rows
SCANNED, not returned. Schema and reasoning in `d1-archive-schema.sql`.

> **A single database, not the monthly shards first sketched.** Task J populates
> only 15 of 36 columns (13 are NULL across all 163,517 live rows), and the
> window held here is ~159 days, not 180 — six months minus the 21 in Supabase.
> That puts the archive at ~210 MB of the 500 MB **per-database** free limit.
> Note the limit that matters: 5 GB is the *account* total across up to 10
> databases; a single database is capped at 500 MB on the free plan.

**Phase 2 — archiver Worker, shadow mode.** `homesavers-archiver`, cron
`30 1 * * *`. It must be a separate Worker: Pages Functions cannot run on a
schedule, and Postgres cannot push to D1 (`pg_net` is not installed). 01:30 UTC
is deliberately 30 minutes ahead of pg_cron's 02:00 purge; both are UTC.

Shadow mode writes to D1 and deletes nothing, so it cannot lose anything that
was not already being destroyed nightly.

**First live run verified against Postgres:**

| | |
|---|---|
| Run | `scanned 548 · inserted 547 · alreadyHad 1 · deleted 0 · 946ms · error null` |
| Row count | **547 in D1 = 547 due in Postgres** |
| Department fidelity | 496 with / 51 without — matches Postgres exactly |
| Field check | two records compared column by column: byte-identical, including ms timestamps |
| Test rows | 0 on both sides |

`alreadyHad: 1` is the paging design working: 548 rows at 500/page means one
boundary row repeats on the inclusive cursor and is absorbed by
`INSERT OR IGNORE` — which is what the composite primary key is for.

**Why Phase 3 is still needed.** Shadow mode preserves data only by *winning a
race*: the archiver runs at 01:30, pg_cron deletes at 02:00. If the archiver
fails one night, Postgres deletes anyway and those records are gone. Phase 3
narrows `purge_old_task_records()` so it can only delete what D1 confirms it
holds, which turns the ordering from a convention into a guarantee.

**Read-cost note for the reporting phase.** A lookup by `id` alone scans the
table — the spot-check above reported `rows_read: 547` to return 2 rows. Reports
must stay bounded by date and store, which the primary key and
`idx_archive_store_created` cover; an unbounded id lookup over ~844k rows would
cost ~844k of the 5M daily read budget.

### 2026-09-21 — Full audit of the scanning surface: 12 defects found and fixed

Prompted by shipping the lookup refactor to live on a build check alone. Method
was three-part: unit tests bundled from the REAL source with esbuild (not
reimplementations), independent multi-agent review, and manual verification of
every claim before acting. **Several agent findings were wrong and were
discarded** — e.g. "6 records prove bad UPC-A recovery" (all 6 are genuine
11-digit master entries). Verify before fixing.

**The serious one — Department Scan was silently losing scans.**
`handleConfirm` ran `if (gen !== genRef.current) return` *between* the lookup
and `createTaskRecord`. A scan superseded by a newer one was therefore never
saved: no beep, no outbox entry, and its row stuck on "Looking up…" for good.
Reachable whenever a second scan arrives during a slow lookup — and the input is
never disabled while one runs (ScannerInput draws a spinner but stays live), so
on shop wifi the window is up to `LOOKUP_TIMEOUT_MS`. This was on the screen
carrying **97% of all records** and matches the stuck/frozen reports from
stores. The guard is gone; everything after it is keyed by the unique `rowKey`,
and the busy spinner is still generation-gated.

> The same pattern is **safe** in `useTaskForm` and `TaskHForm`, where the guard
> gates UI state only — those forms save on a separate button press. Dept Scan
> is the only screen that auto-saves, which is what made it dangerous there.

**Found by the unit tests** (`altFields` 17 assertions, lookup helpers 10):

- `altFields`: `recovered_from` with an empty `barcode_no` resolved to **null**,
  dropping the barcode entirely. Introduced earlier the same day. Now requires
  both halves. The Dept Scan double-application path is covered.
- `withLookupTimeout` leaked its timer when the request won the race — a live
  10s timer per scan, thousands a day. Cleared in `.finally()`.

**The cascade worth remembering.** Gating Save on `lookupLoading` across all
eleven forms (a correctness fix — it stops a record saving with every product
column null) collided with a *pre-existing* bug: `reset()` bumped `genRef`
without clearing `lookupLoading`, so an in-flight lookup's `finally` skipped the
reset and the flag stuck true forever. Tapping Clear during a lookup then left
the form **permanently unsavable**. A safe change plus a latent bug produced a
worse failure than either alone. Root cause fixed in `reset()`.

**The rest:**

| Defect | Effect |
|---|---|
| Undo dropped rows still `saving` | Record commits with nothing on screen and no way to undo it |
| Failed save rendered as success | Table said "Saved"; `savedCount` disagreed; nothing said which scan to redo |
| `canUndo` required a server id | Undo disabled for the entire time a store is offline; the queued branch was dead code |
| Post-sync refetch used bare `scanLookup` | One hung socket stalled a **sequential** loop over 10 rows |
| `drain()` never restored `barcode_no` | Offline trimmed UPC-A landed in exactly the state 177 rows were backfilled out of |
| Tasks C and F need a fetched vocabulary | Neither could be recorded offline at all; now cached in `localStorage` |
| Task D required a read-only field | Unsavable whenever the lookup missed; also kept the previous product's name on a re-scan |
| `MultiSelectDropdown` sized in `vh` | Opened under the Android keyboard; now measures the **visual** viewport and flips up |
| `request()` spread options after headers | Latent: the first caller to pass headers would silently lose `Authorization` |

**Verified clean:** sign-in at 360px (no horizontal scroll, no overflowing
elements, no console errors); Dept Scan's 7-column table (scrolls inside its own
`overflow:auto` container by design, description ellipsised).

> ⚠️ **Not verified:** the logged-in forms were never driven end-to-end. That
> needs a store PIN. Everything above rests on source reading, unit tests
> against real code, and a clean build — not on operating the forms. Worth a
> pass on the test app before trusting the UI-level fixes (failed-row rendering,
> the dropdown flip, Task D).

### 2026-09-21 — Department Scan's speed work applied to every other task form

Dept Scan's core win was collapsing the two strictly-sequential lookups into one
`/scan/lookup` request. Every other scanning task was still paying the old cost,
so the same change was applied across both surfaces.

**The two-hop pattern.** `useTaskForm.triggerLookup` called
`lookupAltBarcode`, then a form's `onLookup` called `lookupPrice(product.ean_barcode)`.
The second call *needs* the first call's `ean_barcode`, so it could never
overlap — two full device→edge round trips per scan, on shop wifi.

| Path | Round trips before | After |
|---|---|---|
| Task J (Department Check, HO form) | 2 | **1** |
| Task K (Price Check) | 2 | **1** |
| Task M (Routine Expiry Sweep) | 2 | **1** |
| Task H (Stock Count) | 2 | **1** |
| Offline drain, **per queued record** | 2 | **1** |
| Tasks A/C/D/E/G (no price needed) | 1 | 1 |
| Task B, F, Store-Task blocks (no price needed) | 1 | 1 |

All 11 task forms share `useTaskForm`, so pointing the hook at `/scan/lookup`
fixed most of them at once; J/K/M now read `product.price` from the response
they already have, and their `onLookup` handlers stopped being `async`. Task H
and the outbox drain rolled their own two-hop lookup and were changed directly.

The price select is **identical** in both endpoints
(`ean_barcode,item_group,item_subgrp_id,product_type,sale_rate`), so nothing was
lost in the swap. The forms that never needed a price stay on
`/alt-barcodes/lookup` rather than making the Worker do a `prices` query they
would throw away.

**`scanLookupOrNull` — why a wrapper rather than reusing `scanLookup`.**
`scanLookup` deliberately has **no** offline short-circuit: Dept Scan must tell
"no signal" from "this barcode is not in the master". The task forms want the
older, gentler contract — a null, a record that still saves, and `drain()`
filling in product and price on reconnect. Putting the short-circuit in a
wrapper keeps both behaviours, and leaves Dept Scan untouched.

**Stuck-screen fix (was latent, and real).** `request()` is a bare `fetch` with
no `AbortController` — no timeout anywhere. A shop-wifi socket that connects and
then never answers never rejects, so `lookupLoading` could stay true forever;
Tasks J/K/M/H disable Save while it is set, so the form became **unusable**, not
just slow. Both lookup helpers are now bounded by a shared 10s
`withLookupTimeout`, the same bound Dept Scan already applied to itself.

**Trimmed UPC-A now handled everywhere.** `altFields()` stored the *scanned*
code as `barcode_no`, so a recovered 11-digit scan persisted a value that is
never a valid retail barcode — the exact condition behind the 177-record
backfill. It now prefers the corrected `info.barcode_no` whenever
`recovered_from` is set, matching Dept Scan. Task B was the only form not
persisting `product_code`, so it gained it — that raw scan is what keeps a
misconfigured handheld detectable.

**Task H also gained a generation guard.** It rolls its own `triggerLookup`
instead of using the hook's, so it had no protection against an out-of-order
response: a slow lookup for one barcode could land after a fast one for the
next and show the wrong product against the count being typed.

**Measured workload this was aimed at** (live, 30 days, continuous scanning —
gaps under 120s):

| Task | Records | Median s/scan | Share |
|---|---|---|---|
| J Department Check | 159,302 | 8.55 | **96.9%** |
| K Price Check | 4,386 | 9.86 | 2.7% |
| H Stock Count | 535 | 17.06 | 0.3% |
| B Non-Scans | 118 | 70.74 | 0.1% |

J averages 7,241 records per active day and peaked at 12,376. Dropping one
request per scan removes roughly that many Cloudflare requests per day from an
account on the 100k/day free plan.

> ⚠️ The per-scan medians above are **workload** figures, not a measurement of
> round-trip latency — they include the operator walking, aiming and typing.
> The round-trip *counts* are a code fact; the seconds saved are not yet
> measured. The lookup endpoints require auth, so they could not be timed
> directly from outside the app.

### 2026-09-21 — Test App toggle hidden on live; historical trimmed UPC-A backfilled

**Test App toggle is now test-only (in behaviour, not in code).** The one-tap
Test/Live toggle on the HO Tasks screen (`TestAppToggle` in
`client/src/components/TaskForm.jsx`) used to render on both builds. Stores could
therefore cross into the test app with a single tap; records made there are
tagged `source='test'`, never reach the live HO queues, and the store's scans
were effectively lost. The component now early-returns `null` when
`isTestEnv()` is false, so:

| Build | Toggle |
|---|---|
| Live | hidden |
| Test | shows "↩ Live App" — a tester can always get back |

Back is the only direction that needs to stay open. The two-sided rendering
underneath is deliberately left intact: **re-opening the toggle for the next
round of store testing is deleting the `if (!test) return null` line**, nothing
else. The change is on BOTH branches — it is hostname-keyed, so identical code
produces the asymmetric behaviour, and `TaskForm.jsx` stays out of the
main↔test diff.

**Backfilled 177 historical trimmed-UPC-A records.** Several handhelds were set
not to transmit the UPC-A check digit, so 12-digit US barcodes arrived as 11
digits and matched nothing. The live recovery fix only helps new scans, so the
existing rows were repaired in one statement: `barcode_no` corrected to the full
12 digits, and `product_barcode` / `item_name` / `supl_id` / `supplier_code` /
`item_status` / `barcode_status` / `details.item_group` populated from the
master — exactly what the app now writes. `product_code` was deliberately left
holding the original 11-digit scan, so the misconfigured devices stay
detectable. 177 of 180 repaired, all with a department; the other 3 have a valid
check digit but no such product in the master, so they were left alone rather
than invented.

Affected stores: Tallaght 74 · Ennis Ballymaley 45 · Athy 20 · Longford Axis 20
· Crumlin 10 · Milford 5 · Edenderry 2 · Killarney 1. Only 1–20 September
survived the 21-day retention, so this is the full *recoverable* set, not the
full historical one.

**Two schema traps worth remembering** (both produced wrong counts before being
caught — see §12):

- `alt_barcodes.ean_barcode` is **not** a barcode. It holds the internal item
  code (`14-03-397-00`). The scannable barcode is `alt_barcodes.barcode_no`.
  Joining a barcode against `ean_barcode` returns zero rows *silently*.
- `alt_barcodes` has **multiple rows per `barcode_no`** (typically one Active +
  one Inactive). A plain `LEFT JOIN` fans out and inflates `count(*)`. Use
  `LEFT JOIN LATERAL (… ORDER BY barcode_status, item_status LIMIT 1)` — the
  same ordering the Worker's `selectAlt()` uses, so it picks the row the app
  would.

### 2026-09-21 — Department Scan shipped to live, plus the speed work behind it

Shipped in four deliberate steps, each verified before the next.

**Measured hardware facts — these are settled, do not re-litigate them.** The
store handhelds are generic Chinese Android units ("V520"), NOT Zebra, and
device-settings changes have historically never stuck. A scan is delivered
**through the Android IME** (2 keydowns for 13 digits, `keyCode 229` /
`Unidentified`), measured on a real device. Consequences:
- Suppressing the keyboard suppresses the scan. `readOnly`, `inputMode="none"`
  and `virtualkeyboardpolicy="manual"` each block the gun entirely — all three
  measured, confirming the reverted June attempts. **The scan must land in a
  focused, ordinary, editable input.**
- With nothing focused the page receives only an `F1` prefix (keyCode 112) and
  **zero barcode characters**, so a no-input/document-capture design is not
  possible on this hardware.
- `F1` arrives at the START of the burst, so it is a prefix, not a terminator —
  it cannot replace the 250ms auto-settle.
- Do not design anything that depends on reconfiguring 55 stores' devices.

**Baseline before any of this:** continuous Department Check (gaps ≤30s),
median **8.29s**/item on live, p10 4.87s, p90 16.42s. Across 143,818 live Task J
records there are **zero notes and zero quantities** — every stored field is
derived from the barcode, which is what justifies removing the Save tap.

**Step 1 — scanner latency fixes** (originally `608e69d`, sat unmerged on test
since 19 Aug with "not for main until store-tested"; that test happened 18 Sep
and passed). An idempotent confirm guard — `onBlur` fired a lookup on Save,
which disabled the button between mousedown and click so **the first Save tap
was silently swallowed**; an 800ms Android IME-echo guard; the per-save
`ScannerInput` remount dropped; `Toast` context memoised (an unmemoised object
re-rendered the whole record list ~3.5s after every save, landing mid next
scan); `TaskBForm` photo uploads parallelised. Benefits **every** task form.
Worth ~7% on its own (8.29s live vs 7.79s on test while it ran there).

**Step 2/3 — `/scan/lookup` and `scanned_at`.** One request resolves both
halves of a lookup inside the edge Worker instead of two sequential round trips
over shop wifi; `POST /task-records` accepts a client scan time so an offline
batch is no longer timestamped at **reconnect** (HS Wicklow Abbey St showed a
0.44s median gap and Tullamore 1.06s — those were drain bursts, not scanning).
`resolveScanTime()` trusts a client stamp only within a sane window and falls
back to the server clock, so clients that send nothing behave exactly as before.

**Step 4 — Department Scan** (`client/src/pages/DeptScan.jsx`, `/dept-scan`).
Store and task chosen once; after that the operator only pulls the trigger.
- The keyboard **is** going to be up, so the layout assumes it: everything
  needed sits in a ~141px strip at the top, nothing that matters is placed
  where the keyboard covers it, and the page never scrolls. Full-bleed via
  `body.deptscan-full`.
- **No Save tap** — the record commits on lookup; a large Undo replaces the
  confirmation. Same barcode within 3s is refused with a two-tone alert; a
  sub-second repeat is an IME echo, swallowed one layer down. No department
  found saves normally and stays silent (business rule).
- Nine-column detail table, deliberately wider than the screen and scrolling
  sideways rather than cramming into 412px.
- Offline: queues to the outbox with a "waiting" count; a failed lookup is
  distinguished from a genuine miss; Undo pulls a queued scan back out; rows
  fill in on reconnect, bounded to 10 lookups.
- `ScannerInput` gained two **opt-in** props, `compactActions` and
  `resetSignal`, plus blurring the field while the camera is open. Task forms
  A–M pass neither and are unaffected.

**Also fixed on live along the way:**
- **Camera close crashed the page.** `html5-qrcode`'s `stop()` throws
  *synchronously* when the scanner never started (permission denied, no camera,
  start in flight); a sync throw never reaches `.catch()`, so it escaped the
  effect cleanup and tripped the ErrorBoundary. Tapping Camera on then straight
  off took the whole page to "Something went wrong". Affected every task form,
  but only where an admin enabled camera scanning (off chain-wide by default).
- **Trimmed UPC-A check digits** (`/alt-barcodes/lookup`). Six stores'
  handhelds are set not to transmit the check digit, so a 12-digit US barcode
  arrives as 11 and never matches — 73 scans in 60 days, still happening.
  11 digits is never a valid retail barcode and the check digit is
  arithmetically determined, so there is exactly one candidate. **Guard:** it is
  only accepted if it already exists in `alt_barcodes`; a miss falls through to
  null as before. 8/8 real barcodes reproduced, 144/147 (98%) of unmatched
  11-digit scans resolve. Still worth turning the setting back on for HS
  Tallaght, Athy, Ennis Ballymaley, Crumlin, Longford Axis and Milford.

**Deliberately NOT on live:** the Scan Doctor diagnostic page, the
`/device-diagnostics` endpoint and the darker test palette. See §12.

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

- **Scan Doctor is deliberately test-only — do not ship it to live.** Decided by
  the business owner 2026-09-21, after Department Scan went live. The page
  (`/scan-doctor`, `client/src/pages/ScanDoctor.jsx`) and its upload endpoint
  (`POST /device-diagnostics`) exist on the `test` branch only. It is a
  diagnostic instrument for settling device questions — it reports exactly what
  a handheld emits per scan — and it is how the IME findings in §11 were
  established. Reach for it on `test` when a new device question comes up;
  do not port it. The `device_diagnostics` table already exists in the shared
  database and is inert on live because only the test Worker can write to it.
- **The darker test palette is test-only by design** (`data-testenv` in
  `App.css`, stamped in `main.jsx`). It is how staff tell the test app from
  live at a glance. Never port it.
- **Six stores still have handhelds that trim the UPC-A check digit** — HS
  Tallaght, Athy, Ennis Ballymaley, Crumlin, Longford Axis, Milford. The app
  now recovers these (§11), so the data is correct, but the devices are still
  misconfigured and the raw scan is kept in `product_code` so they stay
  detectable. Turning the setting back on at source remains the cleaner fix.
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
