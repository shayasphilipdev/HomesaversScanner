# Weekly Department Check report

Emails **who did NOT do a Department Check last calendar week**, plus the record
count and the number of distinct departments each store that did one covered.

Sent **Monday 09:00** about the previous **Monday–Sunday**.

---

## What it reports

| Figure | Meaning |
|---|---|
| Stores missed | Active stores with **zero** Department Check records that week |
| Stores did it | The rest |
| Records | Department Check (Task J) records raised that week |
| Departments | **Distinct** departments recorded — not the number of scans |

"Departments" is the one worth reading twice: 400 records across 2 departments is
a very different week from 400 across 12, and only the second is a real check.

Active stores only. Test-app activity (`source='test'`) is excluded — a report
that tells management a store did its check because somebody exercised the test
app is worse than no report.

---

## How it works

```
scripts/dept-check-weekly.py
   └─ GET /api/reports/dept-check-week      (header: X-Sync-Secret)
        └─ RPC dept_check_summary(from, to, store_ids)
```

The **API** works out which week "last week" is, not the script. That matters at
a year boundary, where ISO week numbering has its own traps (2024-12-30 is week 1
of ISO-2025). The week maths is verified against Postgres.

The same endpoint backs the Dashboard's Department Check card, so the email and
the screen can never disagree about what counts as having done one.

---

## One-time setup

1. **Config** — copy the example and fill it in:

   ```
   copy scripts\dept-check-weekly.config.example.json scripts\dept-check-weekly.config.json
   ```

   The real file is git-ignored because it holds the SMTP password. It currently
   reuses the same Brevo account as the aging report, so there is one mail
   account to maintain.

2. **Secret** — none needed beyond `C:\Homesavers\.sync-secret`, which already
   exists for the sync jobs and the aging report.

3. **Deploy to the runtime folder.** The scheduled tasks run from
   `C:\Homesavers\scripts`, never from the git working tree — a branch switch
   must not be able to break a nightly job:

   ```
   powershell -ExecutionPolicy Bypass -File scripts\deploy-scripts.ps1
   ```

4. **Schedule it** (already done — this is the command, for reference):

   ```
   schtasks /Create /TN "Homesavers Department Check Weekly" /SC WEEKLY /D MON /ST 09:00 ^
     /TR "\"C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe\" \"C:\Homesavers\scripts\dept-check-weekly.py\"" /F
   ```

   Change the day/time later in **Task Scheduler** (the task is named
   *Homesavers Department Check Weekly*).

---

## Testing

```bat
:: build the email, write it to disk, send nothing
python dept-check-weekly.py --dry-run

:: send only to you
python dept-check-weekly.py --to you@example.com

:: report on a specific week (give that week's MONDAY)
python dept-check-weekly.py --week 2026-09-21 --dry-run
```

`--dry-run` writes `dept-check-weekly-preview.html` next to the script.

Log: `C:\Homesavers\logs\dept-check-weekly.log`

---

## The one thing that could silently break it

A Monday 09:00 report about the previous Mon–Sun reads records up to **8 days
old**. Department Check records live in Postgres for
`scan_record_retention_days` (**14**) before moving to the Cloudflare D1 archive,
so there are about **6 days of margin**.

If that setting is ever taken below **9**, this report starts quietly losing the
oldest days of the week — the email still sends, the numbers are just wrong. The
Settings page enforces a floor of 10, which is what keeps this safe; do not
lower that floor without revisiting this report.
