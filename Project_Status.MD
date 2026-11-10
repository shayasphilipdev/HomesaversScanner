# Homesavers Scanner — Project Status

A self-contained snapshot of the whole app as it stands today. If you are a
fresh Claude session opening this repo cold, **read this file first** — it has
the architecture, data model, every module, recent changes, known issues, and
the project memory all in one place.

*Last updated: 2026-11-09.*

---

> ## ⚠ SECURITY NOTICE (2026-10-30, updated 2026-11-09) — local PC fully wiped and reinstalled
>
> **2026-11-09 update:** confirmed as a **Qilin ransomware** attack. The
> machine at `C:\Scraping\homesavers-scanner` (the "local source / primary
> dev box" row in §2 below) had its files encrypted and has since been
> **formatted and reinstalled as a new PC** — a fresh OS, not a cleaned-up
> old one. Practical effect: that machine is clean now, but it is also
> **completely empty** — no codebase, no Windows services, no Scheduled
> Tasks, no local secret files. Everything that used to run from it (the 5
> data syncs, the 3 report emails, the local upload server, the delivery
> manifest) has to be rebuilt from nothing. **The live app itself was never
> affected and has kept working throughout** — see the original note below
> for what is and isn't touched.
>
> **Pushing from that PC is fine again** once it's rebuilt with a working
> git setup — it's a clean machine now, not the infected one. The restore
> plan is `docs/post-wipe-restoration-plan.md`, built on top of the two docs
> written during the original incident: `docs/local-pc-rebuild-runbook.md`
> (what each job does and how) and `docs/website-disaster-recovery-guide.md`
> (the website/database/hosting side, which never needed touching).
>
> **Secret rotation is now an open decision, not a "don't ask" one.** The
> original note below said not to re-raise rotation because every local
> secret file still held its original, un-rotated value and changing it
> would have broken jobs still running from the infected PC. That reasoning
> no longer applies: the PC is wiped, so every local secret has to be
> re-entered from scratch regardless. `PRODUCT_SYNC_SECRET` and the Brevo
> credentials can't be read back from Cloudflare once set anyway, so those
> are being rotated as part of the rebuild (see the restoration plan). The
> Supabase URL/anon key are being reused as-is (Supabase can show those
> again, and the website side was never compromised, so there's no reason
> to change them). A future session can treat this as settled — it does not
> need to ask again.
>
> --- *Original note, 2026-10-30, kept for history* ---
>
> **The live app itself is unaffected and working normally.** Confirmed
> 2026-10-30: the website, Supabase, and Cloudflare D1 are all cloud-hosted
> and were never on the compromised PC, so there is no data-loss or
> live-service impact from this incident — only the local machine's own
> files and its role in running the nightly Windows Task Scheduler sync/email
> jobs are affected (see §2 and the "Known limitations" section for what
> those jobs depend on).
>
> `main`'s git commit HISTORY was found to be a different, shorter lineage
> (50 commits, 2026-10-05 to 2026-10-28) than the cloud session's prior
> working branch — an unrelated-histories situation, confirmed NOT a
> content-loss issue (every feature from the prior history was independently
> verified present in current `main`'s files). If this surfaces again (a
> future push refusing to merge with "unrelated histories"), don't force a
> merge of the old lineage — treat current `main` as the source of truth,
> restart the working branch from it, and reapply only whatever specific
> change prompted the push, same as was done here.

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

### 2026-11-10 — Backup photos: 7-day grace after the app deletes them (user decision)

The user said photos aren't important and asked to keep only what's in the
app, plus about a week.

`backup_photos()` now:
- Records in `photos-removed.json` (backup root) the day each local photo was
  first seen missing from the bucket.
- Deletes it once `PHOTO_GRACE_DAYS` (7) have passed, and tidies empty folders.
- Deletes nothing if the bucket listing comes back empty, which is more
  likely an error than an empty bucket.

This replaces the append-only mirror described in the previous entry. Tested:
missing photos are kept, then removed after 8 days, and an empty listing
removes nothing.

### 2026-11-10 — First complete app backup verified; photo retention vs backup

The `sync_runs` backup row at 13:42 is ok:
- 38 MB daily backup
- archive exported via the API (53 MB gz)
- 275 photos already mirrored, 0 new

The app deletes task photos at `photo_retention_days` (21), via the nightly
cleanup's `list_old_photos` plus record-linked deletes. Storage now holds
20 Oct – 10 Nov (275 files, 142 MB).

The backup mirror (`photos\`) is append-only, so every photo is kept
permanently from 10 Nov on, under its bucket path. Archived D1 rows keep their
`photo_*_url`, so a photo can be found by the path after `/task-photos/`.
Photos deleted before 20 Oct can't be recovered. Growth is about 140 MB per
21 days.

### 2026-11-10 — First app backup run; archive export switched to the D1 export API with its own token

**Setup:**
- Pooler `aws-1-eu-central-1` (aws-0 answers "tenant not found").
- A 16-character database password, reset by the user because all passwords
  were lost after the attack.
- 31 relations in `public`.

**First run** (`--force-d1`, 3 minutes, 38 MB):
- Database dump OK: 30 tables, 26 with data. Largest: alt_barcodes 214,786,
  task_record_events 214,563, task_records 212,287.
- Code bundle OK (origin/main 5ac7f66).
- 23 PC-settings files.
- 275 of 275 photos copied.

**Archive export failed:** `wrangler d1 export` with the OAuth login got
"Authentication error [code: 10000]" from `/d1/database/<id>/export`.

**Fix:** `d1_export_api()` uses Cloudflare's polling export API (start, poll
`current_bookmark`, download `signed_url`) with its own token, saved to
`C:\Homesavers\.cloudflare-d1-export-token`.
- Token name: `homesavers-backup-d1-export`, permission Account → D1 → Edit.
- `--setup` asks for it and checks it with a GET on the database.
- Wrangler stays only as a fallback, run with `NO_COLOR`.
- Mock test: polling flow, bookmark carried over, gzip written, a 403 is
  reported clearly.

**Also:**
- `--setup` reports the length of the pasted password.
- A refused password stops with a clear message instead of trying the other
  host.
- Pruning is skipped after a failed run, so the first run's folder is kept.

### 2026-11-10 — Nightly app backup to B: (`scripts/backup-app.py`, task "Homesavers App Backup" 03:00)

The user asked for a backup of everything the app needs, on B:, to recover
from ransomware. Destination: `B:\Supply Chain & Buying - Shared\HomesaversScannerBackup`
(UNC `\\192.168.1.205\Buying Data\...` first). The user confirmed the B:
server is a NAS with snapshots. Those snapshots are the real ransomware
protection, because the PC can write to B:.

**What it saves:**
- `daily\YYYY-MM-DD\`, keeping 30 (and pruning only after a clean run):
  - `pg_dump -Fc --no-owner -n public` of the database. Data is excluded for
    the four product-master tables, which are rebuilt daily.
  - The schema as SQL.
  - `cron.job` and `storage.buckets` as CSV.
  - A `git bundle --all` after `git fetch`.
  - `pc-settings.zip`: `C:\Homesavers` without dot-files (the secrets) or
    big/derived folders. Password, key, secret, token and cookie fields in
    JSON are blanked. Scheduled tasks are included as XML.
  - `MANIFEST.txt` with SHA-256 checksums.
- `d1\` gets a weekly (Sunday) `wrangler d1 export` of `homesavers-archive`,
  gzipped, keeping 8. A D1 export locks the database while it runs; 03:00 is
  clear of the archiver's 01:30, 01:45 and 22:30 runs.
- `photos\` is an incremental mirror of the `task-photos` bucket, using
  public URLs and the list from `storage.objects`.

**Checks:**
- `pg_restore --list` must show TABLE DATA for every public base table except
  the four structure-only ones.
- The archive export must be over 1 MB.
- `git bundle verify`.

**Connection:**
- PostgreSQL 17 client tools (EDB zip) go into `C:\Homesavers\pgsql`.
- It uses the Supabase **session pooler**, `postgres.<ref>@aws-0|aws-1-eu-central-1.pooler.supabase.com:5432`,
  with SSL required. Direct `db.<ref>.supabase.co` is IPv6-only.
- `--setup` saves the working host in `C:\Homesavers\backup-config.json` and
  the database password in `C:\Homesavers\.supabase-db-password` (this PC
  only; also kept in Bitwarden). The password is passed by environment
  variable, never on the command line.

**Reporting:** a `sync_runs` row with kind `backup` (`records_imported` = MB).
A new **App Backup** card on Admin → Settings → Data Sync. `/admin/sync-runs`
now always appends the latest 5 backup runs. API_REVISION is
`2026-11-10-backup-card`. The B&M card footnote is updated for the SFTP
schedule.

**Other files:** `install-scheduled-tasks.ps1` registers the task once the
password file exists. `deploy-scripts.ps1` deploys it. New
`docs/backup-and-restore.md`, also copied into the backup root as
`README-RESTORE.txt`.

Tested with fake pg tools:
- Layout and manifest are correct.
- No secret appears in `pc-settings.zip` (5 planted secrets checked).
- Pruning keeps 30.
- A dump missing tables records an error, and nothing is pruned.

The client build couldn't be run here (npm registry blocked); the JSX change
is a copy of the existing SyncCard pattern.

### 2026-11-10 — Archiver third run deployed

The user ran `wrangler deploy` (wrangler 4.160.0) from `workers/archiver` and
set `CLOUDFLARE_API_TOKEN`: token `homesavers-archiver-d1-usage-read`, with
Account Analytics: Read.

Verified via the Cloudflare API that the deployed `homesavers-archiver` script
contains `runExtra`, the `30 22 * * *` dispatch and `X-Archive-Mode`. The first
extra run is at 22:30 UTC on 10 Nov. A check is scheduled for 11 Nov at 09:10.

The deploy also went live with `sbBearer` (non-JWT key support).

PC note: Node is at `C:\Program Files\nodejs` but isn't on the PATH in older
shells. Use `npx.cmd` (plain `npx` may be blocked by the script execution
policy).

### 2026-11-10 — Archiver: third, allowance-limited nightly run (22:30 UTC)

The user asked for a third archive run that checks the remaining D1 write
allowance first. The dashboard showed 46–83k of the 100k/day used.

`workers/archiver`:
- New cron `30 22 * * *` runs `runExtra()`.
  - It reads today's (UTC) D1 `rowsWritten` from the GraphQL analytics API
    (`d1AnalyticsAdaptiveGroups`, same query as the Pages usage chart).
  - It keeps a 10k reserve and allows `(100k − 10k − written) / 3` records
    (3 writes per record, rounded up from the ~2 observed).
  - It calls `runArchive(..., { maxRecords, skipPurge: true })`. It never
    purges; the 01:30 run keeps doing that on the next day's allowance.
  - Under 500 records allowed → skips.
  - If analytics can't be read → logs `extra run skipped` in `archive_runs`
    and moves nothing.
- Without purges it can afford more pages: about 11,000 records a night,
  versus 9,000 per regular run. Total goes from ~18k to ~29k a night.
- `runArchive` takes `opts` (`maxRecords`, `skipPurge`, `subrequestsUsed`). The
  page `limit` shrinks to the remaining allowance. The two regular runs are
  unchanged.
- The manual `/run` endpoint accepts header `X-Archive-Mode: extra`.
- `wrangler.toml`:
  - Third cron.
  - `CLOUDFLARE_ACCOUNT_ID` and `D1_ARCHIVE_DATABASE_ID` vars.
  - **New secret `CLOUDFLARE_API_TOKEN`**, needing Account Analytics: Read.
- **Needs `npx wrangler deploy` from `workers/archiver`.** This Worker is not
  deployed by the Pages push. The deploy also carries the earlier
  `sbBearer` change, which is harmless with the legacy key.

Mock tests:
- With plenty of allowance it's limited by subrequests: 11,000 moved, 42 of
  50 subrequests, no purge.
- With 80k written it moves exactly 3,333.
- With 89k written it skips.
- When analytics fails it skips and moves nothing.
- The regular run is unchanged: 9,000 moved, both purges.
- The cron dispatch picks the right run.

### 2026-11-10 — Why Supabase shows 72%: the Department Check archive backlog

The database is 362 MB of the 500 MB free-plan limit.

**Largest tables:**
- `task_records`: 118 MB, 211k rows, 99.9% Task J.
- `alt_barcodes`: 104 MB. This is steady; it's refreshed daily.
- `task_record_events`: 43 MB.
- `prices`: 32 MB.

**Cause:**
- Department Check scans ran at 17k–31k a day from 2 to 8 Nov.
- The archiver Worker moves a fixed **17,984 records a night**: 2 cron runs,
  each capped by the 50-subrequest limit.
- The purge only deletes records stamped `d1_copied_at`, so the excess stays
  in Postgres.
- D1 is current only to records created up to 30 Oct 14:34, while
  `dept_check_retention_days` = 7. Roughly 50k J records (30 Oct – 2 Nov) are
  already past their move date.
- Nothing is lost; the records just wait in Postgres.

**Outlook:**
- Scans were down to 8.7k on 9 Nov and 3k by late morning on 10 Nov, and the
  checks now follow a schedule rather than running weekly.
- At 18k out per night, the backlog (~190k due by 15 Nov) clears in about 10–11
  nights. The database then drops back.

**Also watch:**
- D1 is at 336 MB of the 500 MB per-database free limit (711k rows; records
  leave after 14 + 35 days).
- D1 writes: about 2 per archived row, plus up to 40k for the D1 purge and
  40k for the device-log purge, against 100k a day.

**Levers if it needs to go faster:**
- A 3rd archiver cron, added in the Cloudflare dashboard (no code deploy).
  About +9k a night, but check the D1 write budget.
- Workers Paid, which raises the subrequest cap.

**Not recommended:**
- `VACUUM FULL alt_barcodes` during store hours: it locks scanner lookups.

### 2026-11-10 — B&M one-off backfill: `sync-bm-daily.py --backfill-from YYYY-MM-DD`

The user wanted the share folders filled in from 28 Oct, using the files still
on SFTP, and **only the missing days**.

`--backfill-from`:
- Checks `Product File CSV` and `B&M Product File Excel\<year>` first.
- Downloads and saves only the SFTP files whose CSV and/or
  `HomeSavers_<date>.xlsx` is missing.
- With several files on one day, all CSVs are kept and the Excel is built from
  the day's last file.
- Nothing that's already there is touched or re-downloaded.
- Never uploads, never changes the sync state, never writes to Data Sync.
- With `--dry-run` it only lists the gaps.

The copy logic is now one `save_copies()` helper used by the normal sync.

Tests:
- Preview downloads nothing.
- The real run fetches only the 3 incomplete files and leaves the existing
  Excels as they are.
- No upload.
- The earlier logic tests still pass.

### 2026-11-10 — `utcnow()` deprecation warning removed from the price / alt-barcode syncs

Python 3.13 on the rebuilt PC warns that `datetime.utcnow()` is deprecated.
`sync-prices.py` and `sync-alt-barcodes.py` now use
`datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"`, which
produces the identical `started_at` string. Cosmetic only.

### 2026-11-10 — B&M Daily now comes from the SFTP product CSV (`scripts/sync-bm-daily.py`)

B&M put a daily product CSV on the same SFTP server as the manifests:
`Inbound File/Product File/HSVPRD<yyyymmdd><hhmmss>.CSV`. The new job replaces
the Excel-based `sync-bm-daily.ps1`, which is kept as `run_sync.bat bm-daily-excel`.

**Verified against 9 Nov:**
- ProductID = `Grp/SubGrp[:2]-Grp/SubGrp[2:]-Item-Option`. The CSV's 14,213
  IDs equal the live `bm_daily_file` (md5 of the sorted list matches).
- The Excel built from the CSV matches the user's trimmed
  `HomeSavers_20261109.xlsx` exactly: 0 differences in 7,680 cells, values and
  types. Full size is 14,214 × 768, the same as the original.
- Layout:
  - Sheet `First Sheet`.
  - `VarianceCode` (`<date>-01`), then `ProductID`, then the CSV columns renamed.
  - `Barcode list` becomes `Barcodelist` (its first entry, the B&M short code)
    plus `Barcode1..N`, with N as large as the longest row needs.
  - Values trimmed. Numbers become numeric unless they have a leading zero
    (stays text). Blanks are empty.
  - Bold header, `@` format.
  - Column widths copied from the original.
- Assumptions:
  - `-01` in VarianceCode: only one sample was available.
  - Trimming text cells: no sample row had padded text, and 492 such cells
    exist in the CSV.

**Behaviour:**
- Every 30 min from 07:00 to 12:00, via `pythonw`, so no window opens.
- Exits at once if the newest settled file (unchanged for 120 s) was already
  synced (`C:\Homesavers\bm-daily-state.json`).
- If today's file is still missing at 11:30, it records one failed run on Data
  Sync per day.
- Saves the CSV to `...\Data\Product File CSV` and the Excel to
  `...\Data\B&M Product File Excel\<year>`. It never overwrites, and a share
  outage is reported but doesn't block the upload.
- Uploads with the same reset + chunk API, with retries.
- Refuses a file with less than half the previous product count.
- Checks that the CSV still has 31 header columns before building the Excel.

**Other files changed:**
- `run_sync.bat`: `bm-daily` runs the new job; `bm-daily-excel` runs the old one.
- `deploy-scripts.ps1`: deploys both.
- `install-scheduled-tasks.ps1`: the B&M task is now the 07:00–12:00 repeating
  pythonw task.
- The runbook §4.3 and the restoration plan's tasks table are updated.

Tests (fake SFTP):
- Picks the newest settled file.
- Skips a file that's already synced.
- Warns once a day when the file is late.
- Doesn't overwrite an existing Excel.
- Refuses a broken short file.
- Still uploads when the share is down.
- A manual `--file` of an older CSV doesn't move the state back.

### 2026-11-10 — Key rotation and email setup postponed by the user; Supabase key optional in the helper

The user put off the Supabase key switch, because doing it in store hours could
affect the stores, and will finish the emails later. Current state:
- Live site, archiver and all configs still use the **legacy** anon key.
- The merged code works with either kind of key, so nothing changes until the
  user acts.
- **Open:**
  - The key-switch steps in HANDOVER.md, best done out of store hours.
  - Email helper → test sends → `install-scheduled-tasks.ps1` (Aging Report only).
  - Disable the legacy keys before Supabase retires them at the end of 2026.
- `setup-email-configs.py`: the Supabase key question can now be skipped with
  Enter, since only the paused area-manager email uses it. The Aging Report can
  be finished without touching the key.

### 2026-11-10 — Supabase key rotation: code accepts the new `sb_secret_` keys (API_REVISION 2026-11-10-new-supabase-keys)

The user wants to roll the Supabase anon key, because it was on the PC that was
hit by ransomware. With no RLS, that key has full access to the database.
Rolling the **legacy** anon key means rotating the project's JWT secret. That
changes anon and service_role together and breaks the live site until every
consumer is updated. Supabase's recommended route is a new **secret key**
(`sb_secret_...`): create it, switch each consumer over, then deactivate the
legacy keys. Deactivating is reversible. (Supabase docs also say the legacy keys
stop working at the end of 2026, so this migration was due anyway.)

The new keys aren't JWTs. Supabase rejects them in `Authorization: Bearer`, so
they must go on `apikey` only. Changes:
- `functions/api/[[route]].js`: new `sbBearer(key)` adds the Bearer header only
  for a JWT (`eyJ...`). All 21 `Authorization: Bearer ${SUPABASE_ANON_KEY}`
  sites and `sb()` now use it, so either key type works and the switch needs
  no downtime.
- `/api/ping` now also returns `dbKey`: `legacy` / `secret` / `other` /
  `missing`. It shows the kind of key only, never the key itself.
- `workers/archiver/src/index.js`: the same helper is used at both PostgREST
  calls. This Worker isn't deployed by the Pages push; it needs
  `npx wrangler deploy` from `workers/archiver`.
- `scripts/dept-check-area-managers.py`: `apikey` only for non-JWT keys.
- `scripts/setup-email-configs.py`: asks for the secret key, rejects a
  publishable key and anything that doesn't start `sb_secret_` / `eyJ`.

Every Supabase key consumer is in this list. The browser client never talks to
Supabase directly, and the sync scripts go through the API with
`PRODUCT_SYNC_SECRET`. Order of operations (user steps in HANDOVER.md):
1. Create the secret key.
2. Deploy this code.
3. Change the Pages secret and redeploy; check `dbKey: secret`.
4. Deploy the archiver Worker with the new code and secret.
5. Set the key in the email helper.
6. Deactivate the legacy keys.
7. Check the site and the next 01:30 archiver run.

### 2026-11-10 — Email test sends: "Config not found", because the helper hadn't finished

The helper printed "Testing the Brevo login... OK", but the three
`*.config.json` files were never written to `C:\Homesavers\scripts`. The
helper only writes them after the remaining questions are answered. The weekly
Department Check "To" was **required** and had no default, so with no list to
give, the run was never finished.

`scripts/setup-email-configs.py`:
- After the OK it now says "Not finished yet - answer the questions below".
- The weekly Department Check "To" can be left blank, since that email is
  paused. The scripts' `--to` test sends work without a list.
- Both Department Check sections are labelled "paused".
- It ends with "Done - all three settings files saved."
- A new test covers the blank weekly list.

### 2026-11-10 — Brevo working; Aging Report emails on; Department Check emails paused

- With the office IP on Brevo's Authorised IPs list, the email helper logged in
  OK and wrote all three configs.
- `scripts/install-scheduled-tasks.ps1`: the two Department Check email entries
  (`Homesavers Department Check Weekly`, and `Homesavers Dept Check Area Mon` /
  `Thu`) are marked `Paused = $true`. The installer doesn't register a paused
  task, and removes it if an earlier run registered it.
  **Homesavers Aging Report** (Wed 08:00) is the only email task registered.
- Why they're paused: department checks no longer happen every week. They
  follow a schedule the user will share. When it comes, replace the weekly
  triggers with that schedule and set `Paused` to `$false`.
- The configs stay in place, so a test send with `--to` still works for all
  three.

### 2026-11-10 — Brevo login cause found: "525 5.7.1 Unauthorized IP address"

The per-method diagnostic run on the PC answered it:
- The certificate is Brevo's own (`smtp-relay-ovh.brevo.com`, issued by Let's
  Encrypt), so nothing is intercepting the connection.
- Brevo offers PLAIN, LOGIN and CRAM-MD5, and every method got
  `525 5.7.1 Unauthorized IP address`.

So the login and the 90-character key are fine. Brevo's **Authorised IPs**
security setting is on, and the office's public IP (93.107.17.189 as of
2026-11-09) isn't on its list. The earlier 454 "unable to parse" was Python
reporting only the last method's error.

The fix is in Brevo, not in code: profile menu → Security → Authorised IPs →
add the office's public IP (or approve it from Brevo's "new IP" email). Then
re-run the helper.

The helper now recognises 525 "Unauthorized IP" and prints these steps
instead of the generic "check the key" advice.

### 2026-11-10 — Brevo login fails again with a correct 90-character key: per-method login diagnostic

The second attempt, using the full 90-character SMTP key pasted with right-click,
failed again with `454 4.7.0 501 5.5.2 Invalid syntax (unable to parse)`. That
error is not "wrong password" (which would be 535). It means the server couldn't
parse what was sent. Python's `s.login()` tries CRAM-MD5, then PLAIN, then LOGIN,
and reports only the **last** error, so we couldn't tell which method was
rejected, or whether something in between (antivirus email/SSL scanning on
port 587, which is common on a freshly rebuilt PC) was rewriting the traffic.

`scripts/setup-email-configs.py`:
- `test_login()` now tries each method on its own fresh connection: PLAIN with
  an initial response, LOGIN step-by-step, LOGIN with an initial response, then
  CRAM-MD5. For each one it prints the server's answer.
- It also prints the TLS certificate's server name and issuer, and warns when
  the certificate isn't Brevo's. A certificate-verify failure is reported as
  "something is intercepting port 587".
- It prints the methods the server offers, the login, and the key's length and
  whether it starts with `xsmtpsib-`. It never prints the key itself.
- The first method that works is saved in each config as `smtp.auth` and
  `smtp.auth_initial_response`.
- The pasted secret is also rejected if it contains non-ASCII or whitespace
  characters (a non-breaking or zero-width space copied from a web page). The
  helper shows the character codes.

`aging-report.py`, `dept-check-weekly.py`, `dept-check-area-managers.py`:
- New `smtp_login(s, smtp)` replaces the six `s.login(...)` calls. It uses the
  saved method. Without one, it behaves exactly as before.

Tested against a local fake SMTP server that rejects PLAIN and one-line LOGIN
with the same 454 error and accepts step-by-step LOGIN:
- The diagnostic picks LOGIN step-by-step.
- A total failure lists every method's answer, with no secret in the message.
- The email script logs in with the saved method and sends.
- The existing helper tests all still pass.

On the PC: `git pull`, run `scripts\deploy-scripts.ps1`, re-run the helper, and
send the printed lines if it still fails.

### 2026-11-10 — Phase 9: every scheduled job ran on its own; source files now arrive late

First unattended night on the rebuilt PC, from `sync_runs` (Irish time):

| Job | Ran | Status | File | Rows |
|---|---|---|---|---|
| CN codes | 02:45 | ok | export | 43,061 (= 9 Nov) |
| Prices | 07:00–07:03 | ok | `ItemMaster_2026_11_09` | 101,980 (= 9 Nov) |
| Alt barcodes | 07:30–07:35 | ok | `ALT Barcode Master_2026_11_09` | 214,786 |
| B&M Daily | 08:15 | ok | `HomeSavers_20261109` | 14,213 (= 9 Nov) |

Scheduled Tasks, Python path, sync secret, Excel and the network shares
all work unattended. Manifest: no run logged yet — it only logs when it
builds a new manifest, and deliveries usually land 08:30–15:00.

**Gap found:** all three file syncs picked up **yesterday's** file.
Before the attack the 07:00–08:15 runs found the same day's file almost
every day (Oct: B&M 27/27, alt 26/27, prices 24/28); on 9 Nov the source
files only landed at 10:53 (Item Master), 15:57 (ALT) and 16:22 (B&M). The
upstream exports that write to `\\192.168.1.205\Buying Data\...` appear not
to be back on their early-morning schedule — likely also affected by the
attack. Options put to the user: get those exports back to early morning,
and/or add a late-afternoon re-run of the three syncs (prices/alt upsert,
B&M reloads — all safe to repeat).

Phase 6 (report emails) still pending the Brevo SMTP key.

### 2026-11-09 — Phase 6 first attempt: Brevo login failed; helper now catches bad pastes

First `setup-email-configs.py` run on the PC: login `c240c0001@smtp-brevo.com`
(Brevo's newer SMTP-login style), sender `shayas.philip@supplychain1.ie`,
then `454 4.7.0 501 5.5.2 Invalid syntax (unable to parse)` — nothing
written, as designed. Likeliest cause: Ctrl+V into the hidden `getpass`
prompt on a Windows console types a 0x16 control character instead of
pasting. The helper now rejects control characters ("paste with
right-click"), prints how many characters it received, rejects a Brevo
API key (`xkeysib-`) in place of the SMTP key (`xsmtpsib-`), and the
failure message points at the SMTP tab. Tested. Installer run the same
day: all six non-email tasks registered; the four email tasks correctly
skipped (no configs yet).

### 2026-11-09 — Text typed before barcodes and RB2–RB9 stickers: records fixed, scanner fixed

User approved the other session's open question. Done for existing records
(live + archive) and for new scans.

**Rule (one rule everywhere):** only when a scan doesn't resolve as typed,
try (a) reduced stickers `RB` + a 1–2 digit tier + real code —
`RB208-03-085-00C` → `08-03-085-00C`, `RB25163339` → `163339` (two-digit
tiers exist: `RB12…`, `RB15…`, `RB29…`; the client's `RB1` strip gets those
wrong); (b) anything in front of a barcode — keyboard text (`Mm`, `I'm`,
`The`), the `]C1` GS1 symbology prefix, stray symbols (`À`, `⁰`, `£`, `@`) —
only if what's left is a 6–16 digit barcode or a `NN-NN-NNN-NN[A-Z]` code;
never if the scan contains `/`. A candidate is kept only if it resolves
through the normal `resolveScan()` chain (incl. UPC-A check-digit
recovery). `product_code` keeps the raw scan; `barcode_no` gets the real
code; RB stickers also get `details.reduced_barcode` (same as RB1).

- **API** (`functions/api/[[route]].js`): `prefixedScanCandidates()` +
  `resolvePrefixedScan()`; the Dept Scan save path (`resolve_barcode`) falls
  back to it on a miss, using the RAW `product_code`. Plain all-digit misses
  cost no extra lookups. `API_REVISION` = `2026-11-09-prefixed-scan-fallback`.
  Unit-tested against a fake DB (both stripping rules, RB tiers, ]C1,
  superscripts, product codes, URLs excluded, label codes stay misses).
- **Live records:** 219 fixed (198 J text-prefixed, 20 J RB stickers, 1
  pending Wrong Price RB sticker); every J got its department; no sticker
  matched two products.
- **Archive (D1):** 578 J rows fixed (572 distinct raw scans, 109 of them
  RB stickers). Done by loading the 572 resolved mappings into a temp table
  `tmp_prefixed_map` (count + checksum verified against Supabase: 572 /
  20573), one `UPDATE … FROM` keyed on the exact raw scan, then dropped.
  Label codes (`B6…`, `K2…`, `PS…`, `NSAD…`, `LAPS…`) all stayed unmatched.
  D1 reads today ≈ 2.1M of 5M (three full scans).
- Still unmatched by design: real non-products (labels, misreads, URLs,
  junk text) — they stay blank.

### 2026-11-09 — Records re-checked against the refreshed master; Phase 6 on hold

**Phase 6 (emails) on hold**: the user is waiting for a Brevo password-reset
email; no Brevo login yet. Nothing else blocked by it.

**Scope (user's ask):** every Department Check plus every pending record,
re-checked against today's product files. Resolution mirrors
`resolveScan()` exactly (barcode_no → 11-digit UPC-A check-digit recovery
→ ean_barcode, `barcode_status`/`item_status` asc, then `prices` for
`item_group`), keyed on `barcode_no`, else `product_code`.

- **Blanks, filled (only where empty):** 3 of 1,307 live blanks could now
  be resolved — 2 Department Checks (7 Nov, both STATIONERY, matched by
  ean_barcode) and 1 Non-Scan (28 Oct, GM FAT SNAX 50 BOX). The rest are
  genuine non-matches (labels, misreads, URLs, letters typed before the
  barcode, RB2–RB9 stickers). Few because the 28 Oct master the stores
  scanned against was complete, just 12 days old (+16 prices, +143 alt
  barcodes since).
- **Product / barcode status, updated to latest (user's follow-up ask):**
  10 records, all `item_status` Inactive → Active (9 J pending, 1 J
  cleared); `barcode_status` already matched everywhere. Verified after:
  226,529 live J + pending records, 0 status / department mismatches, 0
  fillable blanks.
- **Not changed:** product names. The latest file appends " *" to 5,206
  item names (15,411 record diffs are exactly that; ~369 more are " *" plus
  small source edits, incl. doubled apostrophes). The user asked for status
  only; the scan-time names were left.
- **D1 archive:** one scan (708,807 rows read) found 5,277 archived J rows
  missing details over 3,406 codes; the 1,892 that could match by shape
  (digits / `NN-NN-NNN-NN`) were all checked — **none** match today's files.
  Archive statuses were **not** rewritten: every archived J row is from
  29 Oct or earlier, i.e. scanned against a master at most a day old, so
  the outage never touched it; rewriting would replace historical snapshots
  with today's state (and checking 57,265 non-active barcodes against the
  archive needs a server-side job, not this session's tools).
- Not done (still the other session's open question, needs the user's go
  ahead): stripping letters typed before barcodes, RB2–RB9 prefixes.

### 2026-11-09 — Phases 7 + 8 installed on the PC; Phase 6 tooling ready

- `install-scheduled-tasks.ps1` run on the new PC: all six tasks
  registered, upload server answering on `localhost:8765/health`. Phase 9
  check scheduled in this session for 2026-11-10 09:00 UTC (= Irish time):
  reads `sync_runs` for the overnight/morning runs.
- **Phase 6 tooling:** new `scripts/setup-email-configs.py` asks for the
  Brevo login/key (hidden prompt), sender and recipients, tests the Brevo
  login (STARTTLS + LOGIN, no send) before writing, then writes the three
  `*.config.json` into `C:\Homesavers\scripts` (UTF-8 without BOM — a BOM
  makes `json.load` fail). Re-runs keep values on Enter. Defaults: aging
  recipients from §9; area Bcc from the template. **The weekly Department
  Check recipient list was only in the lost config** — the user must give
  it. Tested with scripted answers (first run, keep-on-Enter, bad address,
  failed login writes nothing).
- Installer now also registers the 4 email tasks, each only once its
  config exists: Aging Report Wed 08:00, Department Check Weekly Mon 09:00,
  Dept Check Area Mon 08:00 (`--period full-week`) + Thu 08:00
  (`--period mid-week`), windowless via `pythonw`.
- **08:00 vs 09:00 for the area-manager email settled as 08:00**: the
  emails don't log runs anywhere, and the setup doc's registration commands
  and recorded "next runs" say 08:00; only a comment and a diagram said
  09:00 — both corrected.

### 2026-11-09 — Phases 8 + 7: one installer for every Scheduled Task

User chose the order 8 → 7 → 9 → 6 (automate now, emails once the Brevo
login is found). New `scripts/install-scheduled-tasks.ps1` registers, for
the logged-on user, with times taken from pre-attack `sync_runs`:
CN codes 02:45, Prices 07:00 (08:00 until 24 Oct), Alt barcodes 07:30,
B&M Daily 08:15 (all `run_sync.bat <job>`), Manifest every 30 min
07:05–19:05 (`wscript run-manifest.vbs`; history showed :05/:35 runs), and
the upload server at logon (`pythonw local_upload_server.py`, restarts on
failure, then health-checked on `localhost:8765/health`). All run the
deployed copy in `C:\Homesavers\scripts`.
- **Interactive logon type** ("only when logged on"): B&M drives Excel via
  COM, which fails in a non-interactive session. The `buying 1` user must
  stay logged on (locked is fine). `StartWhenAvailable` + `WakeToRun`.
- Tasks are in the root task folder (creating a folder needs admin).
- Email tasks deliberately not registered yet (Phase 6).
- Not run here (no Windows); reviewed by hand, ASCII-only for PS 5.1.

### 2026-11-09 — Phase 5 complete: every delivery since 28 Oct has a manifest

All 20 HSVMAN files on the SFTP server (29 Oct – 9 Nov) now have manifests
in `...\HSVMAN FILES- MANIFEST\Store Manifest`, every one 100% matched
against the Item Master with no rejections (verified in `sync_runs`):
5, 6 and 9 Nov (13) were built one at a time with `--file` from the share
(~1 min each — the ItemMaster reloads per file); 29 and 30 Oct (7) by the
first SFTP run with `--days 12` (~4 s each, one ItemMaster load). That run
also saved the 7 missing originals to the share; the other 13 were
already there and matched in size. Day-to-day: the plain run (2-day
window) only fetches and builds what's new. Scheduling is Phase 8.

### 2026-11-09 — Manifest job keeps the SFTP originals on the share

At the user's request, every live manifest run now copies the HSVMAN files
it has downloaded from SFTP into
`...\02 - Manifests - Homesavers\HSVMAN FILES- MANIFEST` (UNC first, then
`B:`). Dates kept (`copy2` via `.part` + rename); never overwrites — a
same-name file of a different size is logged and left; `--dry-run` copies
nothing; an unreachable share only warns and the manifests are still
built. Side benefit: that folder is the fallback input
(`SFTP_ENABLED = False`), so it always holds the same files. Tested (fake
SFTP + fake share).

### 2026-11-09 — Manifest input switched to SFTP (login confirmed)

`--sftp-list "Inbound File/Delivery Manifest"` against `192.168.1.77:22`
logged in as `bandm` (host key matched the one pinned on the first
connect) and found 20 HSVMAN files: 29 Oct (4), 30 Oct (3), 5 Nov (5),
6 Nov (5), 9 Nov (3). User confirmed SFTP as the input: `SFTP_ENABLED = True`.
Output unchanged (`...\HSVMAN FILES- MANIFEST\Store Manifest` on the Buying
Data share). If the password file is missing the script now logs a WARN
and reads the share instead of silently switching. Note 29–30 Oct
deliveries also have no manifests (last manifest run was 28 Oct).
`setup-new-pc.ps1` now checks `192.168.1.77:22` for input.

### 2026-11-09 — SFTP server located: 192.168.1.77:22, folder `Inbound File/Delivery Manifest`

Router `192.168.1.254` forwards external 2222 to `192.168.1.77`. From the
new PC (`192.168.1.89`): ping OK, **2222 closed, 22 open** — so the
service listens on 22 internally. User gave the remote folder
`Inbound File\Delivery Manifest`. These are now the defaults in
`manifest-generator.py` (`SFTP_HOST`, `SFTP_PORT`, `SFTP_REMOTE_DIR`);
`SFTP_ENABLED` stays `False` until a `--sftp-list` run confirms login and
files. Input until then: the Buying Data share (previous entry).

### 2026-11-09 — Manifest uses the Buying Data share for now; SFTP on hold

The user put the SFTP route on hold (internal LAN address of the server
still unknown) and gave interim folders. `B:` on the rebuilt PC is the old
`Y:` (`\\192.168.1.205\Buying Data`):
- **Input:** `...\Supply Chain\005 - Reports\04 - H1 Declaration Manifest\02 - Manifests - Homesavers\HSVMAN FILES- MANIFEST`
- **Output:** that folder `\Store Manifest` (subfolder of the input; the
  non-recursive `HSVMAN*.csv` glob never reads it back as input).
- Every folder is tried by UNC first, then by drive letter, so a scheduled
  task with no drive mapped still works. Output picks the first candidate
  whose **parent** exists, so only the final `Store Manifest` folder is ever
  created. U: removed from the script (lost in the attack).
- SFTP code kept but gated by `SFTP_ENABLED = False`; the password file on
  the PC no longer switches it on by itself. `--sftp-list` still works for
  testing.
- `setup-new-pc.ps1` now checks these folders and shows the newest HSVMAN
  file. Runbook §4.3/§4.4 no longer claim the B&M/CN scripts are left out
  of the deploy.
- Tests (fake share + fake SFTP, 10 cases) pass, including: SFTP off reads
  the share, existing manifests skipped, Store Manifest contents not read
  as input, unreachable input/output stop with an error, nothing created
  under a missing parent.

### 2026-11-09 — Delivery manifest input moved from U: to B&M's SFTP

At the user's request `manifest-generator.py` now downloads HSVMAN*.csv
from B&M's SFTP (`93.107.17.189:2222`, user `bandm`) instead of reading
the U: drive. Behaviour otherwise unchanged:
- Downloads into `C:\Homesavers\manifest-inbound`, restoring each file's
  **server mtime**, so the existing `--days` window (default 2) still means
  delivery time. Without that, the first download would have made the
  whole SFTP history look like "today" and rebuilt every old manifest.
- Only files inside the window (or all with `--all`), not already present
  at the same size, and not modified in the last 120 s (still uploading).
  Downloads go to `.part` then rename, so a dropped transfer never leaves
  a half file that `*.csv` would pick up.
- Password in `C:\Homesavers\.manifest-sftp-password` (PC only, never in
  the repo). Host key pinned on first connect
  (`C:\Homesavers\manifest-sftp-known_hosts`); a changed key is refused.
- `--sftp-list` walks the server (3 levels) and reports which folders hold
  HSVMAN files. **`SFTP_REMOTE_DIR` is still empty** — the script refuses
  to run until it's set from that output.
- No password file = old U: behaviour. ItemMaster and output folders also
  fall back to `\\192.168.1.205\Buying Data\...` when Y: isn't mapped (the
  output UNC only if it already exists).
- `setup-new-pc.ps1` installs `paramiko` and checks 93.107.17.189:2222.
- **First check on the new PC: port 2222 NOT reachable** (TCP connect
  fails), so the SFTP route is blocked by the office firewall or by B&M
  allowlisting source IPs; with the user to resolve with B&M / IT. The
  output UNC `\\192.168.1.205\Buying Data\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST`
  was confirmed to exist (Y: isn't mapped on the new PC), so the output side
  works without Y:. Same run showed today's ALT Barcode file (15:57) had
  landed after the 15:48 alt-barcodes upload.
- **Cause found:** the office's own public IP is `93.107.17.189` — the SFTP
  server is the business's own, inside the office, port-forwarded on 2222.
  From inside, the public address doesn't loop back (no NAT hairpin), so the
  PC must use the server's internal LAN address. Not `192.168.1.205`
  (22 and 2222 both refused). U: no longer exists after the attack, so SFTP
  is the only route to the HSVMAN files now. Added `--sftp-host` /
  `--sftp-port` overrides so the internal address can be tested before it's
  made the default.
- Setup script tidied: the "Python launcher" WARN is gone (jobs use
  `python-path.txt`), pip's notices no longer show as red errors.
- Tested in the cloud session against a fake SFTP server (window,
  settle-skip, mtime kept, no re-download, size-change re-download,
  `--all`, main() wiring, U: fallback, missing-dir error). Real login not
  tested — the password stays on the PC.

### 2026-11-09 — Phase 4 complete: CN-code master live again; source-app auth concern

`cn_code_master` reloaded on the rebuilt PC: 43,061 codes (dry run, import
and table all agree; +7 vs 28 Oct). The "cookie" in
`C:\Homesavers\.cn-source-cookie` is the fixed line from
`scripts/README-cn-codes.md` (`admin_authenticated=true; user_email=...`),
not a browser session — the restoration plan was corrected.

**Security concern raised with the user (not this app's code):** the
CN-code source app at `http://86.43.71.253:4000` treats a client-supplied
`admin_authenticated=true` cookie as admin auth, over plain HTTP, on a
public IP. If port 4000 is reachable from outside the office, anyone who
knows that line can export from it or act as admin. Recommended its owner
restrict the port to the office network. Nothing in this repo can fix it.

### 2026-11-09 — Phase 3 complete: the three urgent uploads are live again

Run by hand on the rebuilt PC, each verified in `sync_runs` and the table
itself:

| Upload | File picked | Rows | vs 28 Oct |
|---|---|---|---|
| Item Master (prices) | `ItemMaster_2026_11_09 VRS.xlsx` | 101,980, all refreshed, 0 stale | +16 |
| Alternate barcodes | `ALT Barcode Master_2026_11_05 VRS.xlsx` | 214,746, all refreshed, 0 stale (14,882 skipped, same as before) | +143 |
| B&M Daily | `HomeSavers_20261109.xlsx` | 14,213, 0 skipped | −302 |

Stores scan against current prices again after 12 days on 28 Oct data.
B&M: the dry run at 16:12 saw only the 5 Nov file; today's file landed
before the real run at 16:23, so the B&M export is running. The newest
ALT Barcode file at 15:48 was still 5 Nov — re-run `alt-barcodes` later
(safe, it upserts) and check the file name; if it stays at 5 Nov, the
upstream ALT Barcode export needs checking. Excel COM confirmed working
on the new PC. Not yet automated — Scheduled Tasks are Phase 8.

### 2026-11-09 (Phase 3, first attempt) — jobs couldn't find Python on the rebuilt PC; fixed

First manual `run_sync.bat prices` on the new PC printed `'"py"' is not
recognized` and ran nothing: the wrapper only tried the old PC's per-user
path (`C:\Users\shayas\...\Python313`) then `py`, and the new PC has
neither. `setup-new-pc.ps1` now records the Python it found in
`C:\Homesavers\python-path.txt`; `run_sync.bat` and `run-manifest.vbs`
read that first, then try `%LOCALAPPDATA%`, the old path, `Program Files`,
`py`, `python`. `run_sync.bat` now prints which Python it uses on the
"Starting sync" line. Added `.gitattributes` pinning `*.bat`/`*.cmd` to
CRLF (the repo stored `run_sync.bat` with LF, which cmd can misparse
around labels/`goto`). Baseline before Phase 3: every sync's last good run
was 2026-10-28 (prices 101,964 rows, alt-barcodes 214,603, B&M 14,515,
CN codes 43,054, manifest 1,489).

### 2026-11-09 (Phase 1 started) — `setup-new-pc.ps1`; deploy now ships the B&M/CN scripts; Excel prerequisite corrected

- **New `scripts/setup-new-pc.ps1`** automates Phase 1 of the restoration
  plan on the rebuilt PC: installs Python 3.13 + `requests`/`pandas`/
  `openpyxl` if missing (winget), checks Excel, creates `C:\Homesavers\*`,
  pings the website, opens the three critical source folders on
  `\\192.168.1.205\Buying Data` and reports the newest file in each (so a
  stalled upstream export shows up immediately), checks U:/Y:/the CN-code
  app for later phases, runs `deploy-scripts.ps1`, and ends with a
  PASS/WARN/FAIL table. Not executed here — written and reviewed in the
  cloud session; first real run is on the new PC.
- **`deploy-scripts.ps1` now copies `sync-bm-daily.ps1` and
  `sync-cn-codes.ps1`.** They were deliberately excluded before ("edited in
  place in `C:\Homesavers\scripts`"), so on the wiped PC `run_sync.bat
  bm-daily` would have failed with file-not-found. Risk to note: the lost
  deployed copies may have had local edits never committed; the repo
  copies (last changed in the 2026-10-05 history) are now the only source.
  If B&M/CN behave differently than before, that's the first suspect.
- **Prerequisite corrected:** B&M Daily needs **Microsoft Excel** installed
  (`Excel.Application` COM), not the `ImportExcel` module the runbook
  claimed; that module is only used by the legacy `.ps1` syncs. Fixed in
  `docs/local-pc-rebuild-runbook.md` and the restoration plan.
- Source folders (from `app_settings` / the B&M script): Item Master
  `...\VRSDAILYDATADUMP\ProductMaster\2026`, Alt-barcodes
  `...\VRSDAILYDATADUMP\ProductMaster-ALTBarcode\2026`, B&M
  `...\B&M Product File Excel\2026`, all under
  `\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data`.
  Manifest needs `U:` (Finance shared folder, input) and `Y:` (output).
- Repo now cloned on the new PC at `C:\Apps\HomesaversScanner` (was
  `C:\Scraping\homesavers-scanner`).

### 2026-11-09 (later) — Restoration plan restructured: Item Master, Alt-barcodes, B&M Daily grouped as the urgent manual push

Restructured `docs/post-wipe-restoration-plan.md` per the user's own
priority call: the manual push of Item Master (prices), the Alternate
Barcode file, and the B&M Daily file matters more than anything else in
the plan, since those three are the only ones that feed what staff
actually see when scanning. They're now one single phase (Phase 3),
done by hand as soon as the one secret they share
(`PRODUCT_SYNC_SECRET`) is back in place — explicitly not gated on
rebuilding any Scheduled Tasks first. CN-code sync, the delivery
manifest, the report emails, and the upload server moved to their own
later phases; recreating every Scheduled Task across all jobs is now
consolidated into a single phase at the end, once each job has run
clean by hand at least once.

### 2026-11-09 — Confirmed Qilin ransomware; PC wiped and reinstalled; phased restoration plan written

The local PC incident from 2026-10-30 is now confirmed as a Qilin
ransomware attack, and the machine has been **formatted and reinstalled**
rather than cleaned in place — it's a brand-new, empty Windows install with
no codebase, no Scheduled Tasks, no Windows services, no local secret
files. The live app, Supabase, and Cloudflare were never affected and have
kept working throughout; only what used to run from that PC (5 data syncs,
3 report emails, the local upload server, the delivery manifest) needs
rebuilding. Wrote `docs/post-wipe-restoration-plan.md` — a phased,
dependency-ordered plan (baseline the new PC → secrets → highest-impact
syncs first → the rest → scheduled tasks → verify) that builds on the two
docs already written during the original incident rather than repeating
them. Also updated the SECURITY NOTICE above: secret rotation, previously
on hold, is now happening as part of the rebuild (every local secret has
to be re-entered from scratch anyway), and pushing from that PC is fine
again once it's rebuilt, since it's a clean machine now.

### 2026-11-02 — Website disaster-recovery guide

Added `docs/website-disaster-recovery-guide.md` — distinct from the
local-PC runbook above, this covers the actual website/database/hosting,
not the PC's background jobs. It identifies the 4 accounts the whole
system is built on (GitHub, Cloudflare, Supabase, Brevo), gives step-by-step
rebuild instructions for each from nothing, inventories every secret by
name and *location only* (no values written down anywhere, in GitHub or
otherwise — consistent with the no-rotation decision in the SECURITY
NOTICE above), and ends with a short "do this today while access still
works" checklist. Also sent directly to the user as a standalone file so
a copy exists outside GitHub too. Nothing here is urgent — the live site,
Supabase and Cloudflare remain completely unaffected by the PC incident;
this is a just-in-case plan only.

### 2026-10-30 — Local-PC rebuild runbook written to the repo

Added `docs/local-pc-rebuild-runbook.md` — a full write-up of every process
that currently depends on the ransomware-hit local PC, so it can be rebuilt
from the GitHub codebase alone once that machine is cleared. Covers: the 5
data syncs (prices, alt-barcodes, B&M daily file, CN-code master, delivery
manifest) with source/destination/schedule/script for each; the 3 scheduled
report emails; the local upload server; which secrets/config files live only
on that PC (and a reminder these are NOT being rotated now, per the security
notice below); software prerequisites; and which parts of the system
(live site, archiver Worker, Supabase/D1 data) do **not** depend on the PC at
all and kept running throughout. Also flags two existing documentation
inconsistencies found while researching this (not fixed, since they're
local-PC config, not live code): the area-manager email's documented time
(08:00 vs 09:00 in two different setup docs), and the aging-report task
pointing at the git working tree instead of the deployed scripts copy like
every other job.

### 2026-10-30 — Local PC ransomware attack: no pushes from that machine, no secret rotation, live app unaffected

See the SECURITY NOTICE callout at the top of this file for the full detail
— logged here too for the dated history. The local dev box
(`C:\Scraping\homesavers-scanner`) was hit by ransomware and is not yet
cleared. Per the business's explicit instruction: no pushes/deploys from
that PC until it's confirmed clean, and secret rotation is deliberately not
happening right now (not an oversight — don't re-raise it unprompted).
Confirmed the live app, Supabase, and D1 are all cloud-hosted and completely
unaffected — the incident only touches that one local machine and the
Windows-scheduled jobs that ran from it.

Also discovered while responding: this cloud session's long-running working
branch had an unrelated git history from current `main` (different root
commit entirely). Verified it was a history-only divergence, not a
content-loss one — every prior feature was independently confirmed present
in `main`'s actual files — then restarted the branch from `main` rather
than forcing a merge. See the SECURITY NOTICE callout for what to do if
this recurs.

### 2026-10-28 — Morning product sync emptied the master; syncs no longer truncate

**What happened.** Both morning syncs lost their connection part-way through:
prices at 07:03 (chunk 5 of 51) and barcodes at 07:32 (chunk 15 of 108), each a
single `ConnectionResetError 10054` on the HO PC's upload. Each script emptied
its table first (`/sync/reset`) and never retried, so until the re-run stores
scanned against 8,000 of 101,964 prices and 27,981 of 214,603 barcodes.
Department Check saved 74% of scans with no department (normally ~1%) in every
store that was scanning; the HO task forms and Product Master were hit too.

**Recovery.** Both re-run with retries and no reset: prices complete at 09:56,
barcodes at 10:18. The uplink was still dropping, so a plain re-run had already
failed again at chunk 18. Prices needed 10 retries and barcodes 37, mostly
stalled uploads (`The write operation timed out`). The 1,151 Department Check
records saved 07:02–10:18 with no department, plus one Non-Scan and one Wrong
Description from Limerick, were then re-resolved against the restored master.
The resolution matched `resolveScan()` and filled empty fields only. 37
barcodes that are genuinely not in the master were left as they were.

**The fix** (`scripts/sync-prices.py`, `scripts/sync-alt-barcodes.py`, copied
to `C:\Homesavers\scripts`):
- `http()` wraps every request and retries dropped connections, timeouts and
  429/5xx with backoff (~3.7 min per request). A 4xx is not retried. Every call
  is idempotent: chunks are upserts, the flush deletes by a fixed cutoff.
- No table reset. Chunks upsert over the existing rows (both endpoints stamp
  `updated_at`), then `flush-stale` deletes rows older than the run's start,
  and only after every chunk has landed. A failed run now leaves yesterday's
  complete data instead of a part-empty table.
- Chunk timeout `(15, 120)` instead of 300 s, so a stalled upload is retried
  rather than waited on.
- Cost: re-writing the whole master leaves a day's dead row versions for
  autovacuum, which cleaned prices within a minute of today's load. The
  database is at 285 MB of 500 MB after recovery.

Tested before deploying with a fake-server dry run of both `main()`s: no reset
call, dropped chunks retried, flush after the last chunk, run recorded OK. The
`/sync/reset` endpoints are now unused and left in place.

**Not fixed:** why this PC's upload keeps stalling (office network/firewall).
The retries absorb it, but the syncs will keep taking longer while it lasts.

### 2026-09-30 — Department breakdown bars added to the store Dashboard

Requested: show the same "Department Check records by department" bars on a
store login's own Dashboard as the back-office one, minus the store name
(there's only one), positioned before Recent activity.

**Backend gap found first:** `GET /reports/dept-check-week` was gated
`isBackOffice(callerSession)` only — a store session got a flat 403. Relaxed
to any authenticated session (`!callerSession` instead), which is safe
without further changes: `scopedStoreIds()` inside the same handler already
restricts a non-admin/non-all_stores session to its own `store_ids` — the
identical mechanism every other store-scoped endpoint in this API already
relies on. A store login now gets back exactly one row (its own store);
back-office callers and the Monday email's secret-authed chain-wide call are
unaffected.

**Frontend:** `Dashboard.jsx`'s `getDeptCheckWeek` fetch was gated `if
(isBO)` — removed the gate so it fires for both roles (still one shared
`deptSummary`/`deptLoading` state). New `MyDeptBreakdown` component (right
after `DeptCheckByStore`, sharing its `DEPT_HUES_LIGHT/DARK`/`DEPT_OTHER`
palette constants and the same "Inactive Products" merge logic) renders
`summary.stores[0]` — exactly one row, so no store-name label and no
"busiest store" bar-length comparison (that comparison only means something
across multiple stores); the bar is always full width, showing the
department split within that store's own records. Rendered
`{!isBO && <MyDeptBreakdown .../>}` directly above `RecentList`, as asked.

### 2026-09-30 — Charleville duplicate-scan report: confirmed real, root-caused, fixed

Charleville reported: scan product 1, product 2, product 3, then re-scan
product 1 — not flagged as a duplicate, despite the session-wide "catch
same-session duplicate scans" guard (`753c78d`) shipping two days earlier.

Checked whether this was still actually happening, chain-wide, rather than
trusting the earlier fix was sufficient: grouped `task_records` by
`(store_id, barcode_no)` and looked for genuine repeat SAVES (not just
repeat scans — actual second rows in the table) seconds to minutes apart.
Found real pairs on both 2026-09-29 and 2026-09-30 (chain-wide, not
Charleville-specific) — confirming the guard still has a live gap, not
just a stale-bundle artifact from deploy day. (Charleville's own specific
incident traced to 2026-09-28, right around when `753c78d` deployed — most
likely their gun's browser tab was already open and hadn't picked up the
new bundle yet, consistent with zero further Charleville duplicates found
on 9-29 or 9-30.)

**Root cause of the still-live gap:** `seenRef.current.add(resolveCode)`
only ran AFTER a scan's save request resolved successfully — not when the
scan was taken. On real-world shop wifi (or simply a fast operator), a
repeat scan of the same barcode could land before the first scan's request
had round-tripped, so `seenRef` didn't have it yet and the repeat saved as
a genuine second record. The existing 3-second `lastCodeRef` echo guard
didn't help: it's a value+time window that expires on its own clock,
unrelated to whether the underlying request is still in flight past 3s.

**Fix**, `DeptScan.jsx`: `seenRef.current.add(resolveCode)` now fires
BEFORE the request goes out, not after it resolves — a repeat is caught
the instant it's scanned, independent of how long the first save takes.
Reversed only on a genuine failure (never on success) via a new
`seenRef.current.delete(resolveCode)`, gated by the same generation guard
already used for `lastCodeRef`/`lastAtRef`, so a real network failure
doesn't permanently block a legitimate retry of that barcode for the rest
of the session.

**Also fixed while touching this:** `undoLast()` cleared `seenRef` using
`target.barcode` (the raw scan), but `seenRef` is keyed by `resolveCode`
(the RB1-prefix-stripped code) — undoing a reduced-sticker scan silently
failed to free its `seenRef` entry. Rows now carry `resolveCode` so undo
references the same key that was actually set.

**Explicitly NOT fixed, and flagged rather than silently left:** `seenRef`
is a per-browser-tab, per-session `Set`, by original design (documented in
its own code comment) — it resets on page reload and never reaches across
two different devices/guns at the same store. If a specific incident
involved a reload mid-check, or two guns scanning the same product, no
amount of client-side session tracking catches that; it would need either
a persisted seen-set (its own staleness questions) or a server-side check.
Told the user this is a real, separate, larger design question rather than
folding a guess about it into this fix.

### 2026-09-30 — Why the DB doubled, root cause on the "no status is being excluded" report, and device_log_events moved to D1

Follow-up to the D1 capacity meter (below): once it started reporting, the
user asked why Supabase was at 64% (335 MB) despite the app only holding
"a few weeks" of live data. Investigated directly rather than guessing.

**Per-table breakdown** (`pg_stat_user_tables`): `task_records` 123 MB
(232,675 rows), `alt_barcodes` 74 MB (master catalog), `task_record_events`
50 MB (audit trail, ~1.06 events/record), `device_log_events` 19 MB
(40,575 rows — the scan-doctor log, only 2 days old), `prices` 17 MB
(master data), `store_task_instances` 15 MB (unbounded since May, no
purge).

**Real driver of the doubling:** daily Task J volume from `task_stats_daily`
went from ~5,000–9,000/day in late August to ~15,000–33,600/day by late
September — roughly 2–3x. `scan_record_retention_days` (14) is a fixed
*number of days*, not a fixed *row count*, so the same window now holds
2–3x more rows purely from higher store usage, not from anything
misconfigured.

**Second question: why do ~25,000+ Department Check records past 14 days
stay `pending` instead of moving to D1 regardless of status?** Checked the
live `purge_old_task_records()` function directly
(`pg_get_functiondef`) — it already has **no status filter at all**:
`DELETE FROM task_records WHERE created_at < v_cutoff AND d1_copied_at IS
NOT NULL`. The rule the user wants (any status, 14 days) is exactly what's
deployed. The actual blocker: `SELECT count(*) FROM task_records WHERE
d1_copied_at IS NOT NULL` returns **0** — across the table's entire
history, not one row has ever been confirmed archived. The separate
`homesavers-archiver` Cloudflare Worker (`workers/archiver/`, its own
`wrangler deploy` + secrets, cron `30 1 * * *` / `45 1 * * *`) that's
supposed to copy aging records into D1 and stamp `d1_copied_at` appears to
have never completed a successful run. This cloud session cannot check or
deploy a separate Worker (no access to its Cloudflare secrets or deploy
target) — told the user to check `SELECT * FROM archive_runs ORDER BY
started_at_ms DESC LIMIT 20;` in the D1 Console (Cloudflare dashboard →
Workers & Pages → D1 → homesavers-archive → Console) to see whether it's
never run (no rows) or failing with a specific error (rows with `error`
populated), and to check whether `homesavers-archiver` is even listed
under Workers & Pages at all.

**Shipped:** moved `device_log_events` to D1 (see the entry below this one)
— the one table in the breakdown that's write-only from the app's side and
therefore the safe one to move without touching store-facing speed or
Cloudflare request counts. `alt_barcodes`/`prices` (read on every scan) and
`store_task_instances`/`task_record_events` (read live by store/back-office
staff) were explicitly NOT recommended for the same move.

### 2026-09-30 — device_log_events moved from Supabase to D1

Confirmed before moving: `device_log_events` is write-only from the app's
side — grepped `functions/api/[[route]].js` for every reference and found
exactly one, the `POST /device-log` insert; nothing ever reads it back (the
Sync page's "Activity on this device" panel reads `localStorage` directly,
never this table). That shape — high write volume, essentially never read,
never joined against anything else — is what made it safe to move, unlike
`alt_barcodes`/`prices` (read on every single scan) or `task_records`
itself (read and written constantly by both stores and back office).

`POST /device-log` now writes to D1 (`env.ARCHIVE`, the same database the
Department Check archive already lives in) via a `prepare()`/`batch()`
insert, instead of `db.insert('device_log_events', ...)` against Supabase.
Costs the store's device **zero** extra requests — the browser makes the
exact same single POST either way; only which backend that route writes to
changed. New `d1-migration-device-log.sql` creates the table in D1,
mirroring the original Supabase schema's three indexes (device+time,
type+time, store+time) but epoch-ms integers for the time columns, matching
`task_record_archive`'s existing convention (D1 bills rows scanned, so an
integer range comparison over a physically-ordered column is what protects
the free-tier read limit).

**Not done, needs a manual step:** applying the new D1 schema. This session
has no `wrangler` CLI access to the live D1 database. Whoever has that
access needs to run, from the repo root (or wherever the `ARCHIVE` binding
is configured):
```
npx wrangler d1 execute homesavers-archive --remote --file=d1-migration-device-log.sql
```
before this code path will actually succeed — until then, `POST
/device-log` will fail closed (best-effort, so it logs a warning and
returns `{ok:false, inserted:0}` rather than erroring the whole request,
exactly as the old Supabase path did on any insert failure).

**Also not done:** dropping/truncating the ~40,000 rows (~19 MB) already
sitting in Supabase's `device_log_events` table from before this moved.
Left in place since it's a separate, explicit decision (real 2-day
diagnostic history) — this change only stops it from growing further.

### 2026-09-29 — D1 archive capacity meter added below the Supabase database bar

The Department Check archive (Cloudflare D1, `homesavers-archive`,
`database_id: 6c728765-d614-4282-a648-4b3fc3bf78fe`, bound as `env.ARCHIVE`)
has always had its own free-tier ceiling (5 GB/database) that Admin →
Settings never surfaced — the existing Capacity card only ever queried
Supabase's own RPC.

**Root fact that shapes the implementation:** a D1 binding gives the
Worker query access (`.prepare()`/`.batch()`/`.exec()`) only — it has no
method that reports its own id or size. Reading usage back means calling
Cloudflare's own management API (`GET /accounts/{account}/d1/database/{id}`,
which returns `file_size` in bytes and `num_tables` — confirmed against
Cloudflare's current API docs, not assumed) for this specific database by
id, using the same `CLOUDFLARE_API_TOKEN` already configured for the
Cloudflare-requests chart on the same page. The id itself is duplicated
into a new `D1_ARCHIVE_DATABASE_ID` var in `wrangler.toml` (same UUID as
the `[[d1_databases]]` binding — not a secret, already public in that same
file) since there's no way to read it off the binding at runtime.

**Shipped:**
- `GET /admin/capacity` now also returns a `d1: { used_bytes, limit_bytes,
  num_tables }` block, fetched best-effort — a missing token/id or an API
  error drops only this field (`d1: null`), never breaks the Supabase
  numbers the endpoint already serves.
- New `capacity_d1_limit_bytes` app_setting (Capacity section, MB input
  like the two existing ones), default 5 GB — Cloudflare D1's free-tier
  per-database cap, verified via web search since guessing this number
  wrong would misreport the meter's percentage.
- Settings page: card renamed "Supabase capacity" → "Database capacity"
  (it now covers two systems, not one), its two meters renamed "Supabase
  database"/"Supabase storage" for clarity, and the new "D1 archive
  (Department Check)" meter placed directly below the Supabase database
  bar — exactly where asked. Shows an explicit "D1 archive usage
  unavailable" note rather than a misleading 0% when the token/id aren't
  configured or the token lacks D1 read scope.

**Not verified live:** whether the existing `CLOUDFLARE_API_TOKEN` secret
actually carries D1 read permission — that scope may not have been granted
when the token was first created for the Analytics GraphQL API, which is a
different permission. If the Settings page shows "D1 archive usage
unavailable" after this deploys, the fix is adding **Account → D1 → Read**
to that token's permissions in the Cloudflare dashboard, not code.

### 2026-09-28 — Fourth rejection class: implausibly long scans — cap corrected from 15 to 16 after checking live data

Asked for as "block anything over 15 digits" (the business's estimate of a
max outer-box barcode length). Checked the actual master data before
implementing, since a wrong cap here would silently start rejecting real
products rather than only junk:

```sql
select length(barcode_no), count(*), count(*) filter (where item_status='Active' and barcode_status='Active')
from alt_barcodes where barcode_no ~ '^[0-9]+$' and length(barcode_no) >= 15
group by 1;
-- 15 digits: 19 rows, 13 currently Active
-- 16 digits:  5 rows,  3 currently Active (STACIE DOLL, COLOUR CHANGE MERMAID, B&D HAMMER DRILL 18V)
-- nothing anywhere in alt_barcodes exceeds 16 digits
```

**15 would have been wrong** — three real, currently-sellable products use
16-digit barcodes right now. Shipped the cap at 16 instead:
`hasTooManyDigits()` in `DeptScan.jsx` counts digit CHARACTERS (not raw
string length, so a dash-grouped `ean_barcode` or an `RB1` reduced-sticker
code — both short on real digits despite dashes/letters — is never caught
by it) and rejects anything with more than 16. Same treatment as the other
three invalid-scan reasons (`url`, `sticker`, `no-digit`): red banner,
distinct tone, nothing saved, logged as `scan-invalid-too-long`.

### 2026-09-28 — Dept Scan also rejects scans with no digit at all

Third rejection class alongside URLs and known sticker codes: 73 of the
1,279-code "Inactive Products" audit were letters-only garbled reads
(`MAENCHNA`, `PLANBSUS`, `CHARCOAL`, ...). Every real code this business
scans — `barcode_no`, `ean_barcode`, and the `RB1` reduced-sticker
format — is at least partly numeric, so anything with zero digits can be
rejected outright with the same confidence as a known sticker code.

`hasNoDigit()` added to `DeptScan.jsx`'s existing invalid-scan check
(alongside `isUrlCode()` and `KNOWN_STICKER_CODES`) — same red banner,
distinct tone, nothing saved, logged as `scan-invalid-no-digit`. Pulled the
banner text into a shared `invalidReasonText()` helper now that there are
three reasons sharing identical on-screen behaviour, so the message copy
lives in one place instead of being duplicated across the live banner and
the history table.

### 2026-09-28 — RB1 prefix correction, and why "scan the full barcode only" isn't safe to enforce

Two quick follow-ups.

**Prefix fix:** the business corrected the reduced-barcode prefix to "RB1"
(3 chars), not "RB". `REDUCED_PREFIX` in `DeptScan.jsx` now strips `RB1`,
so `RB101-09-188-00` resolves to `01-09-188-00` — the correct 2-2-3-2
dash-grouped shape `prices`/`alt_barcodes.ean_barcode` actually use.
Stripping only "RB" (the earlier version) left a 3-2-3-2 code
(`101-09-188-00`) that would never have matched anything.

**Asked: can Dept Scan reject anything that isn't a "full" barcode, to stop
the truncated/partial-scan class of "Inactive Products" records?** Checked
before building anything, since a wrong guess here would actively block
real scans. Queried every Task J record that already resolved successfully
against master data, grouped by the length of its (purely numeric)
`barcode_no`:

| Length | Live, correctly-matched records |
|---|---|
| 6 | 246 |
| 7 | 2 |
| 8 | 1,655 |
| 11 | 22 |
| 12 | 9,224 |
| 13 | 212,817 |
| 14 | 165 |

The 6-digit group turned out to be real, named products (PET FOOD lines
like "MINI MARBONE W BEEF 150G", "FAVOUR BEEF EARS" — genuine short
internal SKU-style barcodes for that supplier), and the 11-digit group is
the already-handled trimmed-UPC-A case. So valid barcode length in this
business's actual data ranges from 6 to 14 digits — there is no length
threshold that would catch only partial scans without also rejecting
hundreds of already-working, correctly-categorised Pet Food scans a day.
**Concluded this isn't safe to build and left it alone**, per the request
("leave it if it is not possible") — the existing signal (a scan that
doesn't resolve against master data lands in Inactive Products) remains
the only reliable way to spot a truncated read, same as before.

### 2026-09-28 — URLs rejected, "RB" reduced-barcode stickers resolved, and the double/triple-scan root cause confirmed

Three follow-up asks after the sticker-code fix above.

**1. Reject scanned URLs.** Same shape as the sticker-code fix: 141 of the
1,279-code "Inactive Products" export were QR codes (manufacturer pages,
recycling info) rather than the product's barcode. `DeptScan.jsx` now
detects `^https?://` and rejects before `createTaskRecord`, same red-banner
treatment as a known sticker code, logged as `scan-invalid-url`.

**2. "RB" reduced-barcode stickers.** Confirmed by the business: a code
like `RB101-09-188-00` is a reduced/clearance sticker printed separately
from the product's normal barcode — the part after "RB" (`101-09-188-00`)
is the product's real code, in the same dash-grouped format
`prices`/`alt_barcodes.ean_barcode` already use for shelf-ticket-only
items. `DeptScan.jsx` now strips the "RB" prefix before lookup, dedup
(`lastCodeRef`/`seenRef`), and the saved `barcode_no` — so a reduced
sticker scan resolves and counts as the same product its normal barcode
would. The untouched original is kept in `details.reduced_barcode` (the
backend's existing `fmtDetails()` renders it automatically as "Reduced
Barcode: RB101-09-188-00" with no report changes needed) and shown
on-screen as a blue "+RB" tag next to the resolved code.

**3. "Double/triple scanned" — confirmed and already improving.** User
asked whether some of what's being seen predates "the new department scan."
Checked live data rather than guessing: grouped `task_records` by
(`store_id`, `barcode_no`) and looked at repeat scans of the same barcode
at the same store within a 10-minute window — 12,145 such repeat pairs over
the live 3-week window, the overwhelming majority (>99%) spaced MORE than
3 seconds apart (i.e. not a double trigger-pull, which the pre-existing
`DUP_WINDOW_MS` guard already caught). That gap — walk the aisle, scan A,
scan B, come back and scan A again — is exactly what the OTHER session's
`753c78d` commit ("Dept Scan: fix Undo for store staff, and catch
same-session duplicate scans", deployed ~15:05 UTC today) added
session-wide duplicate detection for. Bucketing repeats by hour shows the
effect immediately: 191 (14:00 UTC) → 200 (15:00, deploy lands mid-hour) →
54 (16:00) → 13 (17:00). **Confirmed: this was a real, pre-existing gap,
and it has already dropped ~90%+ since today's fix**, with the residual
likely devices that haven't reloaded to pick up the new bundle yet.

Checked "half scanned" (truncated/partial barcode reads) as a separate
question, since it sounds similar but isn't the same mechanism: counted
Task J barcodes that are purely numeric but the wrong length for a real
barcode (not 8/12/13/14 digits) per hour, before and after the same deploy.
**This one did NOT drop** — it tracks total scan volume both before and
after (roughly 0.5–2% of scans throughout), so it is a separate, still-live
issue — almost certainly a scanning/hardware phenomenon (a gun capturing
only part of a barcode on a fast pass), not something today's dedup fix
touches. No device-level breakdown is possible for it retroactively (the
`device_log_events` "scan doctor" system only started collecting today);
worth watching there going forward if it keeps recurring at a particular
store.

### 2026-09-28 — Dept Scan warns on known sticker codes (80575540 / 80025750)

Follow-up to a barcode-frequency export requested off the "Inactive
Products" bucket: 1,279 distinct codes with no match anywhere in
`alt_barcodes`/`prices`, classified by shape (URL/QR, wrong-length numeric,
letters-only, valid-length numeric) and exported as a CSV sorted by scan
frequency. The top two entries stood out — `80575540` (101 scans across 29
stores) and `80025750` (15 scans across 13 stores) — consistent enough
across that many stores to rule out a bad read. The business confirmed:
these are generic sticker codes physically printed on many products'
price/shelf tickets, not that product's own barcode, so neither will ever
resolve against master data — there is no single real product to attach
either code to.

**Shipped in `DeptScan.jsx`:** a `KNOWN_STICKER_CODES` set (currently just
these two) checked in `handleConfirm` before the duplicate guards and
before `createTaskRecord` is ever called — nothing is saved for either
code. The operator gets:
- a distinct red banner + table row: "Not a real barcode — scan the
  product's own barcode instead"
- a tone/vibration pattern unlike Saved/Queued/Duplicate/Failed
  (`soundInvalid`)
- a new `device_log_events` event type, `scan-invalid-sticker`, so future
  frequency of this is a query away instead of only surfacing after the
  fact in a report

Checked ahead of the dup-window and session-seen guards specifically so a
repeat scan of either sticker code keeps saying "not a real barcode" rather
than degrading to "duplicate" on the second scan. Stops these two codes
from adding any more noise to the Inactive Products bucket going forward;
does not touch the 1,816 already-live records carrying them (a cosmetic
label issue with no downstream harm, not worth a backfill).

### 2026-09-28 — "No department" + "Other" renamed to "Inactive Products" (Dashboard + email)

Follow-up to the entry directly below: after the "Other department"
investigation confirmed both buckets are legitimate (no missing/hidden
department, just a report-time visual grouping), the user asked to rename
both to "Inactive Products" in the Dashboard and the weekly email.

Implemented as a genuine MERGE, not two separate relabels: keeping "No
department" and "Other" as two swatches with different colours but the
identical new caption would read as a UI bug, not a design choice. So both
now share one colour and one legend line in each place:

- `client/src/pages/Dashboard.jsx` (`DeptCheckByStore`): removed
  `DEPT_NONE`; `colorOf()` now maps both `'(none)'` and anything outside the
  top-8 ranked departments to the single `DEPT_OTHER` colour (renamed
  `INACTIVE` locally). Legend collapsed to one "Inactive Products" entry
  (`inactiveTotal` replaces the old separate `otherTotal`/`noneTotal`). New
  `deptLabel()` helper also relabels the literal `'(none)'` string to
  "Inactive Products" in the per-store department-breakdown text and bar
  tooltips — real department names (the ones just outside the top 8) still
  show their own name there, only the true "unattributed" ones change.
- `scripts/dept-check-weekly.py`: same shape — removed `DEPT_NONE`, added a
  `dept_label()` helper, `dept_palette()` now maps `"(none)"` to
  `DEPT_OTHER`, and `legend()` sums both into one "Inactive Products" row.

**Display-only change, confirmed again for the record:** this does not
reclassify any data. The former "Other" bucket still contains real,
correctly-categorised departments (PET FOOD, STATIONERY, GARDENING, etc. —
whatever falls outside the chain-wide top 8 that week) sitting under a new
label; nothing in the underlying `task_records`/`prices` data changed.

### 2026-09-28 — "Other department" turned out to be a fresh batch of "No Department"; server-side safety net added

User reported seeing an "Other" department in the Alt Barcode file and asked
to backfill/fix it. Investigated directly in Supabase rather than guessing:

- `alt_barcodes` has **no department column at all** — confirmed via schema
  inspection. Department has only ever come from the separate `prices`
  (Item Master) table, keyed by `ean_barcode`.
- `prices.item_group` currently holds **30 distinct real department names**
  (TOYS, HOMEWARES, GIFTWARES, FOOD, HEALTH & BEAUTY, ... down to GIFT
  VOUCHERS) — **none of them is literally "Other"**. So there is no hidden
  "Other" department being dropped or mis-synced anywhere in the pipeline.
- **Conclusion:** the grey "Other" swatch in the Dashboard card and weekly
  email is exactly what its own code comment says — a report-time visual
  fold for departments outside the chain-wide top 8 (`DEPT_OTHER` in both
  `Dashboard.jsx` and `dept-check-weekly.py`). Every record inside it
  already has a correct, real, named department; it's just visually grouped
  rather than bugged. Told the user this plainly rather than "fixing"
  something that wasn't broken.

**What WAS actually broken, found while checking:** a fresh batch of
genuine "No Department" (`item_group` null) Task J records, distinct from
the batch backfilled earlier the same day. 3,311 live records had none;
1,499 of them resolved cleanly against CURRENT master data with a plain,
direct `barcode_no` match — no ean-fallback needed, no stale price data
(the matching `prices` rows were all last updated at 07:01–07:02 that
morning, hours before the affected scans happened at 07:47–15:31). So this
wasn't the ean_barcode-matching gap fixed earlier, and it wasn't stale
data — the master data was already correct and available well before the
scan.

**Root cause:** `DeptScan.jsx`'s client-side department lookup
(`scanLookup`, called before `createTaskRecord`) is bounded to a 10s
timeout (`LOOKUP_TIMEOUT_MS`). A shop-wifi hiccup that delays just that one
call — independent of whether the record itself then saves successfully —
permanently bakes `item_group: null` into the record, because the lookup
result and the save are computed once and never retried. The offline
outbox has the identical exposure: a queued record's `details.item_group`
is fixed at scan time and never re-resolved when it syncs later.

**Fix shipped**, `functions/api/[[route]].js` `POST /task-records`: when a
Task J record arrives with no `item_group`, the server now re-resolves it
itself (`barcode_no` → `alt_barcodes`, falling back to `ean_barcode`, → 
`prices.item_group`) before insert — the server's own Supabase connection
doesn't share shop wifi's timeout failure mode. Applies uniformly to live
saves and to outbox-replayed records, since both POST through this same
endpoint. Only runs for the minority of Task J saves that arrive without a
department already resolved client-side, so it adds no meaningful load to
the common case.

**Backfilled** 1,499 of the 3,311 live "No Department" Task J records using
the same join, touching only previously-empty fields (`item_group`,
`item_name`, `product_barcode`, `supl_id`, `supplier_code`, `item_status`,
`barcode_status`) — mirrors the conservative approach of the earlier
backfill. Live count dropped from 3,311 to 1,812; the remainder have no
match anywhere in current master data (unlisted barcodes / junk scans) and
are genuinely unresolvable, same as before.

### 2026-09-28 — Deployment of the weekly-email fix hands off to the LOCAL Claude Code session

Follow-up to the entry directly below. This cloud session merged the fix to
`main` (`846e42a`), but a screenshot the user then sent back still showed
the old 2-department-cap behaviour — because deploying `dept-check-weekly.py`
means getting it onto the Windows machine that actually runs the Monday
Task Scheduler job, and this cloud sandbox has no network path to that
machine (no VPN/RDP/SSH — it's not a permissions setting, there is
genuinely no route from here to there).

**Resolution:** the user runs a SEPARATE local Claude Code session on that
same Windows machine, working out of `C:\Scraping\homesavers-scanner` (the
path already documented at the top of this file under "Local"). That local
session has the filesystem/git/PowerShell/Python access this cloud one
lacks. Handoff instructions given to the user, to paste into that local
session:

1. `git pull origin main` in `C:\Scraping\homesavers-scanner`
2. `.\scripts\deploy-scripts.ps1` — copies the updated files (including
   `dept-check-weekly.py`) into `C:\Homesavers\scripts`
3. `cd C:\Homesavers\scripts` then
   `python dept-check-weekly.py --to <their email>` — a one-off test send
   that does NOT touch the configured recipients list in
   `dept-check-weekly.config.json` (see the flag's logic in the entry below)

**Takeaway for future sessions:** this repo is worked from (at least) two
Claude Code sessions — this cloud one (no access to `C:\Homesavers\...` or
any local Windows path, cannot run anything that touches SMTP/Task
Scheduler/local file paths) and a local one on the user's own machine at
`C:\Scraping\homesavers-scanner` (which does). Anything that requires
actually *running* `scripts/*.py` against real credentials, or touching
`C:\Homesavers\...`, has to be hedged to the local session — this cloud
session can only edit code, commit, push, and merge to `main`.

### 2026-09-28 (latest) — Weekly Department Check email: same department-cap fix, greeting/sign-off

The department-count screenshot that kicked off the dashboard fix earlier
this session (see the entry below) turned out to be from the **weekly
email attachment**, not the live dashboard — the dashboard fix landed
anyway and the user confirmed it's fine as-is, but the email itself still
had the original bug.

**What shipped**, all in `scripts/dept-check-weekly.py` (`build_html()` /
`count_row()`):
- Removed the `[:2]` cap on the per-store department list (`lead = sorted(bd.items(), key=lambda kv: -kv[1])`,
  no longer sliced) — every department a store scanned now appears under its
  bar, not just the two biggest. Mirrors the `DeptCheckByStore` fix in
  `client/src/pages/Dashboard.jsx`.
- Added a "Hi All," opening line right under the masthead, and a
  "Regards,<br>Homesavers Scanner" sign-off just before the closing tags.
- Updated the card-2 explainer text ("...every department is named under
  each bar" instead of "the two biggest").

**Not done, and cannot be done from this session:** actually sending a test
email. `dept-check-weekly.py` is a local script the user runs on their own
Windows machine (Task Scheduler, Monday 09:00) — it needs
`scripts/dept-check-weekly.config.json` (SMTP credentials + recipients,
git-ignored, not present in this cloud checkout) and `C:\Homesavers\.sync-secret`,
neither of which this session has. Once the user pulls this change and
redeploys the script (`scripts\deploy-scripts.ps1` or a manual copy to
`C:\Homesavers\scripts`), the existing `--to` flag sends a one-off test to
just them **without touching the configured recipients list**:

```
python dept-check-weekly.py --to <their-email>
```

(add `--week 2026-09-21` to re-run a specific past week, or `--dry-run` to
just write `dept-check-weekly-preview.html` to disk with no send at all).
`main()`'s recipient logic is `[args.to] if args.to else cfg.get("recipients", [])`
— passing `--to` fully overrides the list for that one run and never writes
back to `dept-check-weekly.config.json`, so the real Monday send's
recipients (Jeff included, pending the user's separate decision on that)
are untouched.

### 2026-09-28 (later still) — Server-side device activity log ("scan doctor")

Follow-up to the Limerick report below: the sound/vibration fix was shipped
on a plausible theory (weak signal over the DIY/Confectionery aisles), but
there was no way to actually confirm it — the one diagnostic that could
(`deviceLog.js`'s local activity log) requires physically opening the Sync
page on the specific device involved, and this was a store with no one on
site able to do that. Pushed back on correctly: a code fix shipped on an
unconfirmed theory is a guess, not a diagnosis.

**What shipped:** `client/src/lib/deviceLog.js` now best-effort uploads every
event (`save-ok` / `save-queued-offline` / `save-failed`, plus a new
`scan-duplicate` from `DeptScan.jsx` that previously left no trace anywhere)
to `POST /api/device-log`, landing in a new `device_log_events` table
(`supabase-migration-device-log.sql`). Each upload carries:
- a stable per-browser `device_id` (new `lib/deviceId.js`, localStorage,
  random) — this is also the first time ANY device/gun identifier exists
  anywhere in this system; `task_records` itself still has none.
- for save events: `store`, `dept`, `task`, `code` — enough to answer
  "which gun, which department, saved vs queued vs duplicate" as a SQL query
  against `device_log_events` instead of a phone call asking someone at a
  till to read a screen.

Coalesced into one request per ~4s of activity (not one per scan), retried
on the browser's `online` event, never awaited on the actual save path — a
failed upload costs a diagnostic data point, never a scan, which has
already been saved/queued by the time this fires. `sentUntil` marker in
localStorage means a failed attempt naturally retries the same backlog next
time rather than needing its own retry logic.

**Still open:** the Limerick "why only DIY/Confectionery" question doesn't
have a confirmed answer yet — the weak-signal theory is the leading
candidate (consistent with the evidence gathered so far: other stores saved
both departments in the hundreds the same day; zero server-side insert
failures chain-wide; Limerick's other 8 departments that day saved
normally), but it was never verified against that specific device's own
log, because there wasn't one to check. The next occurrence — at Limerick or
anywhere — is now a `device_log_events` query away from a real answer
instead of another round of guessing.

### 2026-09-28 (later) — Dept Scan: a queued-offline save felt identical to a real one

**The report.** HS Limerick: DIY and Confectionery scans "not saving" while
every other department that day saved normally on the same store, same
devices. They could scan on other guns and it saved. Operators felt a
vibration when scanning the affected items.

**Investigation.** Ruled out a department-specific or store-specific backend
bug: other stores saved both DIY and Confectionery in the hundreds that same
day, and `edge_logs` showed zero rejected `task_records` inserts chain-wide.
Limerick's *other* 8 departments that day all saved fine, hundreds of records
each — so the app and that store's connection were clearly working most of
the time.

**Root cause.** `createTaskRecord()` (`client/src/lib/api.js`) resolves the
same way — no throw — whether the POST reached the server or the browser was
offline and it only got queued to the local IndexedDB outbox
(`isOfflineError()` catches `!navigator.onLine` and common
network-failure messages). `DeptScan.jsx`'s save handler played the exact
same `soundSaved()` beep + vibration for both outcomes, and the on-screen
row looked the same too — the only visible difference was the "X waiting"
pill, which this page is deliberately designed so the operator never has to
read. A weak-signal pocket over the DIY/Confectionery aisles (large metal
racking is the classic culprit) would queue scans locally while still
"feeling" saved, and if the device never reconnects before the tab closes,
those scans never reach the server at all.

**Fix.** Queued-offline now gets a distinct tone + vibration pattern
(`soundQueued`), a "⚠ Queued — no signal" flag on the result banner, and the
banner takes the amber background Duplicate already uses. A genuine save
failure — previously completely silent, just a red row nobody was
expected to look at — now gets its own falling two-tone buzz (`soundFailed`).

**Existing diagnostic, pointed out to the user.** `Sync.jsx`'s "Activity on
this device" panel already logs every `createTaskRecord()` outcome
(`save-ok` / `save-queued-offline` / `save-failed`) to `localStorage` via
`deviceLog.js`, specifically for "we did the checks and now they're gone"
reports — this was the fastest way to confirm the theory on the actual
device, no code change needed to check it.

### 2026-09-28 — "No Department" root cause found: scans never matched by ean_barcode; ~3,900 records backfilled

**The bug.** `GET /scan/lookup` and `GET /alt-barcodes/lookup` only ever matched
a scanned/typed code against `alt_barcodes.barcode_no`. Some products have no
real retail barcode and are keyed on the shelf ticket by their `ean_barcode`
instead — the same value `prices.ean_barcode` uses for department/price. That
value was never tried as a second lookup key, so the scan came back empty:
no item name, no supplier, no department — even though the exact code
resolves to a real, active product today. Affects every scan-based task
form, not just Department Check (Task J), since they all go through one of
these two endpoints.

**The fix.** Both endpoints now fall back to an `ean_barcode` match when
`barcode_no` (and the existing trimmed-UPC-A recovery) both miss.
Deliberately does **not** set `recovered_from` the way the UPC-A fix does —
the scanned/typed value is correct as entered and stays in the record's
`barcode_no` unchanged; the fallback only attaches the product info the old
barcode_no-only lookup was missing.

**The backfill.** Verified against the full live `task_records` table
(`task_type='J'`, `source<>'test'`, `details->>'item_group'` empty):
6,824 "No Department" rows total, of which **3,911 resolved cleanly** against
`ean_barcode` with a real, active product (spot-checked 20+ by hand — all
legitimate matches, not coincidental). Backfilled `details.item_group`,
`item_name`, `product_barcode`, `supl_id`, `supplier_code`, `item_status` and
`barcode_status` for those rows — only where each field was previously
empty, nothing already populated was touched. The remaining 2,913 are
genuinely unresolvable: garbled reads, QR codes, URLs, and other scans that
never matched any master record by either key — those stay as "No
Department", correctly.

No audit-log entries were written for the backfill itself (`task_record_events`
has no generic "backfill" event kind, and this was a one-off maintenance
correction, not a user action) — the `updated_at` bump on each touched row is
the only trace.

### 2026-09-25 (later) — Record assignment between back-office users; task-form/dashboard fixes

**1. Record assignment (new feature).** Any back-office role can now hand any
HO task record (Non-Scan, Wrong Price, every task type — not a subset) to any
*other* back-office role — bidirectional, the same flat grouping
`/message-recipients` already uses rather than a hierarchy.

- **DB** (`supabase-migration-record-assignment.sql`, applied live):
  `task_records` gains `assigned_to`/`assigned_by` (uuid, FK `users(id)`
  `ON DELETE SET NULL`) + `assigned_to_name`/`assigned_by_name` (text,
  denormalized for display without a join) + `assigned_at`. Partial index on
  `assigned_to WHERE NOT NULL`. `task_record_events_kind_chk` extended with a
  new `'assigned'` event_type so assign/unassign show in a record's History
  like any other non-status change.
- **API:** `POST /task-records/:id/assign` (`{user_id}`) and
  `/:id/unassign`, both `isBackOffice`-gated, store-scope checked like
  `messages/resolve`. `GET /task-records` gained `?assignedTo=me|<id>` —
  `'me'` resolves server-side from the session, never trusts a client-passed
  id (that would let one BO login read another's queue by guessing their
  user_id). Select list on the main list endpoint carries the four display
  columns.
- **Reports.jsx (HO records grid):** a plain `<select>` per row lists BO
  colleagues (`getMessageRecipients()`, reused rather than a new endpoint) —
  picking one assigns, the blank option unassigns. Rows assigned to the
  signed-in user float to the top of whatever page is loaded (`displayRecords`
  memo partitions `records`, doesn't refetch/resort server-side) and show
  "→ Assigned to you" / "→ Assigned to `<name>`" under the task-type cell. A
  new "Assigned to me" toggle chip **bypasses every other filter** (task
  type/status/date/etc.) — an assignment is a flag to look at something, not a
  report the assignee should have to go filter-hunting for.
- **Nav bar:** a badge (reuses the Messages badge's CSS) shows a live count of
  records assigned to the signed-in BO user, polled every 5 min while the tab
  is visible (same pattern/interval as the unread-messages badge) plus an
  instant refresh on a local `hs:assignment-changed` event fired after
  assigning/unassigning. Click navigates to `/reports` with
  `location.state.assignedToMe`, which Reports.jsx reads on mount to flip the
  toggle and run the report automatically.
- **RecordDetailModal:** "Assigned to" / "Assigned by" / "Assigned on" rows
  added to the Record group (internal/BO-only, hidden when empty like every
  other field there).
- Not done: TaskRecordList.jsx (the per-store grid on the HO Tasks page) has
  no assignment UI — this shipped on the Reports.jsx grid only, which is
  where back office actually reviews across stores.

**2. Dashboard "Department Check records by department" card — real fix.**
Two separate bugs stacked on this card (see the two entries below it for the
first pass): the spinner-forever symptom was patched first, which then
exposed the real cause — `/reports/dept-check-week`'s non-secret branch read
the shared `session` **before** its `const` declaration further down the same
function (temporal dead zone), throwing on *every* real login and never
reaching Supabase at all. Fixed by having that branch call `authenticate()`
itself instead of touching the later `session`. Also: Dashboard's date range
now defaults to **last (complete) calendar week** instead of a rolling 7 days.

**3. Task D (Wrong Description) — one product-name box, not two.** Task D
showed a read-only "Product Name (as on the product)" input (the system's
on-file name) *and* "Actual Product Name" — duplicating the LookupBanner
above, which already prints "Product Description: `<system name>`". Dropped
the read-only box for Task D; "Actual Product Name *" (already mandatory) is
now the only one. Task I unaffected (its one box was never duplicated).
Non-Scans (Task B) already required both photos both in the UI and in
validation — no change was needed there.

**4. HO Tasks page — default to Non-Scans, point Department Check elsewhere.**
Department Check (J) has its own faster dedicated page (Dept Scan). The HO
Tasks task-type picker now defaults store users to Non-Scans instead of J,
and selecting J there shows a banner ("Use Dept Scan — it's built for this
and faster") linking to `/dept-scan` instead of rendering `TaskJForm` inline.
Store users already landed on `/tasks` by default after login (`App.jsx`'s
existing `home` redirect) — that part needed no change.

---

### 2026-09-25 — Aging over the full 49 days; department charts replace department counts

Four changes, all downstream of the 7-week retention switch.

**1. `/reports/aging` reads both databases.**

Before the 7-week change an unanswered A-F query was **purge-exempt**: it stayed
in Postgres forever, so the Wednesday report could read one table and see the
entire backlog. That exemption is gone. Postgres now holds
`scan_record_retention_days` (14) and Cloudflare D1 holds the next
`archive_retention_days` (35).

Reading Postgres alone would have reported a backlog that silently **stops at 14
days** — and the failure points the wrong way, because "oldest: 14 days" reads
as good news exactly when the old queries have been moved out from under it.

The endpoint now unions the two and **dedupes by id**. That is not defensive
padding: the archiver copies a record to D1 at 01:30 and pg_cron deletes it from
Postgres afterwards, so between those two jobs the same record is genuinely in
both places. Postgres wins the tie — it is the row that can still be edited.

The horizon is `scan_record_retention_days + archive_retention_days`, read from
`app_settings` on every call, **never a literal 49**. Settings can change it, and
an aging window that disagreed with the window the Archive button promises would
be its own bug. The endpoint returns `horizon_days` and a `sources` split, and
the email prints both. The D1 half is wrapped in a catch that falls back to
Postgres-only: a report missing its older rows is recoverable, no report at all
on a Wednesday morning is what people actually notice, and D1 is a copy — nothing
lives only there.

`aging_report_records()` gained `id` (same signature, so a true replacement, not
a PostgREST overload) and `AND tr.source IS DISTINCT FROM 'test'`.

> **The test filter is a deliberate behaviour change.** It was harmless while the
> report read Postgres only — there are no test-app A-F pending rows there. D1 is
> different: it already holds **272 rows carrying `source='test'`**, because one
> archive serves both apps. Without the clause, test scans would have started
> appearing in a report that goes to Homesavers management. Applied to both
> halves so they tell the same story. Live rows affected today: **zero**.

Buckets re-stepped in `aging-report.config.json` **and** the tracked
`.example.json` — if only one moved, a fresh deploy would silently revert:

| was | now |
|---|---|
| 0-1 · 2-3 · 4-7 · 8-14 · **15+** | 0-1 · 2-3 · 4-7 · 8-14 · **15-28** · **29+** |

**2. Dashboard: department *records*, not department *counts*.**

The "Department Check by store" card showed how **many** departments each store
touched. A count cannot tell four real departments apart from four real ones plus
three that caught a single stray scan, and it answers a question nobody asked.
The business question is *"of this store's 4,047 records, how many were
HOMEWARES"*.

Replaced with one **stacked bar per store**, split by department, sized by
records, busiest store first. Bar *length* is that store against the busiest; the
*segments* are what its records were made of — two facts, one mark. The two
biggest departments are named under each bar and every segment carries hover text.

Palette **validated with the dataviz validator against both dashboard surfaces**,
not chosen by eye:

| | light `#EEF2F9` | dark `#161D2C` |
|---|---|---|
| lightness band | PASS | PASS |
| chroma floor | PASS | PASS |
| CVD separation | 11.4 deutan | 10.8 protan |
| normal-vision floor | 23.3 | 17.8 |

The dark steps are the **same hues re-stepped into the dark band [0.48, 0.67]**,
not a mechanical lightening — at dark-mode lightness the light steps lose their
deutan separation, and the pair that collapses first is crimson against green.
Each set carries one sub-3:1 contrast warning, discharged the way the validator
requires: a legend, a record count beside every bar, hover text on every segment.
Identity is never colour alone. Colours follow the entity chain-wide, so a hue
cannot mean HOMEWARES on one row and TOYS on the next.

The card also now states when the selected range asked for **more history than
Postgres holds** (`live_window.truncated`), rather than letting 14 days of rows
pass under a 180-day heading. `dept_check_department_breakdown` reads
`task_records`, so it can only ever see the live window — the Dashboard's
180-day figures come from the `task_stats_daily` rollup and are unaffected.

**3. Monday email: legend is identity only.** The chain-wide department roll-up
is gone — the owner wants store-wise figures, not a chain total.

**4. Wednesday email: the "Stores with no Department Check" box is removed.** The
Monday report covers that question over a proper calendar week, with the previous
week alongside for comparison. Two reports answering the same question over
different windows is how they end up disagreeing in a meeting. The endpoint still
returns `stores_no_dept_check`; it is simply no longer rendered.

**Files:** `supabase-migration-aging-49-days.sql` (new, applied),
`functions/api/[[route]].js`, `client/src/pages/Dashboard.jsx`,
`scripts/aging-report.py`, `scripts/dept-check-weekly.py`,
`scripts/aging-report.config{,.example}.json`.
`API_REVISION` → `2026-09-25-aging-49d`.

---

### 2026-09-24 — Weekly Department Check email, calendar weeks, coverage counts

#### The Monday 09:00 email

Who did **not** do a Department Check last calendar week, plus how much the rest
did. Scheduled task **Homesavers Department Check Weekly**, Mon 09:00, first run
**28/09/2026** (reporting Week 39).

```
scripts/dept-check-weekly.py
   └─ GET /api/reports/dept-check-week      (header: X-Sync-Secret)
        └─ RPC dept_check_summary(from, to, store_ids)
```

Deliberately a SECOND script rather than another section in `aging-report.py`:
that one runs Wednesday 08:00 about the pending query backlog and wants a
different schedule, recipients and failure mode. One report per invocation is
the existing convention — `deploy-scripts.ps1` and every Task Scheduler entry
assume it.

Recipients are in the git-ignored `dept-check-weekly.config.json` (SMTP reused
from the aging report, so one mail account to maintain). Only the example ships.

The **API** works out which week "last week" is, not the script — that matters at
a year boundary, where 2024-12-30 is week 1 of ISO-2025. Verified against
Postgres `to_char(d,'IW')` on seven dates including 2026-12-28 (wk 53) and
2027-01-04 (wk 1).

Proven end to end against live before scheduling:

> Week 38 (14/09/26 - 20/09/26): **11 of 59 stores missed**; 60,615 records,
> 386 departments.

#### One definition, two consumers

`dept_check_summary` backs both the email and the Dashboard card, so the screen
and the email can never disagree about what counts as having done a Department
Check. `GET /reports/dept-check-week` accepts **either** `X-Sync-Secret`
(chain-wide, for the script) **or** a back-office session (store-scoped, for the
Dashboard).

Two decisions worth keeping:

- **LEFT JOIN from `stores`, not an inner join.** A store that did nothing
  produces no `task_records` rows and would silently vanish from a report about
  exactly those stores.
- **`source='test'` excluded.** Telling management a store did its check because
  somebody exercised the test app is worse than no report.

"Departments" is the **distinct** count of `details->>'item_group'`, not the
number of scans: 400 records across 2 departments is a very different week from
400 across 12, and only the second is a real check.

#### Calendar weeks

A week now says which week it is, in the form the business uses:

| where | shows |
|---|---|
| date picker | `This week — Week 39 (21/09/26 - 27/09/26)` |
| chart axis | `Wk 39`, with `Week 39 (21/09/26 - 27/09/26)` as the title |

Relabelled **client-side** from the bucket start date the response already
carries, rather than reopening `dashboard_stats_v2` — a large, CPU-tuned
function — purely to change a caption. The axis follows the bucket the SERVER
says it used, so it can never label a week the data is not bucketed by.

> **A wrong turn worth recording.** The first attempt taught `rangeLabel()` to
> render the week — but nothing renders `rangeLabel`. The Dashboard uses its own
> `dataRangeLabel()`, and that one deliberately reports the days that actually
> had ACTIVITY rather than the selected window, so labelling it "Week 39" would
> be wrong whenever a store only scanned Mon–Wed. The week name belongs where the
> range is *chosen*, which is the picker.

#### Coverage counts on the Dashboard

The **No Department Check** card now also shows records, distinct departments and
"N of M stores" for the selected range, from the same endpoint as the email.
Fetched separately from the main stats so a slow aggregate never delays the
dashboard, and the helper resolves to `null` rather than throwing — a failure
costs two figures on one card, not the page.

#### The thing that could silently break it

A Monday 09:00 report about the previous Mon–Sun reads records up to **8 days
old**, against a 14-day Postgres window — about **6 days of margin**. If
`scan_record_retention_days` is ever taken below **9**, the email still sends and
the numbers are quietly wrong. The Settings floor of 10 is what keeps that safe;
do not lower it without revisiting this report.

**Not visually verified:** the Dashboard card's new counts render only for
`isBO`, and the available session is a store login. The endpoint itself is proven
(the email script drives the same RPC against live).

### 2026-09-24 — Department Check excluded from duplicate highlighting

Once highlighting actually worked, the store's default report showed **196 of
200 rows violet**. That is the data being honest rather than a bug -- 55 stores
legitimately scan the same products, so 94.4% of Department Check records share a
barcode with another -- but a signal present on almost everything is not a
signal, and it buried the cases that matter.

`DUP_EXCLUDED_TASK_TYPES = new Set(['J'])` in `client/src/lib/pricingState.js`,
applied inside `dupKey()`, which already returned null for a record with no
barcode. One rule, so the request and the highlight skip the same records: no
pointless barcodes are sent and no key can ever match. Reports and Pricing both
build their barcode list through `dupKey()` now instead of reading `barcode_no`
directly, so they cannot drift.

The RPC is untouched and still counts every type, so widening this again is a
one-line client change.

Verified on the store login, before and after:

| report | rows | highlighted |
|---|---|---|
| default (all Department Check) | 200 | 196 → **0** |
| query types only | 6 | **1** |

The one that remains is the point of the feature: *MATCH ATTAX 26/27 CARD PACKET*
raised as **Wrong Prices** by HS Roscommon on 14 Sept and HS Tallaght on 18 Sept
— two stores hitting the same pricing problem four days apart.

### 2026-09-24 — The blocked UI checks, finally run on a store login

A store session (Tallaght, `sales_assistant`, 375x812) was made available, which
unblocked four checks that had been outstanding since Monday. All four pass, and
driving the real pages found one bug that every other form of testing had missed.

| # | Check | Result |
|---|---|---|
| 1 | Dept Scan failed-row message | pass (verified earlier) |
| 2 | Task C reason dropdown vs the keyboard | **pass** |
| 3 | Task D saves when the lookup misses | **pass** |
| 4 | Save not stuck after Clear mid-lookup | **pass** |
| 5 | Phase 6 store *Current / Archived* control | **renders** |

**Check 4** is the one that mattered most — it is where the Save-gating change
met the pre-existing `reset()` bug. Measured live:

```
mid-lookup                spinner ✓   Save disabled ✓   (correct gating)
right after Clear         spinner ✓   Save disabled
after lookup would land   spinner ✗   Save ENABLED      <- reset() fix holding
new scan afterwards       works, Save enabled
```

**Check 2** passes because of the dropdown work below: the panel opened *upward*
(top 301 → bottom 539, trigger at 545), fully visible, 0px hidden. Simulating a
300px Android keyboard puts `spaceBelow` at **−77px** — the trigger is under the
keyboard line — and the placement maths correctly chooses to flip.

**Check 3**'s only surprise was not a bug: Task D's "Exactly what is printed on
the product" stayed empty after a missed lookup. That field is a **read-only
reference** for Task D (`onChange` is `undefined` when `taskType === 'D'`,
`TaskDIForm.jsx:107`) and is deliberately not required; `actual_product_name` is
the required one. Blank after a miss is correct.

#### Dropdowns: measured, then fixed

The Reports *Task types* panel on a 375px phone was **311px tall around 640px of
content — 329px of the list unreachable** — and carried a search box for 12
options. Three causes:

- panel cap was 360px → now **560**;
- the flip-upward rule only fired when space below was under 160px, which rescued
  the Android-keyboard case and nothing else. A filter mid-page has "plenty" of
  room by that test and still cannot show its list while the space above goes
  unused. Now it opens on whichever side has more room whenever the panel would
  be clipped, with the 160 floor kept so a trigger near the top does not flip
  into a sliver;
- `searchable={false}` on **all three** task-type dropdowns — Reports, Pricing
  and `TaskTypePicker` (the one a store opens before every record, where the
  search field cost a tap and pulled the keyboard over the list it was meant to
  help read). Result on the same screen: **560px, 32px hidden**.

`CurrentStorePicker` and Reports' *Stores* keep their search: 55 stores need it.

#### The bug only the real page could find

Duplicate highlighting shipped and highlighted nothing. The endpoint answered
**`200 {"keys":[]}`** for barcodes that are genuinely duplicated 16, 16 and 11
times.

`request()` already stringifies `options.body`. `getDuplicateKeys` passed
`JSON.stringify(body)` on top, so the Worker's `request.json()` returned a
**string**; `b.barcodes` read as `undefined` and the handler took its "no
barcodes supplied" early return. Every other POST helper in `api.js` passes the
raw object — this one was the outlier.

A wrong answer indistinguishable from a right one: 200, well-formed, empty.
Nothing logged, nothing threw, the rows just stayed plain — the build passed, the
scope check passed, the RPC was verified over REST, and none of it could see this.
The endpoint now rejects a non-object body with a **400** so the next instance is
loud rather than silent.

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
