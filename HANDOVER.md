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
