# Homesavers Alt-Barcode Sync — Windows Service Guide

The Windows Service watches the network folder and automatically syncs the Alt Barcode
Excel file the moment it is updated — no manual trigger or Task Scheduler needed.

---

## How it works

| Trigger | What happens |
|---|---|
| New or updated `.xlsx` lands in the network folder | Sync fires automatically within ~45 seconds |
| Daily heartbeat | Full sync runs at the time set in Admin → Settings (safety net) |

The service runs in the background at all times — even when no one is logged in.

---

## Files needed on the sync PC

| File | Purpose |
|---|---|
| `C:\Homesavers\tools\HomesaversAltSync.exe` | WinSW — wraps the script as a Windows Service |
| `C:\Homesavers\tools\HomesaversAltSync.xml` | WinSW config (account, log paths, restart rules) |
| `C:\Homesavers\scripts\sync-alt-barcodes-service.ps1` | Persistent service runner (FileSystemWatcher + heartbeat) |
| `C:\Homesavers\scripts\sync-alt-barcodes.ps1` | The actual sync logic (called by the service runner) |
| `C:\Homesavers\.sync-secret` | One-line file holding the sync secret (matches `PRODUCT_SYNC_SECRET` in Cloudflare) |

---

## Fresh install — step by step

### Prerequisites

**1 — Create folders**
```powershell
New-Item -ItemType Directory -Force -Path C:\Homesavers\tools
New-Item -ItemType Directory -Force -Path C:\Homesavers\scripts
New-Item -ItemType Directory -Force -Path C:\Homesavers\logs
```

**2 — Copy the two scripts from the repo**
```
scripts\sync-alt-barcodes-service.ps1  →  C:\Homesavers\scripts\
scripts\sync-alt-barcodes.ps1          →  C:\Homesavers\scripts\
```

**3 — Create the secret file**
```powershell
Read-Host "Enter sync secret" | Set-Content -Path "C:\Homesavers\.sync-secret" -Encoding UTF8
```
The secret is the value of `PRODUCT_SYNC_SECRET` in Cloudflare Pages → Settings → Environment variables.
If you cannot read it (it is masked), generate a new one and update it in Cloudflare:
```powershell
# Generate a new secret
-join ((65..90)+(97..122)+(48..57) | Get-Random -Count 40 | % {[char]$_})
```

**4 — Install ImportExcel** (skip if already installed)
```powershell
Install-Module ImportExcel -Scope CurrentUser -Force
```
Check if already installed:
```powershell
Get-Module -ListAvailable -Name ImportExcel
```

**5 — Download WinSW**

Go to: `https://github.com/winsw/winsw/releases/latest`  
Download **WinSW-x64.exe** and save it as:
```
C:\Homesavers\tools\HomesaversAltSync.exe
```

**6 — Create the WinSW config file**
```powershell
@"
<service>
  <id>HomesaversAltSync</id>
  <name>Homesavers Alt-Barcode Sync</name>
  <description>Watches network folder and syncs alt barcode Excel file automatically.</description>
  <executable>powershell</executable>
  <arguments>-NonInteractive -ExecutionPolicy Bypass -File "C:\Homesavers\scripts\sync-alt-barcodes-service.ps1"</arguments>
  <logpath>C:\Homesavers\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>5120</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <serviceaccount>
    <domain>aimgroup.local</domain>
    <user>shayas</user>
    <password>REPLACE_WITH_YOUR_PASSWORD</password>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>
</service>
"@ | Set-Content "C:\Homesavers\tools\HomesaversAltSync.xml" -Encoding UTF8
```
Then open the file and replace `REPLACE_WITH_YOUR_PASSWORD`:
```powershell
notepad "C:\Homesavers\tools\HomesaversAltSync.xml"
```

**7 — Grant "Log on as a service" right**

Press **Win + R** → type `secpol.msc` → Enter  
Navigate to: `Local Policies → User Rights Assignment`  
Double-click **Log on as a service** → click **Add User or Group**  
Type `aimgroup.local\shayas` → OK → OK

**8 — Install and start the service** (PowerShell as Administrator)
```powershell
C:\Homesavers\tools\HomesaversAltSync.exe install
C:\Homesavers\tools\HomesaversAltSync.exe start
C:\Homesavers\tools\HomesaversAltSync.exe status
```
Should print `Started`.

**9 — Verify**
```powershell
Get-Content "C:\Homesavers\logs\sync-alt-barcodes-service.log" -Wait -Tail 20
```
You should see the service connect, read the config from Admin → Settings, and attach
the FileSystemWatcher to `\\192.168.1.205\Buying Data`.

---

## Checking sync status

**Option 1 — Live log**
```powershell
Get-Content "C:\Homesavers\logs\sync-alt-barcodes-service.log" -Wait -Tail 30
```

**Option 2 — In the app**  
Admin → Settings → scroll to **Sync Runs** — every sync is recorded with file name,
record count, and status (ok / error).

**Option 3 — Windows Services**  
Press **Win + R** → type `services.msc` → find **Homesavers Alt-Barcode Sync**  
Shows Running or Stopped.

---

## Can I close PowerShell?

**Yes.** Once the service is running you can close PowerShell completely.
The service runs independently in the background — it does not need any open window.

---

## When you change your Windows password

The service stores your password in the XML config file. When your domain password
changes the service will **stop authenticating** and fail silently.

**Do this on the same day you change your password:**

```powershell
# 1 — Stop the service
C:\Homesavers\tools\HomesaversAltSync.exe stop

# 2 — Open the config and update the <password> line
notepad "C:\Homesavers\tools\HomesaversAltSync.xml"

# 3 — Restart the service
C:\Homesavers\tools\HomesaversAltSync.exe start
```

---

## When the PC restarts

The service starts **automatically** — no action needed.  
It is configured as `AUTO_START` so Windows launches it during boot,
before anyone logs into the desktop.

---

## When you log in as a different user

**No effect.** The service runs as `aimgroup.local\shayas` in its own background session.
It does not matter who is (or is not) logged into the desktop — the service keeps running.

---

## Moving to a new PC

### On the old PC — remove the service

Open PowerShell as Administrator:
```powershell
C:\Homesavers\tools\HomesaversAltSync.exe stop
C:\Homesavers\tools\HomesaversAltSync.exe uninstall
```

Verify it is gone:
```powershell
Get-Service HomesaversAltSync
# Should return an error — service no longer exists
```

You can now delete `C:\Homesavers\` on the old machine.

### On the new PC — fresh install

Follow the **Fresh install** steps from the top of this guide.  
The sync folder, file pattern, and schedule are stored in the app database (Admin → Settings)
and do not need to be reconfigured — the new service reads them automatically on first start.

**Things you need on the new PC:**
- The sync secret (from `C:\Homesavers\.sync-secret` on the old PC, or from Cloudflare Pages)
- Your domain account password
- WinSW downloaded from GitHub
- The two `.ps1` scripts from this repo

---

## Day-to-day commands

All commands require PowerShell as Administrator.

```powershell
# Start
C:\Homesavers\tools\HomesaversAltSync.exe start

# Stop
C:\Homesavers\tools\HomesaversAltSync.exe stop

# Restart
C:\Homesavers\tools\HomesaversAltSync.exe restart

# Check status
C:\Homesavers\tools\HomesaversAltSync.exe status

# Uninstall (permanent removal)
C:\Homesavers\tools\HomesaversAltSync.exe stop
C:\Homesavers\tools\HomesaversAltSync.exe uninstall
```

---

## Network folder

The watched folder is a network share — **never use the mapped drive letter** (`Y:\`).
Mapped drives are tied to a user session and are invisible to Windows Services.

Always use the UNC path:
```
\\192.168.1.205\Buying Data
```

This is set in **Admin → Settings → Alt Barcode Sync folder** in the app.
The service reads it from there — no script editing needed.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Service stops after password change | Stored password is stale | Update `<password>` in XML, restart service |
| "Logon failure" in event log | "Log on as a service" right missing | Grant via `secpol.msc` → Local Policies → User Rights Assignment |
| Service starts but no sync runs | Wrong folder path in Admin → Settings | Set UNC path `\\192.168.1.205\Buying Data`, not `Y:\` |
| "Cannot find script" error in log | Scripts not copied to `C:\Homesavers\scripts\` | Copy both `.ps1` files from the repo |
| Sync runs but API returns 403 | Secret file doesn't match Cloudflare | Update `C:\Homesavers\.sync-secret` and `PRODUCT_SYNC_SECRET` in Cloudflare to the same value |

Check the Windows Event Log for service errors:
```powershell
Get-WinEvent -FilterHashtable @{LogName='System'; Id=7000,7009,7038,7041} -MaxEvents 5 |
  Format-List TimeCreated, Message
```
