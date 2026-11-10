# Phases 7 + 8 of docs/post-wipe-restoration-plan.md: registers the Homesavers
# Scheduled Tasks for the logged-on user. Safe to re-run (updates in place).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -Remove
#
# Times are the ones the jobs actually ran at before the 2026-10 attack (read
# from sync_runs). Every task runs the DEPLOYED copy in C:\Homesavers\scripts,
# so run deploy-scripts.ps1 after pulling changes.
#
# Tasks run as you, "only when logged on": the B&M sync drives Excel, which
# does not work in a background session. Leave this user logged on (a locked
# screen is fine). If the PC was off or asleep at a run time, the task runs as
# soon as it can; the PC is also woken for runs.
#
# The report emails (Phase 6) are registered only once their config files exist
# (scripts\setup-email-configs.py writes them); re-run this after that.
#
# PAUSED (2026-11-10): the two Department Check emails (weekly + area managers).
# Department checks no longer happen every week - they follow a schedule that
# is still to be confirmed. Paused tasks are not registered, and are removed if
# an earlier run registered them. To bring one back, set its Paused to $false.

[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$S    = 'C:\Homesavers\scripts'
$user = "$env:USERDOMAIN\$env:USERNAME"

$daily = @(
  @{ Name = 'Homesavers CN Code Sync';      At = '02:45'; Job = 'cn-codes' },
  @{ Name = 'Homesavers Prices Sync';       At = '07:00'; Job = 'prices' },
  @{ Name = 'Homesavers Alt Barcodes Sync'; At = '07:30'; Job = 'alt-barcodes' }
)
# Report emails: registered only when their config file exists.
$emails = @(
  @{ Name = 'Homesavers Aging Report';            Day = 'Wednesday'; At = '08:00'; Script = 'aging-report.py';             Config = 'aging-report.config.json';             Args = '' },
  @{ Name = 'Homesavers Department Check Weekly'; Day = 'Monday';    At = '09:00'; Script = 'dept-check-weekly.py';        Config = 'dept-check-weekly.config.json';        Args = '';                   Paused = $true },
  @{ Name = 'Homesavers Dept Check Area Mon';     Day = 'Monday';    At = '08:00'; Script = 'dept-check-area-managers.py'; Config = 'dept-check-area-managers.config.json'; Args = '--period full-week'; Paused = $true },
  @{ Name = 'Homesavers Dept Check Area Thu';     Day = 'Thursday';  At = '08:00'; Script = 'dept-check-area-managers.py'; Config = 'dept-check-area-managers.config.json'; Args = '--period mid-week';  Paused = $true }
)
$names = @($daily | ForEach-Object { $_.Name }) +
         @('Homesavers B&M Daily Sync', 'Homesavers App Backup', 'Homesavers Manifest', 'Homesavers Upload Server') +
         @($emails | ForEach-Object { $_.Name })

if ($Remove) {
  foreach ($n in $names) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $n -Confirm:$false
      Write-Host "Removed  $n"
    }
  }
  return
}

# Prerequisites from setup-new-pc.ps1 / deploy-scripts.ps1
$pyFile = 'C:\Homesavers\python-path.txt'
if (-not (Test-Path $pyFile)) { throw "$pyFile missing - run scripts\setup-new-pc.ps1 first." }
$py = (Get-Content $pyFile -Raw).Trim()
foreach ($f in @('run_sync.bat', 'run-manifest.vbs', 'manifest-generator.py', 'local_upload_server.py', 'sync-bm-daily.py')) {
  if (-not (Test-Path (Join-Path $S $f))) { throw "$S\$f missing - run scripts\deploy-scripts.ps1 first." }
}
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'   # windowless, for the always-on server
if (-not (Test-Path $pyw)) { $pyw = $py }

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
function New-Settings([TimeSpan]$Limit) {
  New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit $Limit
}
function Register([string]$Name, $Action, $Trigger, $Settings, [string]$Description) {
  Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Principal $principal `
    -Settings $Settings -Description $Description -Force | Out-Null
  Write-Host "Registered  $Name"
}

# Phase 8: the daily syncs
foreach ($d in $daily) {
  $action  = New-ScheduledTaskAction -Execute "$S\run_sync.bat" -Argument $d.Job -WorkingDirectory $S
  $trigger = New-ScheduledTaskTrigger -Daily -At $d.At
  Register $d.Name $action $trigger (New-Settings (New-TimeSpan -Hours 2)) "run_sync.bat $($d.Job), daily $($d.At)"
}

# B&M Daily file from SFTP (2026-11-10): every 30 min 07:00-12:00, windowless.
# Each run exits at once unless a NEW product CSV is on the server, so today's
# file is picked up as soon as it lands; if it is still missing at 11:30 the
# run shows as failed on Admin -> Settings -> Data Sync.
$action  = New-ScheduledTaskAction -Execute $pyw -Argument "`"$S\sync-bm-daily.py`"" -WorkingDirectory $S
$trigger = New-ScheduledTaskTrigger -Daily -At '07:00'
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At '07:00' `
  -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 5)).Repetition
Register 'Homesavers B&M Daily Sync' $action $trigger (New-Settings (New-TimeSpan -Minutes 30)) `
  'sync-bm-daily.py (B&M product CSV from SFTP), every 30 min 07:00-12:00'

# App backup (2026-11-10): nightly 03:00, windowless. Registered once
# backup-app.py --setup has been run (it needs the database password file).
if (Test-Path 'C:\Homesavers\.supabase-db-password') {
  $action  = New-ScheduledTaskAction -Execute $pyw -Argument "`"$S\backup-app.py`"" -WorkingDirectory $S
  $trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
  Register 'Homesavers App Backup' $action $trigger (New-Settings (New-TimeSpan -Hours 3)) `
    'backup-app.py: database, photos, code, PC settings to B: (archive export weekly)'
} else {
  Write-Host "Skipped     Homesavers App Backup - run backup-app.py --setup first" -ForegroundColor Yellow
}

# Phase 8: delivery manifests every 30 min, 07:05-19:05 (idle runs take seconds)
$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$S\run-manifest.vbs`"" -WorkingDirectory $S
$trigger = New-ScheduledTaskTrigger -Daily -At '07:05'
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At '07:05' `
  -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition
Register 'Homesavers Manifest' $action $trigger (New-Settings (New-TimeSpan -Hours 1)) `
  'manifest-generator.py via run-manifest.vbs, every 30 min 07:05-19:05'

# Phase 7: the local upload server behind Admin -> Settings -> Manual Upload
$action   = New-ScheduledTaskAction -Execute $pyw -Argument "`"$S\local_upload_server.py`"" -WorkingDirectory $S
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register 'Homesavers Upload Server' $action $trigger $settings 'local_upload_server.py on http://localhost:8765, at logon'
Start-ScheduledTask -TaskName 'Homesavers Upload Server'

# Phase 6: report emails, windowless; each script logs to C:\Homesavers\logs
foreach ($e in $emails) {
  if ($e.Paused) {
    if (Get-ScheduledTask -TaskName $e.Name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $e.Name -Confirm:$false
      Write-Host "Removed     $($e.Name) - paused (department check schedule to be confirmed)" -ForegroundColor Yellow
    } else {
      Write-Host "Paused      $($e.Name) - not registered (department check schedule to be confirmed)" -ForegroundColor Yellow
    }
    continue
  }
  if (-not (Test-Path (Join-Path $S $e.Config))) {
    Write-Host "Skipped     $($e.Name) - no $($e.Config) yet (run setup-email-configs.py)" -ForegroundColor Yellow
    continue
  }
  $arg     = ("`"$S\$($e.Script)`" $($e.Args)").Trim()
  $action  = New-ScheduledTaskAction -Execute $pyw -Argument $arg -WorkingDirectory $S
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $e.Day -At $e.At
  Register $e.Name $action $trigger (New-Settings (New-TimeSpan -Hours 1)) "$($e.Script) $($e.Args), $($e.Day) $($e.At)"
}

# Summary
Start-Sleep -Seconds 3
Write-Host ''
$names | ForEach-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue } | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo
  [pscustomobject]@{ Task = $_.TaskName; State = $_.State; NextRun = $i.NextRunTime }
} | Format-Table -AutoSize | Out-Host

try {
  $h = Invoke-RestMethod -Uri 'http://localhost:8765/health' -TimeoutSec 10
  Write-Host "Upload server: running ($($h | ConvertTo-Json -Compress))" -ForegroundColor Green
} catch {
  Write-Host "Upload server: not answering on http://localhost:8765/health yet - $($_.Exception.Message)" -ForegroundColor Yellow
}
