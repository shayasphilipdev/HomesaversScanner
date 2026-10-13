# Department Check — Area Manager Emails

Sends each Area Manager a scoped Department Check report showing **only their stores**.
Shayas is BCC'd on every email.

Two sends per week:

| Day | Time | Period covered |
|---|---|---|
| **Thursday** | 08:00 | Monday to Wednesday (mid-week snapshot) |
| **Monday** | 08:00 | Previous Monday to Sunday (full week) |

---

## Area manager emails (set in the app)

Emails are read from the **users table** — not hardcoded in the config.

To add or change an area manager's email:
1. Open the app → Admin → Employees
2. Find the area manager, click Edit
3. Set the **Email** field and save

If an area manager has no email set, their send is skipped and logged as a warning.
To check who is missing an email, run a dry-run (see Testing below).

---

## How it works

```
Windows Task Scheduler (Mon 09:00 or Thu 09:00)
  └─> C:\Homesavers\scripts\dept-check-area-managers.py
        ├─ reads C:\Homesavers\.sync-secret
        ├─ reads dept-check-area-managers.config.json  (SMTP credentials only)
        ├─ GET /rest/v1/users?role=eq.area_manager      (Supabase REST — reads emails)
        ├─ GET /rest/v1/areas + /rest/v1/stores         (resolves area → store IDs)
        └─ per area manager:
             GET /api/reports/dept-check-week?store_ids=...  (X-Sync-Secret, scoped)
             build_html  →  send_email (To: manager, BCC: shayas)
```

---

## One-time setup (already done)

1. **Config** — created at `C:\Homesavers\scripts\dept-check-area-managers.config.json`.
   Git-ignored. Contains SMTP credentials only; area manager emails come from the DB.

2. **Deployed** via `deploy-scripts.ps1`. Run again after any script change:

   ```
   powershell -ExecutionPolicy Bypass -File scripts\deploy-scripts.ps1
   ```

3. **Scheduled tasks** — already registered:

   ```
   schtasks /Create /TN "Homesavers Dept Check Area Mon" /SC WEEKLY /D MON /ST 08:00 ^
     /TR "\"C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe\" \"C:\Homesavers\scripts\dept-check-area-managers.py\" --period full-week" /F

   schtasks /Create /TN "Homesavers Dept Check Area Thu" /SC WEEKLY /D THU /ST 08:00 ^
     /TR "\"C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe\" \"C:\Homesavers\scripts\dept-check-area-managers.py\" --period mid-week" /F
   ```

   Next runs: **Thu 15/10/2026 08:00** (mid-week) · **Mon 19/10/2026 08:00** (full week).

---

## Testing

```bat
:: build HTML for every area, write to scripts\ folder, send nothing
python dept-check-area-managers.py --period full-week --dry-run

:: send all area emails to one address only (for checking)
python dept-check-area-managers.py --period full-week --to shayas.philip@supplychain1.ie

:: mid-week preview
python dept-check-area-managers.py --period mid-week --dry-run
```

Dry-run files: `dept-check-area-preview-<name>.html` (one per area manager).

Log: `C:\Homesavers\logs\dept-check-area-managers.log`

---

## The one thing that could silently break it

Same retention constraint as the Monday chain-wide report. The Monday full-week
send reads records up to 8 days old. `scan_record_retention_days` must stay
**≥ 9** or the oldest days of the week silently drop from the email.
The Settings page enforces a floor of 10, which keeps this safe.
