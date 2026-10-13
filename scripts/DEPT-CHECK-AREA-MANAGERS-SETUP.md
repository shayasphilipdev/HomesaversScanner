# Department Check — Area Manager Emails

Sends each Area Manager a scoped Department Check report showing **only their stores**.
Shayas is BCC'd on every email. Joe's area is sent directly to shayas until Joe's
email is added.

Two sends per week:

| Day | Time | Period covered |
|---|---|---|
| **Thursday** | 09:00 | Monday to Wednesday (mid-week snapshot) |
| **Monday** | 09:00 | Previous Monday to Sunday (full week) |

---

## Area managers

| Area | Code | Name | Email |
|---|---|---|---|
| 101 | Armandas | armandas.homesavers@outlook.com |
| 102 | Edward | ed.homesavers@outlook.com |
| 103 | Gary | gary.homesavers@outlook.com |
| 104 | Hugh | hugh.homesavers@outlook.com |
| 105 | Joe | *(no email — sent to shayas)* |
| 106 | Sean | sean.homesavers@outlook.com |
| 107 | Wendy | wendy.homesavers@outlook.com |

To add Joe's email: edit `C:\Homesavers\scripts\dept-check-area-managers.config.json`
and set `"email": "joe@..."` for the area_code 105 entry. No redeploy needed.

---

## How it works

```
Windows Task Scheduler (Mon 09:00 or Thu 09:00)
  └─> C:\Homesavers\scripts\dept-check-area-managers.py
        ├─ reads C:\Homesavers\.sync-secret
        ├─ reads dept-check-area-managers.config.json  (SMTP + area manager emails)
        ├─ GET /rest/v1/areas + /rest/v1/stores  (Supabase REST — resolves area → store IDs)
        └─ per area manager:
             GET /api/reports/dept-check-week?store_ids=...  (X-Sync-Secret, scoped)
             build_html  →  send_email (To: manager, BCC: shayas)
```

---

## One-time setup (already done)

1. **Config** — created at `C:\Homesavers\scripts\dept-check-area-managers.config.json`.
   Git-ignored. Contains SMTP credentials and area manager emails.

2. **Deployed** via `deploy-scripts.ps1`. Run again after any script change:

   ```
   powershell -ExecutionPolicy Bypass -File scripts\deploy-scripts.ps1
   ```

3. **Scheduled tasks** — already registered:

   ```
   schtasks /Create /TN "Homesavers Dept Check Area Mon" /SC WEEKLY /D MON /ST 09:00 ^
     /TR "\"C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe\" \"C:\Homesavers\scripts\dept-check-area-managers.py\" --period full-week" /F

   schtasks /Create /TN "Homesavers Dept Check Area Thu" /SC WEEKLY /D THU /ST 09:00 ^
     /TR "\"C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe\" \"C:\Homesavers\scripts\dept-check-area-managers.py\" --period mid-week" /F
   ```

   Next runs: **Thu 15/10/2026 09:00** (mid-week) · **Mon 19/10/2026 09:00** (full week).

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

Dry-run files: `dept-check-area-preview-101.html` … `dept-check-area-preview-107.html`

Log: `C:\Homesavers\logs\dept-check-area-managers.log`

---

## The one thing that could silently break it

Same retention constraint as the Monday chain-wide report. The Monday full-week
send reads records up to 8 days old. `scan_record_retention_days` must stay
**≥ 9** or the oldest days of the week silently drop from the email.
The Settings page enforces a floor of 10, which keeps this safe.
