# Alt-Barcode Sync — Windows Service Setup

The script `sync-alt-barcodes-service.ps1` runs as a persistent Windows Service.  
It does **two things** that Task Scheduler cannot do in one step:

| Trigger | What happens |
|---|---|
| **File drops into the network folder** | Sync fires within ~45 seconds of the file being fully written |
| **Daily heartbeat** | Full sync at the time set in Admin → Settings (safety net) |

---

## ⚠️ Network folder — set the service account FIRST

Because the watched folder is a network share, the service **cannot run as Local System**
(Local System has no network credentials). You must tell it to run as a domain or local
account that has **read access to the share**.

Ask your IT admin for a service account, or use any existing domain login that can already
open the share in Windows Explorer.

**Do this immediately after the `nssm install` step — before starting the service.**

```powershell
# Replace DOMAIN\syncuser and the password with your actual account details.
C:\Homesavers\tools\nssm.exe set HomesaversAltSync ObjectName "DOMAIN\syncuser" "Pa$$word"
```

Or if you prefer the GUI:

```powershell
C:\Homesavers\tools\nssm.exe edit HomesaversAltSync
# → click the "Log on" tab → enter the account and password → OK
```

> **Tip — no domain?** If the machines are in a workgroup (not Active Directory),
> use a local account that exists on this PC: `.\localuser` instead of `DOMAIN\user`.
> Make sure that same username/password has access to the share on the file server.

---

## Prerequisites

### 1 — NSSM (service wrapper)

NSSM is a free single `.exe` — no installer, no dependencies.

```
https://nssm.cc/download
```

Download and save to `C:\Homesavers\tools\nssm.exe`.

### 2 — Secret file

Same file used by the existing scripts — skip if it already exists.

```
C:\Homesavers\.sync-secret
```

One line, the sync secret, no quotes or spaces. Must match `ALT_BARCODE_SYNC_SECRET`
in Cloudflare Pages.

### 3 — ImportExcel module

```powershell
Install-Module ImportExcel -Scope CurrentUser
```

Skip if already installed on this machine.

### 4 — Folders

```powershell
New-Item -ItemType Directory -Force -Path C:\Homesavers\scripts
New-Item -ItemType Directory -Force -Path C:\Homesavers\logs
New-Item -ItemType Directory -Force -Path C:\Homesavers\tools
```

### 5 — Script files

Copy both scripts from the repo to the machine:

```
sync-alt-barcodes-service.ps1   →   C:\Homesavers\scripts\
sync-alt-barcodes.ps1           →   C:\Homesavers\scripts\
```

---

## Install the service

Open **PowerShell as Administrator** and run these commands in order:

```powershell
# 1 — Register the service
C:\Homesavers\tools\nssm.exe install HomesaversAltSync powershell `
  -NonInteractive -ExecutionPolicy Bypass `
  -File "C:\Homesavers\scripts\sync-alt-barcodes-service.ps1"

# 2 — Set the domain / local account (REQUIRED for network folders)
#     Replace with your actual account and password.
C:\Homesavers\tools\nssm.exe set HomesaversAltSync ObjectName "DOMAIN\syncuser" "Pa$$word"

# 3 — Log files
C:\Homesavers\tools\nssm.exe set HomesaversAltSync AppStdout "C:\Homesavers\logs\sync-service-stdout.log"
C:\Homesavers\tools\nssm.exe set HomesaversAltSync AppStderr "C:\Homesavers\logs\sync-service-stderr.log"

# 4 — Auto-restart if it ever crashes (10 second delay)
C:\Homesavers\tools\nssm.exe set HomesaversAltSync AppRestartDelay 10000

# 5 — Start it now (also starts automatically on every Windows boot)
C:\Homesavers\tools\nssm.exe start HomesaversAltSync
```

The service reads its folder, file pattern, sheet and schedule from **Admin → Settings**
in the app. No script editing needed — it reloads config every 30 minutes automatically.

---

## Verify it's working

```powershell
# Check service status — should say "SERVICE_RUNNING"
C:\Homesavers\tools\nssm.exe status HomesaversAltSync

# Watch the live log (Ctrl+C to stop watching)
Get-Content C:\Homesavers\logs\sync-alt-barcodes-service.log -Wait -Tail 30
```

Expected log on startup:

```
2026-05-25 06:00:01 [INFO] === Homesavers Alt-Barcode Sync Service starting ===
2026-05-25 06:00:01 [INFO] Config refreshed: folder='\\server\share\AltBarcodes' ...
2026-05-25 06:00:01 [INFO] FileSystemWatcher attached: \\server\share\AltBarcodes\*.xlsx
2026-05-25 06:00:01 [INFO] Service loop started. Watching for file events and daily heartbeat.
```

**Quick test** — drop a copy of the xlsx into the network folder.  
Within 45 seconds the log should show a file event followed by a completed sync.

```
2026-05-25 09:14:22 [INFO] File event: \\server\share\AltBarcodes\ALT Barcode Master.xlsx
2026-05-25 09:15:07 [INFO] === Sync triggered (file event (debounced 45 s)) ...
2026-05-25 09:17:33 [INFO] Sync completed OK (exit 0).
```

---

## Day-to-day management

```powershell
# Stop / start / restart
C:\Homesavers\tools\nssm.exe stop    HomesaversAltSync
C:\Homesavers\tools\nssm.exe start   HomesaversAltSync
C:\Homesavers\tools\nssm.exe restart HomesaversAltSync

# Edit settings (GUI)
C:\Homesavers\tools\nssm.exe edit HomesaversAltSync
```

You can also open **Services** (`Win + R` → `services.msc`) and find **HomesaversAltSync** there.

---

## Moving to a new PC

Follow these steps on the **old PC first**, then set up the new one.

### Step 1 — Stop and remove the service on the old PC

Open **PowerShell as Administrator** on the old machine:

```powershell
# Stop the service
C:\Homesavers\tools\nssm.exe stop HomesaversAltSync

# Uninstall it completely — removes the Windows Service entry
C:\Homesavers\tools\nssm.exe remove HomesaversAltSync confirm
```

Verify it's gone:

```powershell
Get-Service HomesaversAltSync
# Should return an error "Cannot find any service with service name..."
```

The service is now fully removed. The script files and log folder on the old PC can be
deleted or left — they no longer do anything.

### Step 2 — Set up the new PC

On the **new PC**, repeat the full install process from the top of this guide:

1. Copy `nssm.exe` → `C:\Homesavers\tools\`
2. Copy both `.ps1` scripts → `C:\Homesavers\scripts\`
3. Create `C:\Homesavers\.sync-secret` with the same secret value
4. Run `Install-Module ImportExcel -Scope CurrentUser`
5. Run the five `nssm` install commands above (including the domain account step)
6. Verify with `nssm status HomesaversAltSync`

> **The secret value** — if you don't have it written down, get it from the Cloudflare Pages
> dashboard: **Pages → homesaversscanner → Settings → Environment variables → ALT_BARCODE_SYNC_SECRET**.

### What carries over automatically

Nothing needs to change in the app. The folder path, file pattern, and schedule are
stored in Admin → Settings (in the database) — the new PC will read them from there
on first startup, exactly as the old PC did.

---

## Uninstall only (keeping the PC)

If you just want to remove the service without moving machines:

```powershell
C:\Homesavers\tools\nssm.exe stop    HomesaversAltSync
C:\Homesavers\tools\nssm.exe remove  HomesaversAltSync confirm
```

Then optionally delete `C:\Homesavers\` if you no longer need the scripts or logs.

---

## Debounce timing

The service waits **45 seconds** after the last file event before syncing.
This prevents reading a file that is still being copied over the network.
If your file is very large and takes longer to copy, increase this:

```powershell
# Stop first, then update the parameter, then start again
C:\Homesavers\tools\nssm.exe stop HomesaversAltSync
C:\Homesavers\tools\nssm.exe set HomesaversAltSync AppParameters `
  "-NonInteractive -ExecutionPolicy Bypass -File C:\Homesavers\scripts\sync-alt-barcodes-service.ps1 -DebounceSeconds 120"
C:\Homesavers\tools\nssm.exe start HomesaversAltSync
```

---

## Keep Task Scheduler or remove it?

Once the service is running, disable the old Task Scheduler job — the daily heartbeat
inside the service covers the same ground. To disable (not delete) it:

```powershell
Disable-ScheduledTask -TaskName "HomesaversAltBarcodeSync"
```
