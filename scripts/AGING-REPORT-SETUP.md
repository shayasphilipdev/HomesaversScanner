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
   - `smtp` - the mail relay (host/port/security/username/**password**/from).
     **Recommended: Brevo** (free 300 emails/day). Microsoft has disabled
     password SMTP for `@outlook.com`, so we relay through Brevo but keep the
     Outlook From-address. See "Brevo setup" below for the exact values.
     - Other options if ever needed:
       - Gmail/Workspace: `smtp.gmail.com`, port `587`, `starttls`, app password.
       - SSL servers: port `465`, security `ssl`.

   ### Brevo setup (recommended relay)
   1. Sign up free at <https://www.brevo.com> (complete the profile so the
      account is activated for sending).
   2. **Senders, Domains & IPs -> Senders -> Add a sender:**
      name `Homesavers Scanner`, email `orders.homesavers@outlook.com`.
      Brevo emails a confirmation link to that inbox - open it and click to
      verify. (You need access to the orders.homesavers@outlook.com mailbox.)
   3. **SMTP & API -> SMTP tab:** note the server `smtp-relay.brevo.com`,
      port `587`, your **login** (account email), and click **Generate a new
      SMTP key** - copy it.
   4. Put these in `aging-report.config.json` -> `smtp`:
      - `host`: `smtp-relay.brevo.com`
      - `port`: `587`  (use `2525` if your network blocks 587)
      - `security`: `starttls`
      - `username`: your Brevo **login email**
      - `password`: the **SMTP key** from step 3
      - `from`: `Homesavers Scanner <orders.homesavers@outlook.com>`
   > First email may land in Junk (the From is an @outlook.com address sent via
   > Brevo). Mark it "Not junk" / add to safe senders. For permanent best
   > deliverability, verify a real Homesavers domain in Brevo later.
   - `overdue_days` - records older than this are flagged red (default 3).
   - `aging_buckets` - change the age groupings if you like.
   > The real `aging-report.config.json` holds the password and is git-ignored.
   > Put the password straight in the file - don't send it to anyone.

2. The job reuses the existing sync secret at `C:\Homesavers\.sync-secret`
   (already present for the data-sync jobs). Nothing to do.

## 2. Test it (no email sent)

```
C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe scripts\aging-report.py --dry-run
```
Opens nothing, but writes `scripts\aging-report-preview.html` - open it in a
browser to see exactly what managers will get.

Send a real test to yourself only:
```
C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe scripts\aging-report.py --to you@homesavers.ie
```

## 3. Schedule it (Windows Task Scheduler)

Daily at 07:30 (run as your user, whether logged in or not):
```
schtasks /Create /TN "Homesavers Aging Report" /SC DAILY /ST 07:30 ^
  /TR "\"C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe\" \"C:\Scraping\homesavers-scanner\scripts\aging-report.py\"" ^
  /RL LIMITED /F
```
Weekly instead (Mondays 07:30): replace `/SC DAILY` with `/SC WEEKLY /D MON`.

Change the time/day later in **Task Scheduler** (the task is named
"Homesavers Aging Report"), or re-run the command with a new `/ST`.

## 4. Logs

Each run appends to `C:\Homesavers\logs\aging-report.log`.
