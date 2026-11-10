# Homesavers Scanner — Website Disaster-Recovery Guide

*Written 2026-11-02. Save a copy of this file somewhere outside GitHub too
(USB stick, password manager's "secure notes", printed) — that's the whole
point of it: a plan you can follow even if GitHub, Cloudflare or Supabase
access is ever a problem at the same time.*

**This file deliberately contains no actual passwords, keys or secrets.**
Where a secret is needed, it says what it's called and where to find or
regenerate it — never the value itself. See the checklist at the very end
for the one thing worth doing today while you still have normal access.

---

## 0. Where things actually stand right now (2026-11-02)

Nothing needs rebuilding today. The ransomware hit **one Windows PC**
(`C:\Scraping\homesavers-scanner`) that a few background jobs run from.
The live website, its database, and its file storage are **cloud services
with no connection to that PC** — they were never touched and are working
normally right now. This guide is the "what if it ever got worse" plan,
not an active task.

If it's ever the PC-only situation again (most likely case), use
`docs/local-pc-rebuild-runbook.md` instead — that one is about the jobs
that run from the PC (price/barcode syncs, report emails, the manifest).
**This** document is about the website itself: what to do if you ever had
to recreate the whole thing from nothing.

---

## 1. The whole system is 4 accounts

Everything the business depends on lives in four places. If you have
access to all four, you have the entire system — there is nothing else.

| # | Account | What it holds | Why it matters |
|---|---|---|---|
| 1 | **GitHub** — `shayasphilipdev/HomesaversScanner` | All the source code, every page, every past change, and every database-setup script (listed below) | This is the master copy of "how the website is built" |
| 2 | **Cloudflare** (account ID `565191064c74a1e202aa0211133c895d`) | Hosts the live website (Pages), runs its backend code (Pages Functions), stores older/archived scan records (D1 database), and runs one small always-on background job (the "archiver" Worker) | This is what makes the code into a live, working website at `homesaversscanner.pages.dev` |
| 3 | **Supabase** (project ref `eggspkdengnxktwkdwpw`) | The live database — every store, product, user, scan record, task, setting | This is where all the day-to-day business data actually lives |
| 4 | **Brevo** | Sends the scheduled report emails (weekly department check, aging report, area-manager summaries) | Email delivery only — not needed for the website or scanning to work, only for the report emails |

Losing access to #1 (GitHub) is the only one of these that would be hard to
recover from, because it's the only copy of the code. Cloudflare and
Supabase can both be recreated from zero using what's in GitHub (steps
below) — that's the whole reason this guide exists.

---

## 2. If Cloudflare were ever lost or had to be rebuilt

1. Create a new Cloudflare account (or regain access to the existing one —
   try that first, it's much less work).
2. **Pages (the website itself):** create a new Pages project, connect it
   to the GitHub repo above, branch `main`. Build settings:
   - Build command: `cd client && npm install && npm run build`
   - Build output directory: `client/dist`
3. **Environment variables** (Pages project → Settings → Environment
   variables) — these need to be *set again*, not copied from anywhere,
   because Cloudflare never lets you read a past secret back out, only
   replace it:
   - `SUPABASE_URL` — from the Supabase project (step 3 below)
   - `SUPABASE_ANON_KEY` — from the Supabase project (step 3 below)
   - `SESSION_SECRET` — any new long random string (this one simply needs
     to be consistent so existing login sessions don't instantly expire;
     it isn't shared with any other system)
   - `PRODUCT_SYNC_SECRET` — any new long random string, then updated in
     `C:\Homesavers\.sync-secret` on whichever PC runs the sync scripts
   - `D1_ARCHIVE_DATABASE_ID` — the new D1 database's ID (step 4 below)
4. **D1 (the archive database):** create a new D1 database, run
   `d1-archive-schema.sql` (and the other `d1-migration-*.sql` files, in
   any order — they each add one thing and don't depend on each other)
   against it, then bind it to the Pages project in `wrangler.toml` under
   that D1 ID.
5. **The archiver Worker** (`workers/archiver/`): `wrangler deploy` from
   that folder, then `wrangler secret put SUPABASE_ANON_KEY` and
   `wrangler secret put ARCHIVE_TRIGGER_SECRET` (new random value, matched
   into the main Pages project's env vars too, since that's what lets the
   two talk to each other).
6. Point your domain/DNS at the new Pages project if the URL needs to stay
   the same.

## 3. If Supabase were ever lost or had to be rebuilt

**Do this instead of starting from zero, if at all possible:** Supabase
has its own backup/export tools (Dashboard → Database → Backups, or
`pg_dump` via their CLI) — restoring from an actual backup of the real
data is far safer than rebuilding an empty schema and losing every
store/product/user record. Only fall back to the steps below if no backup
exists at all (e.g. a brand new project with nothing to restore).

1. Create a new Supabase project.
2. Run `supabase-schema.sql` first — this is the base set of tables.
3. Run `supabase-functions.sql` — the stored database functions the app
   calls directly (dashboard stats, etc).
4. Run every `supabase-migration-*.sql` file in the repo root. Most of
   these only add a column, an index, or a small adjustment to something
   already created in step 2, so running all of them is safe even if the
   exact order isn't obvious — none of them deletes data. (They were
   written and applied one at a time over several months; there's no
   single authoritative "run in this exact order" list, which is exactly
   why a real backup, if one exists, is the better option.)
5. Create the storage bucket `task-photos`, set it to public-read.
6. Copy the new project's URL and anon key into Cloudflare's environment
   variables (see step 3 above) and into the local PC's sync-script
   configuration if those are still in use.
7. This is a **brand-new, empty database** unless restored from a backup
   — every store, product, user and historic record has to either come
   back from a backup or be re-entered/re-imported from whatever source
   files exist outside the database (the daily product-master workbook,
   the stores list, etc).

## 4. If GitHub itself were ever lost

This is the one piece that can't be rebuilt from "the other three" — the
other three only ever get rebuilt *from* GitHub. The only real protection
is a second copy of the code somewhere else: a clone on a machine that
isn't the affected PC, or a second remote (GitLab/Bitbucket mirror, or
even just a zip of the repo saved to cloud storage) kept reasonably
up to date. Worth setting up once, costs nothing to maintain.

---

## 5. Secrets inventory — names and locations only

| Secret | Where it's configured today | Needed for |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Cloudflare Pages → environment variables; the `homesavers-archiver` Worker; `dept-check-area-managers.config.json` (`supabase_anon_key`); also `.dev.vars` for local dev | Every API call the website makes to the database. Since 2026-11-10 it holds a Supabase **secret key** (`sb_secret_...`) despite the name; the code sends non-JWT keys on `apikey` only. The legacy anon key also still works. |
| `SESSION_SECRET` | Cloudflare Pages → environment variables | Signing login tokens |
| `PRODUCT_SYNC_SECRET` | Cloudflare Pages → environment variables, and `C:\Homesavers\.sync-secret` on the PC | Letting the PC's sync scripts talk to the website |
| `ARCHIVE_TRIGGER_SECRET` | Cloudflare Pages env vars + the archiver Worker's own secret store | Letting the archiver Worker talk to the website |
| Cloudflare API token | Wherever you saved it when you set up the D1 capacity meter | Reading D1 usage stats in Admin → Settings |
| Brevo SMTP credentials | Three separate `*.config.json` files on the PC (not in GitHub — git-ignored on purpose) | Sending the report emails only |

**None of these values are rotated right now** — that's a deliberate,
already-made business decision because the affected PC isn't cleared yet
and rotating would break jobs that still need to run from it. Don't change
any of the above without checking first; see the SECURITY NOTICE at the
top of `Project_Status.MD`.

---

## 6. Do this today, while access is still normal

This document is only useful if you can actually get at the real secret
values when you need them. Right now, while Cloudflare and Supabase access
both work fine:

1. Open Cloudflare Pages → the project → Settings → Environment variables,
   and save a copy of the variable *names* you see there (not values — Cloudflare
   won't show you the values either, only lets you set new ones) somewhere
   safe, so you know what needs to be re-created if this project is ever
   lost.
2. Open Supabase → Project Settings → API, and save the project URL and
   anon key into a password manager or secure note. These two are the only
   values here that Supabase *will* show you again later if needed, so this
   step is the most useful one to actually do.
3. Make sure at least one other person (or a cloud backup) has GitHub
   access to this repo besides the affected PC, per §4 above.

---

*For local-PC-specific processes (the daily syncs, report emails, delivery
manifest), see `docs/local-pc-rebuild-runbook.md`. For the current
ransomware situation and standing rules while the PC is uncleared, see the
SECURITY NOTICE at the top of `Project_Status.MD`.*
