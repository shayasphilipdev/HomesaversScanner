# Post-Wipe Restoration Plan — Local PC Syncs & Emails

*Written 2026-11-09, after the Qilin ransomware attack on
`C:\Scraping\homesavers-scanner` led to that machine being **formatted and
reinstalled**. This is a brand-new, empty Windows install — no codebase, no
Scheduled Tasks, no Windows services, no local secret files survived.*

**What's actually broken:** the auto emails, the 5 data syncs (prices,
alt-barcodes, B&M daily file, CN-code master, delivery manifest), and the
local upload server — everything that used to run from that one PC.

**What's fine:** the live website, Supabase, and Cloudflare (Pages, D1, the
archiver Worker). None of them ever ran on that PC, and nothing about this
incident touches them. Store staff can keep scanning normally throughout
this whole restoration — but the data they're scanning against is frozen
at whatever last synced successfully before the attack, and gets staler
every day these three files don't go up: **Item Master (prices), the
Alternate Barcode file, and the B&M Daily file.** Getting those three
pushed again — even by hand, before any Scheduled Task exists — is the
single most important thing in this plan. Everything else here (CN-codes,
the manifest, the report emails, the upload server) matters, but none of
it affects what staff see when they scan.

This plan sequences the rebuild by actual business impact, not by file
order: get the three critical files flowing again first (Phase 3), then
everything else, then automate all of it at the end. For the exact
command/script/schedule for any individual job, see
`docs/local-pc-rebuild-runbook.md` — this plan tells you what order to do
things in and why; that one tells you exactly how each piece works.
For what to do if Cloudflare/Supabase/GitHub themselves were ever affected
(they weren't, this time), see `docs/website-disaster-recovery-guide.md`.

---

## Phase 1 — Baseline the new PC

Nothing below will work without this groundwork. Most of it is automated
by `scripts/setup-new-pc.ps1`:

1. Install Git (`winget install --id Git.Git -e`), open a new PowerShell
   window, and clone the repo:
   `git clone https://github.com/shayasphilipdev/HomesaversScanner.git C:\Apps\HomesaversScanner`
2. Make sure **Microsoft Excel** is installed — the B&M Daily sync opens
   its file through Excel itself and fails without it.
3. Run the setup script from the clone:
   `cd C:\Apps\HomesaversScanner` then
   `powershell -ExecutionPolicy Bypass -File scripts\setup-new-pc.ps1`
   It installs Python 3.13 (base install, **not** a `.venv` — antivirus
   quarantined a `.venv` here once after it made network calls) and the
   `requests`/`pandas`/`openpyxl` packages if missing, checks Excel,
   creates `C:\Homesavers\{scripts,logs,manifest-preview}`, checks the
   website is reachable, checks this PC can open the three critical
   source folders on `\\192.168.1.205\Buying Data` **and shows the newest
   file in each** (so you can see whether that server is still producing
   daily files), checks the later-phase drives/app (U:, Y:, the CN-code
   app at `86.43.71.253:4000`), and deploys the scripts to
   `C:\Homesavers\scripts` — the separate copy every Scheduled Task points
   at, kept apart from the git checkout so a branch switch can never break
   a live job.
4. Fix anything it reports as **FAIL** and re-run it until there are none.
   **WARN** items belong to later phases and can wait.

Source folders the three urgent uploads read (also in Admin → Settings):

| File | Folder |
|---|---|
| Item Master | `\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster\2026` |
| Alternate Barcodes | `\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster-ALTBarcode\2026` |
| B&M Daily | `\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\B&M Product File Excel\2026` |

## Phase 2 — Unlock the one secret these pushes need

The three critical syncs in Phase 3 all authenticate to the website the
same way, with one shared secret — nothing else needs sorting out before
you can push them:

| Secret | Action | Where it goes |
|---|---|---|
| `PRODUCT_SYNC_SECRET` | **Rotate** — generate a new random string (Cloudflare never lets you read the old value back out, only replace it, so there's nothing to recover anyway) | Set in Cloudflare Pages → Settings → Environment variables, replacing the old value; save the same value to a new `C:\Homesavers\.sync-secret` on this PC. (A Pages env var change needs a new deployment to take effect — the next normal push will do it, or trigger a redeploy manually.) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | **Reuse** — pull fresh from Supabase dashboard → Project Settings → API if you need them for local dev (`.dev.vars`) | Not needed for the sync scripts themselves — they only talk to the website's own API, not Supabase directly |

Every other secret (Brevo credentials, the CN-code app cookie, the
Cloudflare API token for the D1 meter) is only needed later, in the phase
that actually uses it — no reason to hold up Phase 3 gathering those too.

## Phase 3 — URGENT: manually push Item Master, Alt-barcodes, and B&M Daily

**This is the phase that matters most.** These three files are what
Department Check and every other task form actually show staff when they
scan — product name, price, department, UOM. Every day they stay stale is
a day of scans and store decisions made against out-of-date information.
Push all three by hand today, before worrying about Scheduled Tasks or
anything else below:

1. `run_sync.bat prices` — Item Master.
2. `run_sync.bat alt-barcodes` — Alternate Barcode file.
3. `run_sync.bat bm-daily` — B&M Daily file.
   (`run_sync.bat all` runs prices + alt-barcodes together, but not
   bm-daily — run that one separately either way.)
4. After each one, confirm in the app: Admin → Settings → Data Sync should
   show a green "ok" run, with a sensible row count (tens of thousands for
   prices/alt-barcodes — a near-empty result means the source file/folder
   wasn't found on this PC yet, not that the sync ran and found nothing).

Don't wait for the Scheduled Tasks to exist to do this — run these three
by hand, today, as many times as needed until each one lands clean.
Scheduled-Task automation for all jobs is consolidated into Phase 8, once
everything in this plan has been proven working manually at least once.

## Phase 4 — CN-code master sync

Daily operational data, but it doesn't feed what staff see when scanning
— lower urgency than Phase 3:

1. Create `C:\Homesavers\.cn-source-cookie` containing the one line from
   `scripts/README-cn-codes.md` (`admin_authenticated=true; user_email=...`).
   *(Corrected 2026-11-09: an earlier version said to log in through a
   browser and copy a session cookie. The CN-code app doesn't use one — it
   accepts that fixed line.)*
2. Dry run first — reads the export, changes nothing:
   `powershell -ExecutionPolicy Bypass -File C:\Homesavers\scripts\sync-cn-codes.ps1 -DryRun`
3. `run_sync.bat cn-codes` — this one empties `cn_code_master` and
   reloads it (only after a successful fetch, so a source outage never
   wipes it). Confirm `=== CN-code sync finished OK ===`.

## Phase 5 — Delivery manifest

The old U: inbox was lost in the attack. For now the delivery files
(HSVMAN*.csv) are read from, and manifests written to, the Buying Data
share (`B:` on the new PC = the old `Y:` = `\\192.168.1.205\Buying Data`):

| | Folder |
|---|---|
| Input | `B:\Supply Chain\005 - Reports\04 - H1 Declaration Manifest\02 - Manifests - Homesavers\HSVMAN FILES- MANIFEST` |
| Output | `...\HSVMAN FILES- MANIFEST\Store Manifest` (created on first run) |

1. `git pull`, then re-run `setup-new-pc.ps1` — deploys the updated script
   and shows the newest HSVMAN file it can see.
2. Dry run: builds the newest manifest into `C:\Homesavers\manifest-preview`
   for checking; writes nothing to the share.
3. Live run: builds every delivery from the last 2 days that doesn't
   already have a manifest in `Store Manifest`.

**Pending — SFTP.** The script can also download straight from B&M's SFTP.
That server is ours, inside the office; its public address
(`93.107.17.189:2222`) doesn't loop back from inside, so the script uses
its LAN address `192.168.1.77` port 22 and folder
`Inbound File/Delivery Manifest` (now the defaults). Test with
`--sftp-list "Inbound File/Delivery Manifest"`; once it shows the HSVMAN
files, `SFTP_ENABLED` can be switched on. The SFTP password is already
saved on the PC.

## Phase 6 — The 3 report emails

1. Recreate the 3 `*.config.json` files from the `.config.example.json`
   templates in the repo. Get Brevo SMTP credentials fresh from the Brevo
   dashboard if you can (rotate them), otherwise reuse whatever the
   business has on file for that account.
2. Run each script manually with a **test send to yourself only** — don't
   point it at the real recipient list until you've confirmed it works:
   `dept-check-weekly.py`, `aging-report.py`, `dept-check-area-managers.py`.

## Phase 7 — Local upload server (lowest priority)

Diagnostic/manual tool, not part of the daily automated flow. If the D1
capacity meter in Admin → Settings needs a Cloudflare API token too,
generate a fresh one in the Cloudflare dashboard while you're in there.

## Phase 8 — Now automate everything above with Scheduled Tasks

Only once every job in Phases 3–7 has run cleanly by hand at least once:

1. Recreate each Scheduled Task: "Alt-barcodes-ScannerApp" / prices
   (see runbook §4.1/§4.2 for the exact morning schedule), "Homesavers
   B&M Daily Sync", "Homesavers CN Code Sync", "Homesavers Manifest",
   "Homesavers Department Check Weekly" (Mon), "Homesavers Aging Report"
   (Wed), "Homesavers Dept Check Area Mon"/"Thu", "Homesavers Upload
   Server" (ONLOGON).
2. **Worth fixing while you're at it:** the existing setup docs disagree
   on the area-manager email's time (08:00 in one, 09:00 in the other) —
   pick one, set the task to that time, and make sure both docs say the
   same thing afterward.

## Phase 9 — Let it run on its own schedule, then verify

1. Don't touch anything overnight — let the real Scheduled Tasks fire on
   their own schedule for one full cycle.
2. The next morning, check Admin → Settings → Data Sync for a green run
   on each job, at the expected time, with no manual intervention.
3. Once that's clean, this incident is closed. Update `Project_Status.MD`
   §11 with the all-clear date.

---

## What this plan does not cover

- Nothing here needs touching in Cloudflare, Supabase, or GitHub — none of
  them were affected. If that ever changes, that's
  `docs/website-disaster-recovery-guide.md`, not this document.
- This plan assumes you (or whoever has hands on the new PC) are doing the
  Phase 1–8 steps directly — a cloud session can write and push the code
  side of things, but can't install software, push files, or create
  Scheduled Tasks on a machine it has no access to.
