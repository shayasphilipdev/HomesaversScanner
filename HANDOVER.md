# Handover — Department Check "records by department" card stuck loading

**Date:** 2026-09-25
**Branch:** `claude/kind-ride-q56k58` (pushed, no PR opened)

## Issue reported
Dashboard card "Department Check records by department" showed an endless spinner and never rendered.

## Investigation
- Checked Supabase logs for the two RPCs this card depends on (`dept_check_summary`, `dept_check_department_breakdown` via `/reports/dept-check-week`): both consistently returning 200 OK, RPCs execute correctly, permissions are fine.
- Checked `dashboard_stats_v2` (the other Dashboard fetch): also all 200 OK.
- So the backend/database were healthy — the bug was in the frontend's loading/error handling, not the data.

## Root cause
In `client/src/pages/Dashboard.jsx`, the card component `DeptCheckByStore` was given the **general** dashboard `loading` flag (which only tracks the `getDashboardStats` call) instead of its own. Its actual data comes from a separate call, `getDeptCheckWeek()`, which by design **never throws** — any network/server failure resolves to `null` instead (`client/src/lib/api.js`).

The card's spinner condition was `loading || !summary`. Once the unrelated `getDashboardStats` call finished (`loading` → false), a failed or still-in-flight `getDeptCheckWeek()` request looked identical: `summary` was `null` either way. So if that one request ever failed (or on a slow connection, briefly), the card had no way to tell "still loading" apart from "failed" — it just spun forever with no error message.

## Fix applied
- Added a dedicated `deptLoading` state, set around the `getDeptCheckWeek()` call specifically (`.finally(() => setDeptLoading(false))`).
- `DeptCheckByStore` now receives `loading={deptLoading}` instead of the general `loading`.
- Added a distinct "Couldn't load this data. Try refreshing the page." message for the case where loading has finished but `summary` is still `null` (i.e. the fetch genuinely failed), instead of showing the spinner indefinitely.

File changed: `client/src/pages/Dashboard.jsx` (19 insertions, 3 deletions).

## Status (part 1)
- Committed and pushed to `claude/kind-ride-q56k58`, then merged into `main` (fast-forward) so Cloudflare Pages would auto-deploy.
- Build could not be verified locally in this sandbox (npm install blocked by network policy — `xlsx` package fetch from `cdn.sheetjs.com` forbidden). Change is small and isolated to JSX conditional logic; reviewed by diff instead.

---

## Part 2 — the real backend bug

After the frontend fix deployed, the card correctly started showing **"Couldn't load this data. Try refreshing the page."** — meaning the fetch was genuinely failing, not just mis-rendering. That pointed at a real backend problem.

### Root cause
Checked Supabase logs: `dashboard_stats_v2`, `stores`, `areas` (all called by the same Dashboard load) were succeeding continuously. But `dept_check_summary` / `dept_check_department_breakdown` (the two RPCs behind `/reports/dept-check-week`) had **not been called via a real login session even once** — only via the `X-Sync-Secret` test/email path, hours earlier.

Reading `functions/api/[[route]].js`: the `/reports/dept-check-week` route (line ~1176) is intentionally placed *before* the shared `const session = await authenticate(...)` line (~1464), so the secret-authed weekly-email caller never needs a login. But its own auth check for the *non-secret* (Dashboard) path read that same-named `session` — a `const` declared later in the exact same function scope. In JavaScript that's a **temporal dead zone violation**: referencing a `const` before its declaration throws `ReferenceError: Cannot access 'session' before initialization`, every single time, for every real logged-in user. The request crashed inside the Cloudflare Function before it ever reached Supabase — which is exactly why Supabase's logs showed nothing for it.

The secret-authed path never hit this line (short-circuited by `!secretOk &&`), which is why manual/test calls with the sync secret worked fine and made it look like the feature was healthy.

### Fix applied
In `functions/api/[[route]].js`, the non-secret branch now calls `authenticate(request, env)` itself (`callerSession`) instead of reading the later outer `session`. `isBackOffice(callerSession)` and `scopedStoreIds(db, callerSession)` updated to match. The secret path is untouched (`callerSession` stays `null` there, never used).

File changed: `functions/api/[[route]].js` (10 insertions, 2 deletions).

### Status (part 2)
- Committed and pushed to `claude/kind-ride-q56k58`, merged into `main` (fast-forward), pushed — Cloudflare Pages will auto-deploy (~1-2 min).

## Recommended next step for the user
Wait ~2 minutes for the Cloudflare Pages build, then hard-refresh the Dashboard. The card should now populate. If it still errors, check the browser Network tab for the actual status code/body of `/api/reports/dept-check-week` — that would point to a different issue (e.g. an expired session token) rather than this crash.

---

## Dashboard date range default → last week

Changed the Dashboard's default date-range preset from `last_7` (rolling 7 days) to `last_week` (last complete Mon–Sun calendar week) — the preset already existed in `client/src/lib/dateRange.js`, this just changed which one `Dashboard.jsx` opens with. File: `client/src/pages/Dashboard.jsx`. Pushed and merged to `main`.

---

## Task D form — duplicate "product name" box removed; HO Tasks page defaults

**Task D (Wrong Description):** the form showed a read-only "Product Name (as on the product)" box (the system's on-file name) *and* "Actual Product Name" — the same info the scan-result banner above it already prints as "Product Description: `<name>`", so it read as two boxes asking the same question. Removed the read-only one for Task D only; "Actual Product Name *" (already mandatory) is now the sole product-name field there. Task I untouched. File: `client/src/components/forms/TaskDIForm.jsx`.

**Non-Scans (Task B) both photos mandatory:** already true in the code (`required` prop + explicit validation before save, online and offline-queued) — no change needed, confirmed by reading `TaskBForm.jsx`.

**HO Tasks page defaults:** store users already land on `/tasks` after login (pre-existing `App.jsx` redirect, no change). Changed the task-type picker's default from Department Check (J) to Non-Scans (B) — `client/src/pages/Tasks.jsx`. Selecting Department Check on this page no longer opens `TaskJForm`; it now shows a banner pointing at the dedicated `/dept-scan` page instead — `client/src/components/TaskForm.jsx`.

All pushed and merged to `main`.

---

## Record assignment between back-office users (new feature)

**What it does:** any back-office role (`area_manager`, `support_admin`, `buying_manager`, `buying_head`, `admin`) can assign any HO task record — Non-Scan, Wrong Price, every task type — to any *other* back-office role, and vice versa (bidirectional, flat grouping — no hierarchy). The assignee sees it pinned to the top of the Reports grid with an "Assigned to you" badge, plus a nav-bar count badge.

### Database (applied live via Supabase MCP, tracked in `supabase-migration-record-assignment.sql`)
- `task_records` gained: `assigned_to` (uuid → `users.id`, `ON DELETE SET NULL`), `assigned_to_name` (text), `assigned_by` (uuid), `assigned_by_name` (text), `assigned_at` (timestamptz).
- Partial index `idx_task_records_assigned_to` on `assigned_to WHERE NOT NULL`.
- `task_record_events_kind_chk` extended to allow a new `'assigned'` event_type, so assign/unassign show in a record's History panel like any other change.

### Backend (`functions/api/[[route]].js`)
- `GET /task-records` select list now includes the four assignment display columns, and accepts `?assignedTo=me|<user_id>` (`'me'` resolves server-side from the session — never trusts a client-supplied id).
- New `POST /task-records/:id/assign` (`{ user_id }`) and `POST /task-records/:id/unassign`. Both gated `isBackOffice(session)`, store-scope checked the same way `messages/resolve` already does. Target user for assign must be an active user with a `BO_ROLES` role. Both write a `task_record_events` audit row.

### Frontend
- **`client/src/lib/api.js`:** `assignTaskRecord(id, userId)`, `unassignTaskRecord(id)`.
- **`client/src/pages/Reports.jsx`** (the HO records grid): a native `<select>` per row (options from `getMessageRecipients()`, reused rather than a new endpoint) — pick a name to assign, blank option to unassign. Rows assigned to the signed-in user are pinned to the top of whatever page is currently loaded (client-side reorder, no extra fetch) and show "→ Assigned to you" / "→ Assigned to `<name>`" under the task-type cell. New "Assigned to me" toggle chip that **ignores every other filter** (task type/status/date range) — it's a flag to look at, not a report to filter your way into.
- **`client/src/components/Nav.jsx`:** badge (reuses the Messages badge styling) showing a live count of records assigned to the signed-in back-office user; polls every 5 minutes while the tab is visible, refreshes instantly on a local `hs:assignment-changed` event. Clicking it opens `/reports` and auto-enables the "Assigned to me" toggle via `location.state`.
- **`client/src/components/RecordDetailModal.jsx`:** added "Assigned to" / "Assigned by" / "Assigned on" rows (back-office only, hidden when the record isn't assigned).

### Not done / scope notes
- Assignment UI is on the Reports.jsx grid only — the simpler per-store grid on the HO Tasks page (`TaskRecordList.jsx`) doesn't have it. That's where back office actually reviews across all stores, so it covers the ask; say if you also want it on the Tasks page grid.
- An `area_manager` assignee whose store scope doesn't cover a record's store still won't see it even once assigned — same store-scope rule as everywhere else in the app, not a new limitation this feature introduces.

### Status
All changes committed and pushed to `claude/kind-ride-q56k58`, merged into `main` (fast-forward), pushed — Cloudflare Pages will auto-deploy. The DB migration is already live (applied directly via the Supabase MCP tool, ahead of the code push, so it's safe even mid-deploy).

**Could not verify with a real build** — `npm install` in this sandbox is blocked by network policy (the `xlsx` dependency pulls a tarball from `cdn.sheetjs.com`, which the sandbox's egress proxy denies), so no local `vite build` or dev server run was possible. Everything above was checked by careful manual review against the existing, working patterns in the same files (the messaging feature's assign-a-colleague picker, the existing reverse-status audit-event pattern, etc.) rather than a compiled/running app. Worth a real click-through in the live app once deployed, especially: assigning a record, confirming it appears for the assignee, and the nav badge count.

---

## Dashboard department-list card + product-list export

Removed the hardcoded "show only top 2 departments" cap on the Dashboard's per-store department summary line — it now lists every department the store recorded (the coloured bar segments already showed them all; the text line was the only thing hiding data). File: `client/src/pages/Dashboard.jsx`. Pushed and merged to `main`.

Also generated and sent an Excel file (`dept_check_week39_no_department_and_other.xlsx`) with the full "No Department" (1,961 products) and "Other" (9,696 products) lists for Week 39, since that was ~11,700 rows — far too large for a chat table. Built by pulling the data via the Supabase MCP tool (using `string_agg` to get each bucket back as one big delimited string rather than one JSON object per row, which is what let ~10K-row pulls fit through the tool at all) and assembling it with `openpyxl` (had to `pip install openpyxl` — not preinstalled in this sandbox, unlike what the xlsx skill assumes; PyPI itself was reachable even though the npm-side `cdn.sheetjs.com` isn't).

---

## Root cause found + fixed: "No Department" records, and a ~3,900-record backfill

**The ask:** the user identified that 1,103 of the "No Department" records actually have matching product data in the item master, and asked (a) to fill in the missing details and (b) find out why they weren't populated in the first place.

### Investigation
Traced the data model: a Department Check record's `barcode_no` is whatever was scanned/typed; `item_name`/`product_barcode` (EAN)/department come from a live lookup at scan time (`GET /scan/lookup` → `alt_barcodes` by `barcode_no`, then `prices` by the resulting `ean_barcode`, for `item_group`). Checked the live Supabase data directly:

- Querying `alt_barcodes.barcode_no = task_records.barcode_no` (the endpoint's actual lookup path) only resolved a small fraction.
- Querying `prices.ean_barcode = task_records.barcode_no` **directly** — i.e. treating the recorded `barcode_no` as if it were an `ean_barcode` — resolved the overwhelming majority, all to real, active, sensible products (spot-checked 20+, e.g. `14-27-409-00` → "HIPSTER GREY L.BASKET", HOMEWARES).

**Root cause:** some products have no real retail barcode and are keyed on the shelf ticket by their `ean_barcode` (an internal code, often dash-formatted) rather than a normal `alt_barcodes.barcode_no`. `/scan/lookup` and `/alt-barcodes/lookup` never tried that second key — so a scan/entry of that code came back with nothing at all: no name, no supplier, no department. This affects every scan-based task form (they all share these two endpoints), not just Department Check.

My count came to 1,435 resolvable in the Week 39 file specifically (vs. the user's 1,103 — flagged as a discrepancy, not chased down further since the underlying finding and fix were the same either way), and **6,824 "No Department" records across the whole live table**, of which **3,911 resolved**.

### Actions taken (confirmed with the user first via AskUserQuestion: backfill all live records, and fix the lookup)
1. **Backfilled** `details.item_group`, `item_name`, `product_barcode`, `supl_id`, `supplier_code`, `item_status`, `barcode_status` on all 3,911 resolvable rows — via a single `UPDATE ... FROM` in Supabase, only filling fields that were previously empty (nothing already populated was touched). Verified: "No Department" count dropped from 6,824 to 2,913 (the remainder are genuinely unresolvable junk scans — URLs, QR codes, garbled reads — correctly still "No Department").
2. **Fixed the lookup** in `functions/api/[[route]].js`: both `/scan/lookup` and `/alt-barcodes/lookup` now fall back to matching `ean_barcode` when `barcode_no` (and the existing trimmed-UPC-A recovery) both miss. Deliberately does **not** set `recovered_from` — unlike the UPC-A case, the scanned/typed value is correct and stays in `barcode_no` unchanged; the fallback only attaches the product info that was previously missed entirely. Pushed and merged to `main`.

### Notes
- No `task_record_events` audit rows were written for the backfill (it's a one-off maintenance correction, not a user action, and there's no generic "backfill" event kind in that table's CHECK constraint) — each touched row's `updated_at` is the only trace.
- Full write-up in `Project_Status.MD` §11 (2026-09-28 entry).

---

## Limerick "DIY/Confectionery not saving" — root cause + fix

**The report:** Limerick could scan other departments fine on other guns; DIY and Confectionery specifically weren't saving, and staff felt a vibration when scanning them.

**Ruled out first:** a department- or store-specific backend bug. Checked Supabase directly — other stores saved DIY/Confectionery in the hundreds that same day, and zero `task_records` inserts were rejected server-side chain-wide. Limerick's other 8 departments that day all saved normally, hundreds of records each.

**Root cause:** `createTaskRecord()` in `client/src/lib/api.js` returns successfully (no throw) both when a scan reaches the server AND when the browser is offline and it only gets queued to the local IndexedDB outbox. `DeptScan.jsx` played the identical "saved" beep + vibration for both cases — so a weak-wifi pocket over the DIY/Confectionery aisles (large metal racking is the classic cause) would queue scans locally while still *feeling* like a normal save, with only the easy-to-miss "X waiting" pill as any visible sign. If that device never reconnects before the tab closes, those scans never reach the server at all — matching "vibration happens, but it's not saving."

**Fix shipped:** `client/src/pages/DeptScan.jsx` now plays a distinct tone/vibration for a queued-offline save vs a confirmed one, shows a "⚠ Queued — no signal" flag + amber banner (same treatment as the existing Duplicate alert), and a genuine save failure — previously totally silent — now also gets its own distinct buzz. Pushed and merged to `main`.

**Told the user about an existing diagnostic they may not know about:** `Sync.jsx` already has an "Activity on this device" panel (`deviceLog.js`, `localStorage`-only) that logs every save attempt as `save-ok` / `save-queued-offline` / `save-failed`, built exactly for "we scanned it and it's gone" reports. Recommended checking it on the specific device used for DIY/Confectionery to confirm the theory directly and see if any queued scans are still recoverable.

---

## Pushback: "loose answer" + a live server-side scan doctor

User correctly called out that the weak-wifi theory above was never actually confirmed — I recommended checking the local device log, but that requires physical access to the specific gun, and this store has no one on site who can do that. Fair challenge: a fix shipped on an unconfirmed theory is a guess dressed up as a diagnosis. I asked one clarifying question (single vs double vibration buzz — the one fact that would've pinned down "queued offline" vs "duplicate detection" definitively) but the user couldn't get it checked either, for the same reason (far-away store, no expert on site).

**So I built the thing that removes the "need someone on site" dependency going forward**, rather than guessing further:

- **New:** `client/src/lib/deviceId.js` — first device/gun identifier anywhere in this system (random, localStorage, stable per browser). `task_records` itself still has none.
- **`client/src/lib/deviceLog.js`** now best-effort uploads every local log entry to a new `POST /device-log` endpoint, landing in a new `device_log_events` Supabase table (`supabase-migration-device-log.sql`, applied live). Save events carry store + department + task type, so "which gun, which department, saved vs queued vs duplicate" becomes a SQL query, not a phone call.
- **`DeptScan.jsx`** now also logs `scan-duplicate` (previously invisible anywhere — that branch returns before `createTaskRecord` ever runs).
- Coalesced (~1 request per 4s of scanning, not per scan), retried on reconnect, never blocks or gates the actual save — diagnostics riding alongside real scans on the same shop wifi.

**Honest status on "why only DIY/Confectionery":** still not confirmed. The weak-signal theory remains the leading candidate given what the data does show (other stores saved both departments fine that day; zero server-side insert failures chain-wide; Limerick's other 8 departments that day were normal) — but it was never verified against that specific device's own activity, because until today there was no way to see that remotely. The next time this happens anywhere, it's a `device_log_events` query away from a real answer instead of another round of inference from aggregate counts.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Weekly Department Check email: same department-cap fix, plus greeting/sign-off

Turned out the department-count screenshot that started this whole thread was from the **weekly email attachment**, not the live dashboard — but since the dashboard fix landed and looks right anyway, no need to undo that. This entry is just the matching fix on the email side.

**Shipped in `scripts/dept-check-weekly.py`:**
- Removed the same `[:2]` truncation the dashboard had, in `count_row()` — every department a store scanned now lists under its bar instead of just the top two.
- Added "Hi All," under the masthead and "Regards, Homesavers Scanner" before the closing tags, per the requested wording.
- Small wording tweak in the card-2 footnote to match (says "every department" instead of "the two biggest").

**I cannot send this myself, or even test-send it.** This script isn't part of the deployed app — it's a local Python script that runs on the user's own Windows machine via Task Scheduler (Mondays 09:00), and it needs two things this cloud session doesn't have: `scripts/dept-check-weekly.config.json` (SMTP login + recipients, git-ignored) and `C:\Homesavers\.sync-secret`. I've edited and pushed the code; someone needs to pull it down and redeploy (`scripts\deploy-scripts.ps1`, or copy manually to `C:\Homesavers\scripts`) before it can actually run.

**Test-send to just yourself, once deployed, without touching the real recipient list:**
```
python dept-check-weekly.py --to youraddress@example.ie
```
This is an existing flag, not something new — `main()`'s recipient logic is `[args.to] if args.to else cfg.get("recipients", [])`, so `--to` fully replaces the recipient list *for that one run only* and never writes anything back to the config file. The real Monday send (and Jeff's presence on it, which is still pending a separate decision) is completely untouched by running this. Add `--dry-run` instead if you'd rather just get the HTML file on disk with nothing sent at all.

Pushed and merged to `main` (`846e42a`). Merging doesn't make it live, though — see the next entry.

---

## Deploying that fix hands off to the LOCAL Claude Code session, not this one

After the merge above, the user sent back a screenshot of the actual email/report still showing the old 2-department-cap behaviour. Makes sense: merging to `main` only means the code is on GitHub. `dept-check-weekly.py` isn't part of the Cloudflare-deployed app — it only runs because Windows Task Scheduler on the user's own machine fires it, from wherever it's copied to on that machine (`C:\Homesavers\scripts`). This cloud session has no network path to that machine at all — not a permission I could grant myself, just genuinely nothing to connect to from here.

**The fix:** the user has a SEPARATE, local Claude Code session running on that same Windows machine, working out of `C:\Scraping\homesavers-scanner` (matches the "Local" path already documented in `CLAUDE.md`). That session has real filesystem/git/PowerShell/Python access there. Gave the user this to hand to that local session:

1. `git pull origin main` in `C:\Scraping\homesavers-scanner`
2. `.\scripts\deploy-scripts.ps1` — copies the updated files into `C:\Homesavers\scripts`
3. `cd C:\Homesavers\scripts` then `python dept-check-weekly.py --to <their email>` to test-send to just themselves

**Worth remembering for next time:** this codebase gets worked on from two different Claude Code sessions — this cloud one (can edit/commit/push/merge to `main`, but can't touch anything under `C:\Homesavers\...`, run local Python against real SMTP creds, or reach Task Scheduler) and a local one on the user's own PC at `C:\Scraping\homesavers-scanner` (which can do all of that). Anything that needs to actually *execute* against local paths or real credentials has to be routed to the local session — don't offer to "just deploy it" from here again; explain the split up front instead.

---

## "Other department" wasn't a bug — but checking it surfaced a real one

User said the Alt Barcode file seemed to have an "Other" department too, and asked to backfill/fix it, same as the earlier "No Department" issue. Checked properly instead of assuming:

- `alt_barcodes` has no department column, period — department only ever comes from `prices` (Item Master), by `ean_barcode`.
- `prices.item_group` has 30 real department names live right now, and "Other" isn't one of them.

So there's no missing/hidden "Other" department anywhere in the data. The grey "Other" you see on the Dashboard card and in the weekly email is the report's own intentional grouping — anything outside the chain-wide top 8 departments folds into that one grey swatch so the legend doesn't need 20+ colours. Every record in it already has its own real, correct department; it's just visually bucketed. Told the user this rather than "fixing" something that wasn't actually broken.

**What checking it turned up instead:** a NEW batch of genuine "No Department" records — different from the ones fixed earlier the same day. 1,499 of 3,311 live records resolved instantly against CURRENT master data with the simplest possible match (direct barcode_no lookup, no ean-fallback trickery needed), and the matching price data had been sitting there correctly since that morning's sync — hours before the affected scans happened. So this wasn't stale data and it wasn't the earlier ean-matching gap. Something else was losing the department.

**Root cause:** `DeptScan.jsx` looks up the department with a 10-second timeout before saving. If that one lookup call is slow (shop wifi), it can time out and return nothing — independently of whether the actual save then goes through fine. The record saves successfully, just with no department baked in permanently, because nothing ever retries the lookup afterward. Same exposure exists for offline-queued scans syncing later.

**Fix:** `POST /task-records` now has a safety net — if a Department Check record comes in with no department, the server looks it up itself (server-to-Supabase never has shop-wifi timeouts) before saving. Covers both live saves and offline scans syncing back later, since both go through this same endpoint. Only kicks in for the records that actually need it, so it costs nothing on the normal path.

**Backfilled** 1,499 of the 3,311 affected records right now, using the same safe approach as before (only fills in fields that were empty, never overwrites anything already there). 1,812 remain genuinely unresolvable — barcodes with no match anywhere in the master data at all, same story as the earlier round.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## "No department" + "Other" renamed to "Inactive Products"

User asked to rename both labels to "Inactive Products", in both the Dashboard card and the weekly email. Worth noting for the record: this is a display-only rename, not a data fix — checked in the previous entry that neither bucket is actually wrong data (no hidden/missing department anywhere), so nothing about the underlying records changed.

Did this as a real merge rather than two separate find-and-replace label swaps: "No department" and "Other" used to be two different-coloured swatches in the legend. If I'd just changed each swatch's text to "Inactive Products" and left the colours as they were, you'd have ended up with two legend entries reading the same thing in two different colours right next to each other — that looks like a bug, not an intentional design. So both are now one colour and one legend line, in both places:

- **Dashboard** (`DeptCheckByStore` in `Dashboard.jsx`): one merged "Inactive Products" swatch/total. The per-store breakdown text and bar tooltips still show a real department's own name when it's one of the ones folded in for being outside the top 8 (e.g. "STATIONERY 30" still says STATIONERY) — only the literal unattributed `(none)` case now reads "Inactive Products" there too.
- **Weekly email** (`dept-check-weekly.py`): identical shape — one merged legend row, same per-store breakdown behaviour.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Dept Scan now warns on two known sticker codes instead of silently saving them

User asked for the actual list of barcodes with no match anywhere in the master data — pulled all 1,279 distinct ones (1,818 scan records), classified each as a URL/QR code, wrong-length number, letters-only, or valid-length number, and sent it over as a CSV sorted by how often each was scanned.

The top two jumped out on their own: `80575540` scanned 101 times across 29 different stores, `80025750` scanned 15 times across 13 stores. User confirmed what that pattern already suggested — these aren't barcodes at all, they're generic sticker codes printed on the price/shelf ticket of many different products. Scanning the sticker instead of the real barcode was never going to match anything, because there's no single product behind either code.

**Fix:** `DeptScan.jsx` now catches both codes the instant they're scanned, before anything gets saved — red banner, distinct buzz, and a clear message: "Not a real barcode — scan the product's own barcode instead." Logged as a new diagnostic event type too, so if this becomes a pattern with other codes, it's visible going forward rather than something that only turns up months later in another CSV export.

Didn't touch the ~1,816 already-saved records carrying these two codes — purely cosmetic at this point, no reason to spend a backfill on it. The fix is forward-looking: stop it from happening again, starting now.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## URLs, "RB" reduced-barcode stickers, and the double/triple-scan question answered with data

Three more asks in one go.

**Don't scan URLs.** Same treatment as the sticker codes — 141 of the earlier CSV export were QR codes (recycling info, manufacturer websites), not barcodes. Now rejected the same way: red banner, "that's a website link, scan the product's own barcode," nothing saved.

**"RB" codes are reduced/clearance stickers.** Confirmed: `RB101-09-188-00` means the real product code is `101-09-188-00` — the "RB" is just marking it as a reduced-price sticker. The app now strips "RB" automatically, looks the product up and saves the record using the real code (so it matches properly and doesn't create a new "unmatched barcode" problem), and keeps the full original code (with "RB") visible — both on the Reports side (shows as "Reduced Barcode: RB101-09-188-00" automatically) and right there on the scan screen as a small blue tag.

**The double/triple-scan question — checked the actual data instead of guessing.** You asked whether this predates the new department scan page. It does, and here's the proof: looked at every case of the same barcode scanned again at the same store within 10 minutes, going back 3 weeks — 12,145 of them. Almost all were spaced MORE than 3 seconds apart (a real re-scan, not someone's finger slipping on the trigger). That's exactly the gap the OTHER Claude session's fix from earlier today (deployed around 3pm) was built to catch — walk the aisle, scan a product, scan a few more, come back and accidentally scan the first one again. Broken down by hour: it was running at roughly 150-300 an hour right up until that fix went out, then dropped to 54 the next hour, then 13 the hour after. So yes — this really was happening, and it's already fixed, not just theoretically.

**Separately, "half scanned" (short/truncated barcodes)** — checked this too since it sounded related, but it isn't the same thing. Its rate stayed exactly the same both before and after today's fix (tracks total scan volume all day), so it wasn't touched by the duplicate-scan fix at all. This looks like a different, still-ongoing problem — most likely a scanner gun capturing a barcode too fast and only grabbing part of it. Can't trace which specific gun/store from historical data (the device-tracking system only started today), but worth watching going forward if it keeps coming up.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## RB1, not RB — and why "only accept a full barcode" would do more harm than good

Quick correction plus one thing checked before building it.

**RB1, not RB.** Fixed the prefix — `RB101-09-188-00` now correctly strips to `01-09-188-00`, which is the real, valid product code. The earlier "RB" version was stripping one character too few and would never actually have matched a product.

**Checked whether Dept Scan can reject anything that isn't a "full" barcode**, to stop truncated/partial scans before they save. Before writing that, pulled every barcode length that's currently resolving successfully to a real product — and found genuine, correctly-scanned products as short as 6 digits (a whole line of Pet Food products use 6-digit codes) and some legitimate 11-digit ones too (already-known, already-handled). So barcode length in this business's data runs anywhere from 6 to 14 digits — there's no length cutoff that would catch only the bad scans without also blocking hundreds of real, correct ones every day. Left it alone, as asked ("leave it if it is not possible") — a scan that doesn't match anything in the product data still ends up flagged as Inactive Products, which remains the only safe way to catch a truncated read.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Also blocking scans with no digit in them

Third thing added to the "not a real barcode" rejection: any scan that's pure letters (no digits at all) now gets blocked with the same message as the URL and known sticker-code cases. This covers garbled reads like "MAENCHNA" or "CHARCOAL" that showed up in the earlier barcode audit — 73 of them. Every real code this business uses has at least some digits in it, so this one's safe to reject on sight, same confidence level as the other two.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Checked the 15-digit cap against real data first — good thing, it was wrong

You asked to block anything over 15 digits (your estimate of a max outer-box barcode). Checked your actual product data before building it, since guessing wrong here means blocking real products, not just junk.

Turned out 15 would have broken real scanning: three products you're currently selling right now use 16-digit barcodes — STACIE DOLL, COLOUR CHANGE MERMAID, and B&D HAMMER DRILL 18V. Nothing in your whole product file goes past 16, though. So the cap is set at 16 instead of 15 — catches the same junk (garbled 20+ digit reads), same message as the other blocks, but doesn't touch any real product you actually stock.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## D1 archive size now shows under the Supabase database bar in Settings

The Department Check archive (a separate Cloudflare database, D1, that older records move into) has its own storage limit that Settings never showed — only the Supabase numbers were ever on that page.

Added a new meter right under the Supabase database bar, showing how much of D1's space is used and how much is left, same style as the existing bars. Renamed the card "Database capacity" since it's no longer just Supabase.

**One thing to check after this deploys:** getting D1's size requires the site's existing Cloudflare API key to have "D1 read" permission, which it might not have been given originally (it was set up for a different purpose — daily request counts). If the new D1 bar shows "unavailable" instead of a number, that's the fix needed — in the Cloudflare dashboard, edit that API token and add D1 read access. Nothing else on the page is affected either way; the Supabase bars keep working regardless.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Why the database doubled, and why old records aren't moving to D1

Two questions after the D1 meter started working. Investigated both with real queries, no guessing.

**Why the DB grew.** Broke it down table by table. The two biggest are `task_records` (live scans) and `alt_barcodes` (your product catalog file) — expected. The real reason it doubled isn't a leak: your daily scan volume itself roughly doubled to tripled over the past month (5,000-9,000/day in late August → 15,000-33,000+/day by late September). Since the app keeps a fixed *number of days*, not a fixed *number of records*, more scanning per day means more data sitting in that same window. That's not a bug, it's just more usage than there was before.

**Why "any status" isn't reaching D1 after 14 days.** Checked the actual rule running in the database right now — it's already exactly what you want, no status is excluded, any status moves after 14 days. The real problem: a separate piece (the "archiver") is supposed to copy aging records to D1 every night and confirm it, and only then are they allowed to leave. That confirmation has **never once happened** — not for a single record, ever, since this was built. So everything just sits there waiting for a green light that's never come.

I can't fix this myself — it's a completely separate deployment with its own login credentials I don't have access to. Two things to check when you get a chance:
1. In the Cloudflare dashboard, under Workers & Pages, is there a Worker called `homesavers-archiver` listed at all?
2. Cloudflare dashboard → Workers & Pages → D1 → `homesavers-archive` → Console tab → run: `SELECT * FROM archive_runs ORDER BY started_at_ms DESC LIMIT 20;` — this tells us whether it's never run, or running and failing (and why).

Let me know what either shows and I'll walk you through the fix from there.

**Also done: moved the new device-activity log to D1.** This was the one table safe to move without any risk to speed — nothing in the app ever reads it back, it's purely a write for diagnostics. Same idea as the archiver: it now writes into the same D1 database instead of Supabase, at zero extra cost to the store (still exactly one request from the device either way). This needs one manual step to actually take effect — running a database-setup command against D1, which I've documented but can't run myself from here (see `d1-migration-device-log.sql`'s header for the exact command).

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Charleville's duplicate-scan report — confirmed real, not just a one-off

Checked properly instead of assuming the earlier fix (from two days ago) already covered this. It didn't, fully — found genuine duplicate records still happening chain-wide as recently as today, not just at Charleville.

**What was actually happening:** the app only remembered "I've already scanned this today" AFTER the save for that scan finished talking to the server. If someone scanned fast, or the wifi was a bit slow, a repeat scan of the same product could sneak in before the first one had finished saving — so the app didn't yet know to say "you already scanned that."

**Fixed:** it now remembers a scan the instant it's taken, not after it's saved. A genuine save failure still lets you re-scan normally (that part hasn't changed) — only a real duplicate now gets caught, and it gets caught immediately regardless of how slow the connection is.

**One thing this does NOT cover, on purpose, worth knowing about:** this "have I seen this before" memory only exists on one device, for one continuous session. If the page reloads (or someone switches to a second scanning gun at the same store), that memory resets — there's no way for one gun to know what another gun scanned, or for the app to remember past a reload. That's true today and true after this fix. If duplicates keep happening because of *that* specific pattern rather than the timing issue just fixed, it would need a bigger change (having the server itself check for very recent duplicates, rather than relying on the device to remember) — let me know if that's worth doing.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Local-PC rebuild runbook

Wrote up, in `docs/local-pc-rebuild-runbook.md`, exactly how every process that currently runs from the affected local PC actually works — so it can be rebuilt from the GitHub codebase alone once that machine is cleared, without relying on anyone's memory of how it was set up.

Covers all 5 data syncs (prices, alt-barcodes, the B&M daily file, the CN-code master list, the delivery manifest), the 3 scheduled report emails, and the local upload helper — what each one reads, where it sends it, when it runs, and which Windows scheduled task drives it. Also lists exactly which secrets/credentials live only on that PC (not being rotated right now, per the standing security note), what software needs to be installed again, and — importantly — which parts of the system were never affected at all and kept working the whole time (the live site, the background archiving job, and all the Supabase/D1 data).

Found two small inconsistencies in the existing setup notes while writing this up (left as-is, just flagged in the runbook, since they're about the local PC's configuration, not the live app): one email's documented send time doesn't match between two setup docs, and one scheduled job's instructions point at the wrong folder copy of its script.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Website disaster-recovery guide (separate from the local-PC runbook)

You asked how to recreate the website from zero if the local PC situation turned out worse than it is — this is a different question from the local-PC runbook above, which only covers the background jobs on that PC. This new one is about the actual website, database and hosting.

Wrote `docs/website-disaster-recovery-guide.md` and sent you a copy directly too, so you have it saved somewhere outside GitHub as well. It lays out: the 4 accounts that make up the entire system (GitHub, Cloudflare, Supabase, Brevo) and what each one does; step-by-step instructions to rebuild each one from nothing if it ever came to that; where every secret/password is configured today (by name and location only — deliberately **no actual secret values** are written down anywhere in this file, in GitHub or otherwise); and one short checklist of things worth doing today, while normal access still works, to make this plan actually usable later.

Worth being clear: nothing needs rebuilding right now. The live site, Supabase, and Cloudflare are all completely unaffected by the PC issue — this document is purely a "just in case everything were lost" plan, not an active task.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Store Dashboard now shows its own department breakdown bars

Added the same "Department Check records by department" bars store staff's own Dashboard now shows too — same colours and legend as the back-office one, just without a store name label (since it's only ever their one store) and sitting right above Recent activity, as asked.

Found one thing that needed fixing along the way: the data behind this was previously locked to back-office logins only at the server level — a store login asking for it got refused outright. Opened that up; a store login now only ever gets back its own store's numbers, the same protection every other part of the app already relies on, so nothing about who can see what changed except that store staff can now see their own department split.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Confirmed: Qilin ransomware, PC fully wiped — phased plan to put everything back

Confirmed what happened: Qilin ransomware. The PC has been formatted and set up as a brand-new machine — meaning it's clean now, but also completely empty. No codebase, no scheduled jobs, no saved passwords for any of the sync/email scripts. Everything that used to run from that one PC needs rebuilding from scratch.

The app itself was never affected and store staff can keep scanning normally the whole time this is being rebuilt — only the behind-the-scenes jobs (the daily price/barcode updates, the three report emails, the delivery manifest, the CN-code list) need putting back.

Wrote `docs/post-wipe-restoration-plan.md` — a step-by-step order to do this in, starting with the two things that matter most (the price and barcode updates, since those feed what staff actually see when scanning), then the daily data files, then the delivery manifest, then the three emails, then the least-urgent diagnostic tool last. For passwords: since everything has to be typed in fresh on the new PC anyway, this is a sensible moment to set new ones rather than trying to reuse the old ones (some of which Cloudflare won't even let us look up again) — the plan covers exactly which ones to change and which to just carry over as-is.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Restoration plan restructured — the 3 most urgent files grouped first

You flagged that getting Item Master (prices), the Alternate Barcode file, and the B&M Daily file pushed back up manually matters more than anything else in the plan — restructured it to put that front and center.

Those three are now one single, clearly-marked urgent phase, done by hand, as soon as the one password they both need is back in place — not waiting on any of the automated scheduling to be rebuilt first. Everything else (CN-codes, the delivery manifest, the report emails, the diagnostic upload tool) comes after, and setting up all the automatic scheduled runs for everything is now its own single step at the end, once every job has been proven working by hand at least once.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phase 1 started — one setup script for the new PC

Wrote `scripts/setup-new-pc.ps1`. Run it once on the new PC (after cloning the repo to `C:\Apps\HomesaversScanner`) and it installs or checks everything Phase 1 needs, then prints a PASS / WARN / FAIL list. FAIL means it would block the urgent uploads; WARN means it's only needed later.

It also shows the newest Item Master, Alternate Barcode and B&M Daily file it can see on the file server, so you'll know straight away whether that server is still producing fresh files after the attack.

Two problems found and fixed on the way:
- The deploy step would **not** have copied the B&M Daily and CN-code scripts onto a fresh PC (they used to be kept only on the old PC). B&M Daily would have failed. They're now copied like everything else.
- The B&M Daily upload needs **Microsoft Excel installed** on the PC. The earlier notes named the wrong prerequisite; corrected.

One risk: the old PC's copies of those two scripts may have had small edits that were never saved to GitHub. The GitHub copies are all we have now. If B&M or CN-codes behave differently from before, check that first.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phase 3 first try: the uploads couldn't find Python — fixed

The first Item Master upload on the new PC didn't run at all. The script was still looking for Python where it lived on the old PC (under the old Windows user's folder), and the new PC has it somewhere else. Fixed: the setup script now writes down exactly where Python is, and the upload and manifest scripts use that. The upload's first line now also shows which Python it's using, so this is easy to spot if it ever happens again.

For reference, before Phase 3 every job's last good run was 28 Oct, so stores have been scanning against 12-day-old prices and barcodes.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phase 3 done: today's prices, barcodes and B&M file are live

All three urgent uploads ran by hand on the new PC, and each was checked in the database:
- **Item Master:** today's file, 101,980 prices, all fresh.
- **Alternate barcodes:** 214,746 barcodes, all fresh. The newest file available was from **5 Nov**, though. Run it again later today or tomorrow; if it still picks a 5 Nov file, whoever produces that export should check it.
- **B&M Daily:** today's file, 14,213 products.

Stores have been scanning against 28 Oct data for 12 days; they're now on today's prices. These still need running by hand each day until the scheduled tasks are rebuilt in Phase 8.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phase 4 done: CN-code list live again

The CN-code list was reloaded on the new PC: 43,061 codes, 7 more than on 28 Oct. It needed no browser login after all, just a one-line file (the plan has been corrected).

Flagged for whoever looks after the CN-code app (not our app): it treats a fixed label as an admin login, over unencrypted http, on a public IP. Its port should only accept connections from the office network.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Delivery manifests now come from B&M's SFTP, not the U: drive

As you asked, the manifest script now downloads the delivery files directly from B&M's SFTP server. It keeps each file's original date, so it only builds manifests for new deliveries and doesn't rebuild old ones. It skips any file B&M is still uploading, and it remembers the server's identity, refusing to connect if that ever changes.

The SFTP password is saved only on the PC, never on GitHub. The first step is a one-off search to find which folder on the server holds the delivery files; that folder then gets set in the script.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Manifest: using the Buying Data share for now, SFTP on hold

As you asked, the manifest script now reads the delivery files from `B:\Supply Chain\005 - Reports\04 - H1 Declaration Manifest\02 - Manifests - Homesavers\HSVMAN FILES- MANIFEST` and saves the manifests into its `Store Manifest` subfolder. It uses the share's network path first, so it will keep working when it's run as a scheduled task with no B: drive. The `Store Manifest` folder is created automatically the first time.

The SFTP download is built and tested but switched off. To finish it, we need the SFTP server's internal address from the router's port-forwarding rule for 2222. The SFTP password is already saved on the PC.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## SFTP server found: 192.168.1.77, port 22

From inside the office, the SFTP server answers on its internal address `192.168.1.77`, port 22. Port 2222 is only for outside users, through the router. With the folder you gave (`Inbound File\Delivery Manifest`), these are now the script's defaults. SFTP stays switched off until a test confirms the login and that the delivery files are there; until then, manifests keep using the B: folder.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Manifests now come straight from the SFTP server

The login test worked: 20 delivery files are on the SFTP server, from 29 Oct to today. As you confirmed, the manifest script now downloads them directly from the SFTP server, so nobody has to copy them into B: any more. The finished manifests still go into the `Store Manifest` folder on B:.

29 and 30 Oct had deliveries too, and they don't have manifests yet. I've given you the command to build any that are missing.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Manifest job now keeps a copy of the original delivery files on B:

As you asked, every time the manifest job downloads delivery files from SFTP, it also saves the original files into `B:\Supply Chain\005 - Reports\04 - H1 Declaration Manifest\02 - Manifests - Homesavers\HSVMAN FILES- MANIFEST`. The copies keep their original dates. Files already in that folder are never overwritten. A dry run doesn't copy anything. If B: can't be reached, the manifests are still built and the log shows a warning.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phase 5 done: every delivery since 28 Oct has a manifest

All 20 deliveries on the SFTP server, from 29 Oct to today, now have manifests in the `Store Manifest` folder. Every one matched 100% against the Item Master. The original delivery files are all in the `HSVMAN FILES- MANIFEST` folder too.

From now on, the normal run only picks up new deliveries. It'll run on its own once the scheduled tasks are set up in Phase 8.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phases 8 and 7: one installer sets up every scheduled job

New `scripts/install-scheduled-tasks.ps1`. Run it once on the PC and the jobs run on their own again, at the times they used to run before the attack:

- CN-code list: 02:45
- Item Master (prices): 07:00
- Alternate barcodes: 07:30
- B&M Daily: 08:15
- Delivery manifests: every 30 minutes, 07:05 to 19:05
- Upload server (for the Manual Upload buttons): whenever you log in

The `buying 1` user needs to stay logged in, though a locked screen is fine, because the B&M upload uses Excel, which only works while someone is logged in. If the PC was off at a run time, the job runs as soon as it's back on.

The three emails get added once their logins are sorted (Phase 6).

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phases 7 and 8 running; Phase 6 (emails) ready to set up

The scheduled jobs and the upload server are installed and running on the new PC. I'll check tomorrow at 09:00 that everything ran on its own overnight (Phase 9).

For the three report emails, a new helper (`scripts/setup-email-configs.py`) asks you questions and creates the config files, so you don't edit any files by hand. It checks the Brevo login before saving anything.
- **Aging report:** recipients filled in from our records.
- **Weekly Department Check:** the old recipient list was only on the wiped PC, so you'll need to enter it.
- **Area-manager emails:** each manager's address comes from Admin → Employees, as before.

Running the scheduler installer again then adds the four email tasks: aging report Wednesday 08:00, weekly check Monday 09:00, area-manager emails Monday and Thursday 08:00.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Records checked against the latest product files

You asked for every Department Check and every pending record to be checked against today's product files, with product and barcode status brought up to date.

- **Blank records filled:** 3, the only ones today's files can fill. That's 2 Department Checks from 7 Nov (now showing STATIONERY) and 1 Non-Scan. The other blanks are scans that genuinely aren't in the product master, such as labels, misreads and web links.
- **Product status updated:** 10 records changed from Inactive to Active. Barcode status was already correct everywhere.
- **Checked afterwards:** all 226,529 live records now match the latest files on product status, barcode status and department.
- **Product names left alone:** the latest file adds " *" to the end of about 5,200 product names. You only asked for statuses, so record names stay as they were when scanned.
- **Archive (older Department Checks):** nothing to fix. None of its blanks can be filled, and every archived record is from before the product files went out of date.

The report emails are on hold until you get the Brevo reset email.

Full write-up in `Project_Status.MD` §11.

---

## Text typed before barcodes and RB2–RB9 stickers: records and scanner fixed

As you approved, two kinds of scans that used to come in blank are now handled:
- **Reduced-price stickers starting `RB2` to `RB9`**, and ones with two digits after RB like `RB15…`. Before, only `RB1` was understood, and even that went wrong for the two-digit ones.
- **Text or symbols in front of a barcode**, like `Mm5025970022918` or `I'm8006540818824`, or the scanner's own `]C1` prefix.

**Records fixed:** 219 in the live records (all Department Checks except 1 Wrong Price) and 578 older Department Checks in the archive. Every Department Check got its department. The original scan is kept on each record, and stickers also show "Reduced Barcode", the same as RB1.

**Scanner fixed:** new scans like these now come in with the right product straight away. It only uses the cleaned-up code when the scan doesn't match as typed and the cleaned code is a real product. Label codes and other junk still come in blank, as before.

Pushed and merged to `main`; the website updates automatically. Full write-up in `Project_Status.MD` §11.

---

## Email setup: the Brevo login failed, and the helper now catches the likely cause

The first email setup attempt failed at the Brevo login, and as designed, nothing was saved. The most likely cause: on Windows, **Ctrl+V doesn't paste into the hidden key prompt**. It types an invisible character instead. The helper now spots that and asks you to paste with **right-click**. It also shows how many characters it received, and warns if an API key was pasted instead of the SMTP key.

The scheduled tasks for the syncs, the manifest and the upload server are all installed. The four email tasks get added once the email setup succeeds.

Pushed and merged to `main`. Full write-up in `Project_Status.MD` §11.

---

## Phase 9: everything ran on its own overnight, but the source files are arriving late

First night on the new PC with no one touching it:
- **CN codes ran at 02:45, Item Master at 07:00, alternate barcodes at 07:30, B&M Daily at 08:15.** All succeeded, with the same row counts as yesterday. The scheduling works.
- **The data is a day behind.** All three files the jobs picked up were from **9 Nov**, because today's hadn't arrived yet. Before the attack, today's file was almost always there by 07:00. Yesterday they arrived at 10:53, 15:57 and 16:22, so the exports that produce them seem to be running late since the attack.
- **Manifests:** none built yet this morning, which is normal before the morning's deliveries arrive.

The report emails are still waiting on the Brevo SMTP key.

Full write-up in `Project_Status.MD` §11.

---

## Email setup: the Brevo login failed again, so the helper now shows exactly why

With the full 90-character key the login still failed, with the same "Invalid syntax (unable to parse)" answer. That answer isn't "wrong key". It means Brevo couldn't read how the login was sent. Python tries three login methods one after another and only shows the last error, which hid the real cause.

The helper now tries each login method separately and prints what Brevo answered to each one. It also shows who issued the secure connection's certificate. If that isn't Brevo, antivirus "email scanning" on this PC is getting in the way, and the helper says so. As soon as one method works, it's saved, and all three report emails use that method from then on. It also catches invisible characters that can come along when a key is copied from a web page. The key itself is never shown.

Next on the PC: `git pull`, run `scripts\deploy-scripts.ps1`, then run the email helper again. If it still fails, send the lines it prints (they contain no secrets).

Full write-up in `Project_Status.MD` §11.

---

## Email setup: cause found. Brevo is blocking the office's internet address

The new check gave a clear answer. Brevo replied **"Unauthorized IP address"** to every login method. Your login and key are correct, and nothing on the PC is interfering. Brevo's **Authorised IPs** setting only allows logins from approved addresses, and the office's address (93.107.17.189) isn't approved.

**Fix (in Brevo):** profile menu (top right) → **Security** → **Authorised IPs** → add `93.107.17.189`. You can also approve it from Brevo's "new IP address" email if one arrived. Then run the email helper again.

The helper now recognises this error and gives these steps itself.

---

## Report emails: Brevo works; only the Aging Report goes out automatically

After the office IP was added in Brevo, the email helper logged in OK and saved the three email settings files.

As you asked, the two **Department Check emails** (the weekly one to Jeff's list, and the area-manager ones on Monday and Thursday) **are not switched on**. Department checks now follow a schedule rather than running every week. The task installer now leaves them out, and removes them if they were added before. Only the **Aging Report** (Wednesday 08:00) is scheduled. You can still test-send all three by hand. When you share the department check schedule, I'll set those two emails to follow it.

---

## Email test sends said "Config not found": the helper hadn't finished

The email helper only saves its settings files at the very end, after all its questions are answered. The run stopped after "Brevo login... OK", so nothing was saved. It was waiting for the weekly Department Check list, which you don't have yet. That list can now be left blank, since the email is paused. The helper also says "Not finished yet" after the login check, and "Done - all three settings files saved" at the end.

---

## Changing the Supabase database key (the old one was on the attacked PC)

The website, the nightly archiver and the area-manager email all use one Supabase key to reach the database. Changing the old-style key directly would take the website down until everything was updated. Instead we switch to Supabase's new-style **secret key**, one place at a time, and only switch off the old key at the end. The code now accepts both kinds, so there is no downtime. Supabase is retiring the old keys at the end of 2026 anyway.

**1. Create the new key (no effect yet).** Supabase → project → Project Settings → API Keys → "Publishable and secret API keys" tab → *Create new API keys* if shown → copy the **secret** key (`sb_secret_...`).

**2. Check the new code is live.** Open `https://homesaversscanner.pages.dev/api/ping`. It should show `"rev":"2026-11-10-new-supabase-keys"` and `"dbKey":"legacy"`.

**3. Website.** Cloudflare → Workers & Pages → homesaversscanner → Settings → Variables and Secrets → `SUPABASE_ANON_KEY` → Edit → paste the secret key → Save. Then Deployments → latest → ⋯ → Retry deployment. When that finishes, `/api/ping` should show `"dbKey":"secret"`. Log in and scan one product to check.

**4. Archiver (nightly copy to the archive).** On the PC: `winget install OpenJS.NodeJS.LTS`, open a new PowerShell, `cd C:\Apps\HomesaversScanner\workers\archiver`, `npx wrangler login`, `npx wrangler deploy`, `npx wrangler secret put SUPABASE_ANON_KEY` (paste the secret key with right-click).

**5. Email helper.** Run the email helper again and paste the secret key when it asks for the Supabase key.

**6. Switch off the old keys.** Supabase → Project Settings → API Keys → "Legacy API keys" tab → disable them. If anything breaks, you can switch them back on from the same place. Then check the site again.

**7. Next morning.** Check that the archiver ran at 01:30. Claude can check this.

---

## On hold: the database key switch and the email setup

Both are waiting until you have time. Nothing has changed for the stores: everything still uses the old key, and the new code works with either one.
- **Key switch:** follow the steps above, ideally after the stores close. It has to be done before the end of 2026, when Supabase retires the old keys.
- **Emails:** the helper no longer needs the Supabase key. Press Enter to skip it. The Aging Report doesn't use it, and the area-manager email is paused. So you can finish the Aging Report email without touching the key: run the helper → test send → run the task installer.

---

## B&M Daily now comes straight from the SFTP server

The B&M Daily file is now taken from the SFTP server (`Inbound File\Product File`) instead of the Excel file on the shared drive. Every 30 minutes from 07:00 to 12:00, the PC checks for a new product CSV. When one arrives, it:
- saves the CSV unchanged to `B:\Supply Chain & Buying - Shared\Data\Product File CSV`
- builds the usual `HomeSavers_YYYYMMDD.xlsx` in `B:\...\B&M Product File Excel\2026`, matching the old file column for column (checked against your 9 Nov file: identical)
- updates the scanner app

If an Excel file for that date already exists, it's left alone. If today's file still hasn't arrived by 11:30, Admin → Settings → Data Sync shows a failure saying so. A file that looks broken (far fewer products than usual) is refused, and the current data stays. Excel no longer needs to be installed for this job, and no window pops up.

The old Excel-based job is kept as a manual backup: `run_sync.bat bm-daily-excel`.

---

## Item Master / alternate barcode syncs: removed a harmless warning

The Item Master sync printed a "DeprecationWarning: datetime.datetime.utcnow() is deprecated" message. It was only a notice from the newer Python on the rebuilt PC, and it never affected the sync. Both scripts now use the newer form, and the timestamp they send is exactly the same as before.

---

## 10 Nov: Item Master re-synced with today's file

The Item Master was synced by hand at 11:15 with `ItemMaster_2026_11_10 VRS.xlsx` (today's file; the 07:00 run had used 9 Nov). Checked on the server:
- 101,980 products imported, 1 skipped
- every product was refreshed by this run, nothing stale left over
- none is missing a price

Alternate barcodes are still on the 9 Nov file.

---

## B&M files from 28 Oct: filling in only the missing days

This is a one-time job that fills the gaps in the two B&M folders from the files still on the SFTP server. It first checks `Product File CSV` and `B&M Product File Excel\2026`, then fetches and saves only the days whose CSV or Excel is missing. Files already there are left alone. The app is not changed: nothing is uploaded and the daily sync isn't affected. Add `--dry-run` to only list the missing days.

---

## 10 Nov: B&M backfill done

The one-time fill-in from 28 Oct finished on the PC. The app was checked afterwards and is unchanged: the B&M list is still today's 14,131 products from `HSVPRD20261110060002.CSV`, and no new sync run was recorded. From now on, the 07:00–12:00 job saves each new day's CSV and Excel automatically.

---

## Why the database shows 72% full

It's the Department Check scans. From 2 to 8 Nov stores logged 17,000–31,000 a day, but the nightly job that moves old records to the archive can only move about 18,000 a night. The rest are waiting in the main database. Nothing is lost.

Now that Department Checks follow a schedule (9 Nov: 8,700; today so far: 3,000), the archive job should catch up in about 10–11 nights and the figure should come back down. Claude will keep an eye on it. If it ever needs to go faster, a third nightly run can be added in Cloudflare with no code change.

---

## Archive: a third nightly run that only uses the allowance left over

The archive job now has a third run at 22:30 (Irish winter time). It first asks Cloudflare how many of the day's 100,000 archive writes have been used, keeps 10,000 spare, and moves only as many records as the rest allows. That's up to about 11,000 a night, on top of the usual 18,000. It never deletes anything, and if it can't read the usage it does nothing.

It goes live once the archive job is redeployed from the PC. That needs Node, plus a Cloudflare API token that can read analytics. The steps are in the reply of 10 Nov and below:
1. Cloudflare → My Profile → API Tokens → Create Token → Custom token → permission **Account → Account Analytics → Read** → this account → Create. Copy the token.
2. On the PC: `winget install OpenJS.NodeJS.LTS`, open a new PowerShell, `cd C:\Apps\HomesaversScanner\workers\archiver`, `git pull`, `npx wrangler login`.
3. `npx wrangler deploy`
4. `npx wrangler secret put CLOUDFLARE_API_TOKEN` (paste the token with right-click).

The stores aren't affected; this job only runs at night.

---

## 10 Nov: archive third run deployed

The archive job was redeployed from the PC (`wrangler deploy`), and the token `homesavers-archiver-d1-usage-read` was added as its `CLOUDFLARE_API_TOKEN` secret. Checked from here: the live job is the new version, including the 22:30 run and the allowance check. The first extra run is tonight at 22:30. It also uses the new key handling, which works with the current Supabase key.

Note for this PC: Node is installed but isn't on the PATH in older PowerShell windows. Either restart the PC, or run `$env:Path += ";C:\Program Files\nodejs"`, then use `npx.cmd wrangler ...` from `C:\Apps\HomesaversScanner\workers\archiver`.

---

## Nightly app backup to B:

Every night at 03:00 the PC backs up everything needed to rebuild the app into `B:\Supply Chain & Buying - Shared\HomesaversScannerBackup`:
- the database
- the Department Check archive (weekly, on Sundays)
- all task photos
- the app code
- the PC's settings and schedules

Passwords are never included; they stay in Bitwarden. It keeps 30 days. Each result shows on Admin → Settings → Data Sync → **App Backup**. How to restore is in `README-RESTORE.txt` in that folder, also `docs/backup-and-restore.md`.

Important: because the PC can write to B:, ransomware on the PC could also reach this folder. The real protection is the **NAS snapshots**. Ask IT to keep daily snapshots of this folder for at least 30 days.

One-time setup on the PC: `git pull`, `deploy-scripts.ps1`, `backup-app.py --setup` (paste the Supabase database password from Bitwarden), one manual run, then `install-scheduled-tasks.ps1`.

---

## First backup: everything saved except the archive (fixed, needs one token)

The first backup worked for the database, all 275 photos, the code and the PC settings (38 MB). The weekly archive export was refused by Cloudflare. It now uses its own token instead:
- Name: `homesavers-backup-d1-export`
- Permission: Account → D1 → Edit
- Save it in Bitwarden.

Run `backup-app.py --setup` again to add it (answer Y to keep the database password), then `backup-app.py --force-d1`.

---

## 10 Nov: first complete backup, and what happens to deleted photos

The backup finished OK at 13:42. Checked on the server:
- 38 MB daily backup
- archive exported (53 MB compressed)
- database 30 tables, code, PC settings
- all 275 photos already in the backup's `photos` folder

**Photos removed from the app:** the app deletes task photos after 21 days (Admin → Settings → "photo retention days"). The backup's `photos` folder is **never cleaned**: each night it adds new photos and keeps every photo it has ever copied. From now on, a photo the app deletes stays in `B:\...\HomesaversScannerBackup\photos`, under the same folder path as in the app. The archived records keep their photo link, so the file can be found by that path. Photos deleted before the first backup (anything from before 20 Oct) were already gone and can't be recovered. The folder grows by about 140 MB every three weeks.

---

## Backup photos: kept only one week after the app deletes them

As requested, the backup no longer keeps photos forever. It copies the photos that are in the app, and when the app deletes a photo (after 21 days), the backup removes its copy 7 days later. The backup's `photos` folder therefore stays about the same size as the app's, around 140 MB. If the app ever reports no photos at all, the backup deletes nothing, in case it's an error.

---

## 10 Nov: nightly backup scheduled

`install-scheduled-tasks.ps1` was re-run, and **Homesavers App Backup** is registered for 03:00 every night. Claude's check tomorrow at 09:10 will look at the first scheduled backup, the archive's third run (22:30), and the 07:00 B&M SFTP sync.

Still to do when there's time:
- Ask IT to keep daily NAS snapshots of `HomesaversScannerBackup` for 30+ days.
- Save the new tokens and passwords in Bitwarden (Supabase database password, `homesavers-backup-d1-export`, `homesavers-archiver-d1-usage-read`, SFTP, sync secret).
- Set up the Aging Report email.
- Do the Supabase key switch.
- Share the Department Check schedule.
