# Local PC — what runs there, and how to rebuild it

Written 2026-10-30, after a ransomware attack on `C:\Scraping\homesavers-scanner`
(the "local source / primary dev box"). That machine is not accessible and has
not been cleared. **No pushes or deploys should come from it until the business
says otherwise** — see the SECURITY NOTICE at the top of `Project_Status.MD`.

This file exists so the local-PC side of the system can be rebuilt from GitHub
alone, by someone who was not necessarily involved in setting the original
machine up. Everything here was reconstructed by reading the actual scripts
and their own doc comments — it is not a memory of what the PC looked like.
Where the repo doesn't settle a question (an exact Task Scheduler time, for
instance — Task Scheduler's own config lives in Windows, not in git), that's
said plainly rather than guessed.

**The live app itself does not depend on any of this.** Cloudflare Pages
deploys straight from GitHub on every push to `main`; Supabase and Cloudflare
D1 are cloud-hosted. Everything in this file is about the *nightly jobs* that
feed data into that live app and the two scheduled emails — not the app
running at https://homesaversscanner.pages.dev itself.

---

## 1. The shape of it

Three kinds of thing ran on that PC:

1. **Nightly/weekly data syncs** — pull a file or feed from somewhere, push
   rows into Supabase via the app's own API (`PRODUCT_SYNC_SECRET`-gated
   endpoints). Five of these.
2. **Scheduled report emails** — read existing data from the live API, send
   HTML email via SMTP (Brevo). Three of these.
3. **One standing local service** — a small HTTP server for manual Excel
   uploads from the Admin pages, started on login.

All of it is Task Scheduler jobs (plus one `ONLOGON` task) calling either a
Python script (base Python install, not the project's own `.venv` — see
§6) or a PowerShell script, every one of which lives in this repo under
`scripts/`.

**Convention that matters**: a scheduled task should call the script from
`C:\Homesavers\scripts\` (the "deployed" copy), **not** straight out of the
git working tree. `scripts\deploy-scripts.ps1` copies the current repo
versions there. The reason is in that script's own header: a nightly job
calling the git working tree directly means a branch switch (`git checkout
test`, say) can silently change or break what runs at 2am. Run
`deploy-scripts.ps1` after every pull that touches any of the files it lists.
**One existing inconsistency found while writing this**: the aging-report
Task Scheduler command documented in `AGING-REPORT-SETUP.md` points at the
git working tree (`C:\Scraping\homesavers-scanner\scripts\aging-report.py`),
not the deployed copy — everything else points at `C:\Homesavers\scripts\`.
Worth fixing to the deployed path when this is rebuilt, for the same reason
`deploy-scripts.ps1` exists at all.

---

## 2. Secrets & credentials — the actual list to recreate

None of these are in GitHub (all git-ignored on purpose). Per the current
security notice, **do not rotate these for now** — recreate them with their
existing values, which you'll need to have from somewhere other than this
repo (a password manager, the Cloudflare dashboard, Brevo's dashboard, etc.).

| What | Where it lives | What reads it |
|---|---|---|
| `PRODUCT_SYNC_SECRET` value | `C:\Homesavers\.sync-secret` (one line, plain text) | **Every** sync script below (prices, alt-barcodes, bm-daily, cn-codes) and both Department Check email scripts. One shared secret for all of it — also set as the `PRODUCT_SYNC_SECRET` env var in the Cloudflare Pages project (Settings → Environment variables), which is NOT on the local PC and should still be intact. |
| CN-code source cookie | `C:\Homesavers\.cn-source-cookie` (one line: `admin_authenticated=true; user_email=...`) | `sync-cn-codes.ps1` only — auth to the internal app at `http://86.43.71.253:4000` |
| Brevo SMTP login + SMTP key | `scripts\aging-report.config.json`, `scripts\dept-check-weekly.config.json`, `scripts\dept-check-area-managers.config.json` (all git-ignored; `.example.json` versions with placeholders ARE in the repo) | The three email scripts, one config file each |
| Supabase anon key | Inside `dept-check-area-managers.config.json` (`supabase_anon_key`) | That one script only — it queries `users`/`areas`/`stores` directly via Supabase REST rather than through the app's own API. Same value as the Cloudflare Pages `SUPABASE_ANON_KEY` env var. |
| `wrangler` CLI login | Cached locally by `wrangler login`, not a file in this repo | Only needed if you want to deploy/update the separate `homesavers-archiver` Worker, or run `wrangler d1 execute` against the D1 archive by hand. Not needed for the main site (that deploys from GitHub automatically). |
| Archiver Worker's own secrets | Set via `wrangler secret put`, stored in Cloudflare, not on the PC | `workers/archiver` — `SUPABASE_ANON_KEY` and `ARCHIVE_TRIGGER_SECRET`. These should already be intact in Cloudflare regardless of the PC, same as the Pages project's secrets. |

The two `.example.json` files in `scripts/` (`aging-report.config.example.json`,
`dept-check-weekly.config.example.json`, `dept-check-area-managers.config.example.json`)
show the exact shape each config file needs — copy and fill in.

---

## 3. Software prerequisites on the (rebuilt) machine

- **Python 3.13**, base install (not a venv in the scripts folder — see §6
  for why). The scripts hardcode
  `C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe` in a
  few of the documented Task Scheduler commands; if the new machine installs
  Python somewhere else, update those paths when re-registering the tasks.
  Packages needed: `requests`, `pandas`, `openpyxl` (`pip install requests
  pandas openpyxl`).
- **PowerShell `ImportExcel` module**: `Install-Module -Name ImportExcel
  -Scope CurrentUser` (for `sync-bm-daily.ps1`, `sync-cn-codes.ps1`, and the
  legacy `.ps1` sync scripts — pure .NET, no Excel installation needed).
- **Network access** to:
  - `Y:` mapped drive (or the UNC path behind it) for the product master /
    manifest ItemMaster folders — see `README-sync-products.md` for the
    default path and the known "`Y:` not mapped under the task's account"
    gotcha.
  - `U:` mapped drive (delivery manifest CSV inbox) — see §4.5.
  - `\\192.168.1.205\Buying Data\...` (B&M Product File, UNC not mapped
    drive — `sync-bm-daily.ps1` deliberately uses the UNC path so it still
    resolves for a task running "whether logged on or not", where per-user
    drive letters don't exist).
  - `86.43.71.253:4000` (internal app, CN-code export).
- **`wrangler` CLI** (`npm install -g wrangler`, or use `npx wrangler`) —
  only if this machine will also deploy the archiver Worker.
- **Windows Task Scheduler** access to register the jobs in §5.

---

## 4. The five data syncs

### 4.1 Prices (ItemMaster)
- **Script**: `scripts/sync-prices.py` (current/active — see §6 for why not
  the `.ps1` version)
- **Reads**: latest `ItemMaster_*.xlsx` from a folder configured in
  **Admin → Settings** (not hardcoded in the script) — folder, file
  pattern, and sheet name all live in `app_settings`, fetched via
  `GET /api/prices/sync-config`.
- **Writes**: `POST /api/prices/sync`, chunks of 2000 rows, upserts keyed on
  `EAN_Barcode`. Retries dropped connections/timeouts/429/5xx with backoff
  (10 attempts, ~3.7 min total) — a 4xx is a real rejection and isn't retried.
  Does **not** truncate the table first; a failed run leaves yesterday's
  complete data rather than an empty one (fixed 2026-10-28 after a
  truncate-first bug emptied the table mid-sync and left stores scanning
  against 13% of the real data for a morning — see `Project_Status.MD`
  §11, 2026-10-28 entry, for the full story).
- **Schedule**: 07:00 daily (per `CLAUDE.md`).
- **Log**: `C:\Homesavers\logs\sync-prices-py.log`.

### 4.2 Alt-barcodes
- **Script**: `scripts/sync-alt-barcodes.py` (current/active)
- Same shape as prices: config from Admin → Settings
  (`GET /api/alt-barcodes/sync-config`), `POST /api/alt-barcodes/sync` in
  2000-row chunks, upsert-not-truncate, same retry logic.
- **Schedule**: 07:30 daily.
- **Log**: `C:\Homesavers\logs\sync-alt-barcodes-py.log`.
- Both 4.1 and 4.2 are invoked via `scripts\run_sync.bat prices` /
  `run_sync.bat alt-barcodes` (also supports `run_sync.bat all` for both in
  sequence) — the deployed `run_sync.bat` launches the deployed `.py` files
  next to it.

### 4.3 B&M Daily File
- **Script**: `scripts/sync-bm-daily.ps1`
- **Reads**: latest `HomeSavers_*.xlsx` from
  `\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\B&M Product File Excel\2026`
  (hardcoded default parameter, UNC path — not configurable via Admin
  Settings like the two above).
- Keeps only the `ProductID` column (= `ean_barcode`), full-replaces
  `bm_daily_file` (empties via `POST /api/bm-daily/sync/reset`, then
  `POST /api/bm-daily/sync` in chunks of 5000).
- **Invoked via**: `run_sync.bat bm-daily`, which runs the DEPLOYED copy at
  `C:\Homesavers\scripts\sync-bm-daily.ps1` explicitly (not
  `%SCRIPTS_DIR%`) — this script isn't in `deploy-scripts.ps1`'s file list,
  so it has to be copied to `C:\Homesavers\scripts\` manually when it
  changes.
- **Task Scheduler entry**: confirmed to exist as **"Homesavers B&M Daily
  Sync"** (named in `startup-sync.vbs`'s own comment); exact time not
  documented anywhere in the repo.
- **Log**: `C:\Homesavers\logs\sync-bm-daily.log`.

### 4.4 CN-code master
- **Script**: `scripts/sync-cn-codes.ps1`
- **Reads**: `GET http://86.43.71.253:4000/api/cn-code-master/export`
  (internal app, cookie auth — the cookie is `C:\Homesavers\.cn-source-cookie`,
  see §2).
- Keeps only `product_prism_code` (= `ean_barcode`), full-replaces
  `cn_code_master` — but **only empties the table after a successful fetch
  that returns rows**, so a source outage leaves the existing table intact.
- **Invoked via**: `run_sync.bat cn-codes` → deployed copy. Same "not in
  `deploy-scripts.ps1`'s list" caveat as 4.3.
- **Schedule**: `README-cn-codes.md` documents 02:45 daily as its own
  direct Task Scheduler registration (`"Homesavers CN Code Sync"`,
  confirmed by name in `startup-sync.vbs` too).
- **Log**: `C:\Homesavers\logs\sync-cn-codes.log`.
- **Full setup walkthrough**: `scripts/README-cn-codes.md` already has a
  complete step-by-step — use it directly rather than re-deriving from
  here.

### 4.5 Delivery manifest
- **Script**: `scripts/manifest-generator.py`
- **Reads**: new `HSVMAN*.csv` files from
  `U:\Finance Dept-Shared Folder\B&M - Homesavers Shared Database\Live\Inbound file\Delivery Manifest`,
  looks up Group/Subgroup/Product ID from the latest ItemMaster (same `Y:`
  folder as §4.1) by Short Code, writes a formatted Excel workbook.
- **Writes**: `Y:\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST\Manifest-
  <Load> - <Trailer>.xlsx` (changed 2026-10-30, from the older
  `Y:\Supply Chain\012 - Manifest\2026`).
- No database writes — pure file-to-file, reads only from the app's side
  (reports the run to `/api/sync-runs` so it shows in Admin → Settings →
  Data Sync, same as the other syncs).
- Only processes NEW HSVMAN files (output not already present) — designed
  to be safe to run frequently/repeatedly, not just once a day.
- Invoked via `run-manifest.vbs` (hides the console window; resolves its
  own script folder, so the same file works run from the git tree or the
  deployed copy — but per its own comment, the scheduled task is meant to
  point at the **deployed** copy).
- **Task Scheduler entry**: confirmed to exist as **"Homesavers Manifest"**
  (named in `startup-sync.vbs`'s comment). **Exact schedule/frequency not
  documented anywhere in the repo** — given the script's own design ("process
  every NEW file"), it's likely scheduled to run several times a day rather
  than once, but this genuinely isn't recorded anywhere I can check. If you
  remember the original frequency, re-register it directly; otherwise a
  reasonable starting point is hourly during the business day, loosened or
  tightened once you see how often HSVMAN files actually land.
- `--dry-run` builds to `C:\Homesavers\manifest-preview` without writing to
  `Y:`; `--file "<path>"` force-processes one file by hand.
- **Log**: `C:\Homesavers\logs\manifest-generator.log`.

---

## 5. The three report emails

All three use Brevo as the SMTP relay (free tier, 300 emails/day) with the
From address kept as `orders.homesavers@outlook.com` — Microsoft disabled
password SMTP for outlook.com directly, so Brevo relays on its behalf. Each
has its own config file (§2) but can share one Brevo account.

| Email | Script | Schedule (as documented) | Scope |
|---|---|---|---|
| Aging Report | `scripts/aging-report.py` | Wednesday 08:00 | Chain-wide — Pending Non-Scans/Wrong Prices/Wrong Description, by age bucket |
| Department Check Weekly | `scripts/dept-check-weekly.py` | Monday 09:00 | Chain-wide — who missed a Department Check last week |
| Department Check — Area Managers | `scripts/dept-check-area-managers.py` | Thursday + Monday, **08:00 per `DEPT-CHECK-AREA-MANAGERS-SETUP.md`, 09:00 per `deploy-scripts.ps1`'s own comment — the two disagree, actual registered time not otherwise confirmable from the repo** | Per-area-manager, their stores only; `shayas.philip@supplychain1.ie` BCC'd on every send |

Each has a full, standalone setup guide already in the repo — use these
directly, they're more complete than a summary would be:
- `scripts/AGING-REPORT-SETUP.md`
- `scripts/DEPT-CHECK-WEEKLY-SETUP.md`
- `scripts/DEPT-CHECK-AREA-MANAGERS-SETUP.md`

All three share one constraint worth knowing before touching
`scan_record_retention_days` in Admin → Settings: a Monday-morning report
about the previous week reads records up to 8 days old, and Department
Check records only live in Postgres for `scan_record_retention_days` days
before moving to the D1 archive (where these report queries can't see them
the same way). The Settings page enforces a floor of 10 days specifically
to protect this — don't lower it without re-reading
`DEPT-CHECK-WEEKLY-SETUP.md`'s "one thing that could silently break it"
section.

Every script supports `--dry-run` (writes a preview `.html` next to itself,
sends nothing) and `--to <email>` (sends only to that one address) for safe
testing after a rebuild, before trusting it with the real recipient list.

---

## 6. The two generations of alt-barcode/prices sync — use the newer one

There are **three** different implementations of the alt-barcode sync in this
repo, from different points in the project's history:

1. **`scripts/sync-alt-barcodes.py`** + `run_sync.bat` + Task Scheduler —
   **this is the current, active one** (confirmed by `CLAUDE.md`, last
   touched 2026-10-28, and by `run_sync.bat` itself).
2. `scripts/sync-alt-barcodes.ps1` + `install-alt-barcode-task.cmd` +
   `run-alt-barcode-sync.cmd` — an older Task Scheduler-based PowerShell
   version. Appears superseded by (1).
3. `scripts/sync-alt-barcodes-service.ps1` + `README-sync-service.md` — a
   still-older approach running as a persistent Windows Service via NSSM
   (file-watcher + daily heartbeat). Its own README references an
   `ALT_BARCODE_SYNC_SECRET` Cloudflare env var that **does not exist** in
   the current backend (`functions/api/[[route]].js` gates every sync
   endpoint, alt-barcodes included, on the single `PRODUCT_SYNC_SECRET`) —
   a clear sign this generation predates the current secret scheme and
   should not be followed.

**When rebuilding: use generation (1) only.** `scripts/sync-prices.ps1` is
the same situation relative to `scripts/sync-prices.py` — use the `.py`
version. The `.ps1` and `.ps1`-service files are left in the repo for
history/reference, not because they should be reinstalled.

Also worth knowing: `run_sync.bat`'s own header comment explains why it
calls the **base** Python install rather than a project-local `.venv`:
antivirus on the original machine quarantined/zeroed a `.venv` folder after
it made outbound network calls (which is exactly what a `pip install`'d
`requests` library does when the sync scripts run). Don't recreate a `.venv`
inside `scripts/` on the rebuilt machine for the same reason — install
`requests`/`pandas`/`openpyxl` into the base Python install instead.

---

## 7. The local upload server

- **Script**: `scripts/local_upload_server.py`
- Listens on `http://localhost:8765`, accepts Excel uploads from the
  browser's Admin pages (manual one-off imports, distinct from the
  scheduled syncs), parses with pandas/openpyxl, posts to the same app API
  the scheduled jobs use.
- Uses the `requests` library specifically (not `urllib.request`) because
  `urllib` validates against the OS's OpenSSL cert store, which had an
  expired root on the original machine and failed every call with
  `CERTIFICATE_VERIFY_FAILED`. If this resurfaces on the rebuilt machine,
  it's an OS cert store problem, not a code problem — `requests`/`certifi`
  sidesteps it, which is why every script in this folder uses `requests`.
- **Invoked via**: `run_sync.bat server`, or directly.
- **Task Scheduler entry**: `install-upload-server-task.cmd` registers
  **"Homesavers Upload Server"**, trigger `ONLOGON` (starts when you log
  in, not on a timer). Deliberately **not** also started from
  `startup-sync.vbs` — see that file's own comment: two start points would
  race for port 8765.

---

## 8. What does NOT need the local PC

- **The main site** (`homesaversscanner.pages.dev`) — Cloudflare Pages
  deploys from GitHub automatically on every push to `main`.
- **The `homesavers-archiver` Cloudflare Worker** (moves aged
  `task_records` to the D1 archive, cron `30 1 * * *` / `45 1 * * *` UTC,
  deployed from `workers/archiver/`) — runs entirely in Cloudflare's own
  infrastructure. It only needs the local PC (or any machine with `wrangler`
  access) if you want to **redeploy/update** it or run a one-off
  `wrangler d1 execute` query against the archive by hand.
- **Supabase and D1 data** — both cloud-hosted, untouched by anything that
  happens to the PC.

---

## 9. Rebuild checklist

1. Clone the repo fresh: `git clone
   https://github.com/shayasphilipdev/HomesaversScanner.git`.
2. Install Python 3.13 (base install) +
   `pip install requests pandas openpyxl`.
3. Install the `ImportExcel` PowerShell module
   (`Install-Module -Name ImportExcel -Scope CurrentUser`).
4. Map/confirm access to `Y:`, `U:`, and the B&M UNC share; confirm the
   internal app at `86.43.71.253:4000` is reachable.
5. Recreate `C:\Homesavers\.sync-secret` and
   `C:\Homesavers\.cn-source-cookie` with their **existing** values (not
   rotated — see §2 and the security notice).
6. Copy the three `.config.example.json` files to their real names inside
   `C:\Homesavers\scripts\` and fill in the **existing** Brevo + Supabase
   credentials.
7. Run `powershell -ExecutionPolicy Bypass -File scripts\deploy-scripts.ps1`
   to populate `C:\Homesavers\scripts\` — then manually copy
   `sync-bm-daily.ps1` and `sync-cn-codes.ps1` there too (not covered by
   that script — see §4.3/4.4).
8. Re-register the Task Scheduler jobs. Known names: "Homesavers B&M Daily
   Sync", "Homesavers CN Code Sync", "Homesavers Manifest",
   "Alt-barcodes-ScannerApp" (or re-register fresh as
   "Homesavers Alt-Barcode Sync" pointed at the current `.py` script —
   see §6), a prices-sync task (name not confirmed anywhere in the repo —
   register one pointed at `run_sync.bat prices`, 07:00), "Homesavers
   Upload Server" (`ONLOGON`), "Homesavers Aging Report" (Wed 08:00),
   "Homesavers Department Check Weekly" (Mon 09:00), "Homesavers Dept
   Check Area Mon"/"Thu" (time per §5's caveat — confirm before trusting
   either documented time). Exact `schtasks` commands are in each
   script's own SETUP.md/README where one exists (§4.4, §5); for the
   others, the pattern is `schtasks /Create /TN "<name>" /SC DAILY|WEEKLY
   [/D <day>] /ST <HH:MM> /TR "<command>" /RL HIGHEST /F`.
9. Test each job with its dry-run/test flag before trusting it unattended
   (every script has one — §5 for the emails, `-DryRun` for the PowerShell
   syncs, `--dry-run` for the Python ones).
10. If you also need to redeploy the archiver Worker: `wrangler login`,
    then from `workers/archiver/`, `npx wrangler deploy` and
    `npx wrangler secret put SUPABASE_ANON_KEY` /
    `npx wrangler secret put ARCHIVE_TRIGGER_SECRET` (existing values, not
    rotated). Not needed just to keep the Worker running — only to change it.
