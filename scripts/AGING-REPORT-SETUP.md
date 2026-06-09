# Aging Report - setup

Emails management a dashboard of how long store records have sat in **Pending**
(today - submitted date), split into **Non-Scans / Wrong Prices / Wrong
Description**. Dashboard in the email body; detailed CSV per category attached.

It only **reads** existing data (via `/api/reports/aging`) - no new tables, no
extra storage.

## 1. One-time setup

1. Copy the template and fill it in:
   ```
   copy scripts\aging-report.config.example.json scripts\aging-report.config.json
   ```
   Edit `scripts\aging-report.config.json`:
   - `recipients` - the manager email addresses.
   - `smtp` - your mail server (host/port/security/username/**password**/from).
     - Office 365: `smtp.office365.com`, port `587`, security `starttls`.
       (If the account has MFA, create an **app password** and use that. SMTP
       AUTH must be enabled for the mailbox.)
     - Gmail/Workspace: `smtp.gmail.com`, port `587`, `starttls`, app password.
     - SSL servers: port `465`, security `ssl`.
   - `overdue_days` - records older than this are flagged red (default 3).
   - `aging_buckets` - change the age groupings if you like.
   > The real `aging-report.config.json` holds the password and is git-ignored.
   > Put the password straight in the file - don't send it to anyone.

2. The job reuses the existing sync secret at `C:\Homesavers\.sync-secret`
   (already present for the data-sync jobs). Nothing to do.

## 2. Test it (no email sent)

```
C:\Scraping\homesavers-scanner\.venv\Scripts\python.exe scripts\aging-report.py --dry-run
```
Opens nothing, but writes `scripts\aging-report-preview.html` - open it in a
browser to see exactly what managers will get.

Send a real test to yourself only:
```
C:\Scraping\homesavers-scanner\.venv\Scripts\python.exe scripts\aging-report.py --to you@homesavers.ie
```

## 3. Schedule it (Windows Task Scheduler)

Daily at 07:30 (run as your user, whether logged in or not):
```
schtasks /Create /TN "Homesavers Aging Report" /SC DAILY /ST 07:30 ^
  /TR "\"C:\Scraping\homesavers-scanner\.venv\Scripts\python.exe\" \"C:\Scraping\homesavers-scanner\scripts\aging-report.py\"" ^
  /RL LIMITED /F
```
Weekly instead (Mondays 07:30): replace `/SC DAILY` with `/SC WEEKLY /D MON`.

Change the time/day later in **Task Scheduler** (the task is named
"Homesavers Aging Report"), or re-run the command with a new `/ST`.

## 4. Logs

Each run appends to `C:\Homesavers\logs\aging-report.log`.
