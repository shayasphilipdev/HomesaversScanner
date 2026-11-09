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
this whole restoration — the app just won't get fresh prices/barcodes/data
until Phase 3 below is done, and the data it's scanning against today is
whatever last synced successfully before the attack.

This plan sequences the rebuild by actual business impact, not by file
order. For the exact command/script/schedule for any individual job, see
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

## Phase 2 — Secrets: rotate what can't be recovered, reuse what can

Every local secret file is gone, so each of these has to be entered fresh
either way. Given that, this is the point to **rotate** rather than guess
at old values — especially since Cloudflare never lets you read a secret
back out once it's set, only replace it.

| Secret | Action | Where it goes |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | **Reuse** — pull fresh from Supabase dashboard → Project Settings → API (Supabase will show you these again anytime) | Only needed locally if you use `.dev.vars` for local dev; the live site's own copy in Cloudflare was never affected |
| `PRODUCT_SYNC_SECRET` | **Rotate** — generate a new random string | Set in Cloudflare Pages → Settings → Environment variables, replacing the old value; save the same value to a new `C:\Homesavers\.sync-secret` on this PC. (A Pages env var change needs a new deployment to take effect — the next normal push will do it, or trigger a redeploy manually.) |
| `ARCHIVE_TRIGGER_SECRET` | **Rotate** if you also need to touch the archiver Worker — otherwise leave it; the Worker runs independently in Cloudflare and was never affected | `wrangler secret put` on the archiver Worker + matching Pages env var |
| CN-code app session cookie (`C:\Homesavers\.cn-source-cookie`) | **Must regenerate regardless** — log into the internal app fresh in a browser on this PC and copy the session cookie; these expire periodically even without an incident | `C:\Homesavers\.cn-source-cookie` |
| Brevo SMTP credentials (3 config files: aging-report, dept-check-weekly, dept-check-area-managers) | **Rotate if you can** via the Brevo dashboard (regenerate the SMTP key), otherwise reuse whatever the business has on file for that account | Recreate each `*.config.json` from the `.config.example.json` template already in the repo |
| Cloudflare API token (D1 capacity meter in Admin → Settings) | **Rotate** — generate a fresh one in the Cloudflare dashboard | Pasted into Admin → Settings on the live site (stored server-side, not on this PC) |

## Phase 3 — Prices + Alt-barcodes syncs (highest impact — these feed what staff scan against)

These two directly control what Department Check and every other task form
shows for product name, price, and department. Restore them first:

1. Run each manually once and watch the output:
   `run_sync.bat prices` then `run_sync.bat alt-barcodes`
   (or `run_sync.bat all` for both).
2. Confirm success in the app: Admin → Settings → Data Sync should show a
   green "ok" run for each, with a sensible row count (tens of thousands,
   not a handful — a near-empty result means the source file/folder wasn't
   found, not that the sync ran and found nothing).
3. Only once a manual run succeeds, recreate the Scheduled Task(s) that
   run these automatically (both currently run from the same morning
   schedule — see runbook §4.1/§4.2 for the exact time and command).

## Phase 4 — B&M daily file + CN-code master syncs

Lower urgency than Phase 3, but still daily operational data:

1. `run_sync.bat bm-daily`, then `run_sync.bat cn-codes` — confirm each
   completes.
2. Recreate "Homesavers B&M Daily Sync" and "Homesavers CN Code Sync" as
   Scheduled Tasks once each has run cleanly by hand.

## Phase 5 — Delivery manifest

1. Confirm `Y:\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST` is reachable
   from this PC (this is the path it was moved to on 2026-10-30).
2. Run `manifest-generator.py` manually, check the output file lands
   correctly.
3. Recreate the "Homesavers Manifest" Scheduled Task.

## Phase 6 — The 3 report emails

1. Recreate the 3 `*.config.json` files from Phase 2.
2. Run each script manually with a **test send to yourself only** — don't
   point it at the real recipient list until you've confirmed it works:
   `dept-check-weekly.py`, `aging-report.py`, `dept-check-area-managers.py`.
3. Recreate the 3 Scheduled Tasks: "Homesavers Department Check Weekly"
   (Mon), "Homesavers Aging Report" (Wed), "Homesavers Dept Check Area
   Mon"/"Thu". **Worth fixing while you're at it:** the existing setup
   docs disagree on the area-manager email's time (08:00 in one, 09:00 in
   the other) — pick one, set the task to that time, and make sure both
   docs say the same thing afterward.

## Phase 7 — Local upload server (lowest priority)

Diagnostic/manual tool, not part of the daily automated flow. Reinstall
per `install-upload-server-task.cmd`, recreate the "Homesavers Upload
Server" ONLOGON task whenever convenient.

## Phase 8 — Let it run on its own schedule, then verify

Once every job above has been triggered manually and confirmed working:

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
  Phase 1–7 steps directly — a cloud session can write and push the code
  side of things, but can't install software or create Scheduled Tasks on
  a machine it has no access to.
