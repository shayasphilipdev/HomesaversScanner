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

**Input is now SFTP (2026-11-09).** The script downloads the HSVMAN files
from our SFTP server — LAN address `192.168.1.77` port 22, folder
`Inbound File/Delivery Manifest` (outside users use `93.107.17.189:2222`,
which doesn't loop back from inside) — into `C:\Homesavers\manifest-inbound`,
keeping each file's original date. Output stays in `Store Manifest` above.
Each live run also saves a copy of the downloaded originals into the
`HSVMAN FILES- MANIFEST` folder itself (dates kept, never overwriting).
Needs the password in `C:\Homesavers\.manifest-sftp-password`; set
`SFTP_ENABLED = False` in the script to go back to reading the share.

## Phase 6 — The 3 report emails

Done last (order 8 → 7 → 9 → 6) because it needs the Brevo login.

1. Get the Brevo SMTP login and an SMTP key: Brevo → **SMTP & API → SMTP**.
   Also the Supabase **anon** key (Supabase → Project Settings → API keys),
   which the area-manager email uses to read who the area managers are.
2. `git pull`, run `scripts\deploy-scripts.ps1`, then
   `& (Get-Content C:\Homesavers\python-path.txt) scripts\setup-email-configs.py`.
   It asks for the login, key (hidden), sender, and recipients, **tests the
   Brevo login before writing anything**, then writes the three config files
   into `C:\Homesavers\scripts`. Defaults offered:
   - Aging report — To naeem@a-i-m.ie, jeff@homesavers.ie,
     shauna@supplychain1.ie; Cc shayas.philip@supplychain1.ie,
     chamya.herath@supplychain1.ie (from `Project_Status.MD` §9).
   - Weekly Department Check — **no record of the old list**; enter it.
   - Area-manager emails — each manager's address comes from Admin →
     Employees; Bcc defaults to shayas.philip@supplychain1.ie.
   Re-running it keeps every value (press Enter).
3. Send each one to yourself only first, with `--to <your address>`:
   `aging-report.py`, `dept-check-weekly.py`,
   `dept-check-area-managers.py --period full-week`.
4. Re-run `scripts\install-scheduled-tasks.ps1` — it registers the email
   tasks once their configs exist: Aging Report Wed 08:00, Department Check
   Weekly Mon 09:00, Dept Check Area Mon 08:00 (full week) and Thu 08:00
   (mid-week). The long-standing 08:00/09:00 mismatch for the area-manager
   email is settled as **08:00** — the setup doc's actual registration
   commands and its recorded "next runs" both say 08:00.

   **Paused 2026-11-10:** only the Aging Report is registered. The two
   Department Check emails (weekly, and area managers Mon/Thu) are marked
   `Paused` in the installer. Department checks now follow a schedule (not
   every week) that is still to be confirmed. The installer skips paused
   tasks, and removes them if they were registered earlier. Their configs
   stay in place, so a test send with `--to` still works.

## Phase 7 — Local upload server (lowest priority)

The small server behind Admin → Settings → Manual Upload
(`local_upload_server.py`, `http://localhost:8765`). Registered by the same
installer as Phase 8, to start at logon, windowless. If the D1 capacity
meter in Admin → Settings needs a Cloudflare API token too, generate a
fresh one in the Cloudflare dashboard.

## Phase 8 — Now automate everything above with Scheduled Tasks

Done in this order (8 → 7 → 9 → 6) so the syncs run on their own while the
email logins are gathered. One script registers every task for the
logged-on user:

`powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1`
(`-Remove` takes them all off again)

| Task | When | Runs |
|---|---|---|
| Homesavers CN Code Sync | daily 02:45 | `run_sync.bat cn-codes` |
| Homesavers Prices Sync | daily 07:00 | `run_sync.bat prices` |
| Homesavers Alt Barcodes Sync | daily 07:30 | `run_sync.bat alt-barcodes` |
| Homesavers B&M Daily Sync | every 30 min, 07:00–12:00 (since 2026-11-10; was daily 08:15) | `pythonw sync-bm-daily.py` — SFTP product CSV |
| Homesavers Manifest | every 30 min, 07:05–19:05 | `run-manifest.vbs` |
| Homesavers Upload Server | at logon | `pythonw local_upload_server.py` |

Times are the ones the jobs actually ran at before the attack (from
`sync_runs`). The tasks run "only when logged on" because the B&M sync
drives Excel, which doesn't work in a background session: keep the
`buying 1` user logged on (locked is fine). Missed runs catch up as soon as
the PC is available; the PC is woken for runs. The three email tasks are
added in Phase 6, once their config files exist. **Still to settle then:**
the existing setup docs disagree on the area-manager email's time (08:00
in one, 09:00 in the other).

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
