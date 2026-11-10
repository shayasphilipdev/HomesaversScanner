# Homesavers Scanner — app backup and restore

Written 2026-11-10, after the Qilin ransomware attack on the back-office PC.

## What protects what

| Threat | Protection |
|---|---|
| The PC is lost or wiped | The nightly backup on B: (this folder) |
| **Ransomware on the PC** | **Snapshots on the B: server (NAS)**. The PC can write to B:, so ransomware could encrypt this folder too. Only the server's read-only snapshots survive that. Ask IT to keep daily snapshots of this folder for at least 30 days, ideally with an off-site copy. |
| A Supabase or Cloudflare account problem | The database and archive exports in this folder |
| A GitHub account problem | `code.bundle` in every daily folder |
| Lost passwords | **Bitwarden.** Passwords are never in this backup. |

## What is in the backup folder

`B:\Supply Chain & Buying - Shared\HomesaversScannerBackup\` holds:

- **`daily\YYYY-MM-DD\`** (the last 30 days):
  - `database.dump`: everything in the Supabase `public` schema (tables, data, functions, views, triggers, indexes, grants).
    - Product-master tables are saved as structure only: `prices`, `alt_barcodes`, `bm_daily_file` and `cn_code_master`. Re-sync them from the daily source files after a restore.
  - `database-schema.sql`: the same structure as readable SQL.
  - `cron-jobs.csv`: the 10 nightly database jobs (pg_cron). These live outside `public`, so they are not in the dump.
  - `storage-buckets.csv`: the photo bucket's settings.
  - `code.bundle`: the full git repository, every branch.
  - `pc-settings.zip`: the following, with secret files left out and passwords in `.json` files blanked:
    - `C:\Homesavers` settings
    - the deployed scripts
    - the email recipient lists
    - the scheduled tasks as XML
  - `MANIFEST.txt`: file sizes and SHA-256 checksums, table counts, and any problems.
- **`d1\YYYY-MM-DD-archive.sql.gz`**: the Department Check archive (Cloudflare D1). Exported weekly on Sundays; the last 8 are kept.
- **`photos\`**: a copy of every task photo. Only new photos are added, and photos are never deleted from here.

The job is **Homesavers App Backup**: daily at 03:00 on the back-office PC, running `C:\Homesavers\scripts\backup-app.py`. Its result shows on Admin → Settings → Data Sync → **App Backup**. Log: `C:\Homesavers\logs\backup-app.log`.

## Setting it up on a (new) PC

1. Run `scripts\setup-new-pc.ps1`, then `scripts\deploy-scripts.ps1`.
2. Run `& (Get-Content C:\Homesavers\python-path.txt) C:\Homesavers\scripts\backup-app.py --setup`. This:
   - downloads the PostgreSQL 17 tools into `C:\Homesavers\pgsql`
   - asks for the **Supabase database password** (from Bitwarden) and saves it to `C:\Homesavers\.supabase-db-password`, on this PC only
   - tests the connection
3. Run `backup-app.py` once by hand and check `MANIFEST.txt`.
4. Re-run `scripts\install-scheduled-tasks.ps1` to register the 03:00 task.
5. The weekly archive export needs Node and a one-time `npx.cmd wrangler login`.

## Restoring

Install the PostgreSQL 17 tools first (`backup-app.py --setup` does this).

**Database.** Restore into the existing project, or into a new Supabase project:
```
$env:PGPASSWORD = "<database password>"
C:\Homesavers\pgsql\bin\pg_restore.exe -h <pooler host> -p 5432 -U postgres.<project ref> -d postgres --no-owner --clean --if-exists "daily\YYYY-MM-DD\database.dump"
```
- Use `--clean --if-exists` only to overwrite a broken database. For a new, empty project, leave both out.
- Then re-create the jobs in `cron-jobs.csv`: run `select cron.schedule('<jobname>', '<schedule>', $$<command>$$);` for each row.
- Then re-run the product syncs (`run_sync.bat prices`, `alt-barcodes`, `bm-daily`, `cn-codes`).
- For a **new** project, also update `SUPABASE_URL` and the key in Cloudflare Pages and in the archiver Worker. See `docs/website-disaster-recovery-guide.md`.

**Restoring a single table.** Example for `users`:
```
pg_restore.exe ... --data-only -t users "daily\YYYY-MM-DD\database.dump"
```

**Archive (D1):**
```
gzip -d YYYY-MM-DD-archive.sql.gz
npx.cmd wrangler d1 execute homesavers-archive --remote --file YYYY-MM-DD-archive.sql
```
- Use a new, empty database, or the existing one only after checking for duplicates. `INSERT` statements on existing rows will fail.

**Code:**
```
git clone code.bundle HomesaversScanner
```
- This gives every branch. Push it to a new GitHub repository if needed.

**Photos.** Upload the `photos\` folder back to the `task-photos` bucket. Use the Supabase dashboard (Storage → `task-photos` → Upload) or any S3 tool, and keep the same folder paths.

**PC settings.** Unzip `pc-settings.zip` into `C:\Homesavers`. Then:
- Put the secrets back from Bitwarden: `.sync-secret`, `.manifest-sftp-password`, `.cn-source-cookie`, `.supabase-db-password`.
- Re-enter the blanked passwords with `setup-email-configs.py`.
- Re-import the tasks, or simply run `install-scheduled-tasks.ps1`.

## Test it

Once a quarter, restore yesterday's `database.dump` into a throwaway Supabase project, or a local PostgreSQL 17, and check the row counts against `MANIFEST.txt`. A backup that has never been restored is only a hope.
