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

Nothing below will work without this groundwork:

1. Install Python 3.13 as the base system install — **not** inside a
   `.venv`. A `.venv` in this exact folder got quarantined by antivirus
   once before after it made outbound network calls; the scripts are
   written to run against the base install for that reason.
2. `pip install requests pandas openpyxl`
3. Install the PowerShell `ImportExcel` module (`Install-Module
   ImportExcel`) — needed by the B&M daily and CN-code PowerShell scripts.
4. Remap/confirm the network drives and shares the scripts read from:
   the `Y:` share (delivery manifest output), and whatever UNC path the
   B&M daily file and the product-master workbook come from.
5. Confirm this PC can reach the internal CN-code app
   (`86.43.71.253:4000`) on the network.
6. Clone the GitHub repo fresh onto this PC.
7. Run `scripts/deploy-scripts.ps1` — this copies the scripts into their
   separate "deployed" location at `C:\Homesavers\scripts`, which is what
   every Scheduled Task actually points at (kept apart from the git
   checkout on purpose, so a branch switch here can never break a live
   job).

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

1. Get the CN-code app session cookie first: log into the internal app
   (`86.43.71.253:4000`) fresh in a browser on this PC, copy the session
   cookie, save it to `C:\Homesavers\.cn-source-cookie` (this one expires
   periodically even without an incident, so it needs doing fresh either
   way).
2. `run_sync.bat cn-codes` — confirm it completes.

## Phase 5 — Delivery manifest

1. Confirm `Y:\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST` is reachable
   from this PC (this is the path it was moved to on 2026-10-30).
2. Run `manifest-generator.py` manually, check the output file lands
   correctly.

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
