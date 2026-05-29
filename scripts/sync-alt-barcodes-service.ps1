# Homesavers Alt-Barcode Sync — Windows Service runner
#
# Run as a persistent Windows Service via NSSM. Does two things:
#   1. FileSystemWatcher — fires a sync the moment a new/changed .xlsx lands
#      in the configured folder (no fixed schedule needed).
#   2. Daily heartbeat — full sync at the time set in Admin > Settings, as a
#      safety net in case the file watcher ever misses an event.
#
# Setup (one-off — see README-sync-service.md):
#   nssm install HomesaversAltSync powershell -NonInteractive -ExecutionPolicy Bypass -File "C:\Homesavers\scripts\sync-alt-barcodes-service.ps1"
#   nssm set HomesaversAltSync AppStdout C:\Homesavers\logs\sync-service-stdout.log
#   nssm set HomesaversAltSync AppStderr C:\Homesavers\logs\sync-service-stderr.log
#   nssm start HomesaversAltSync

param(
  [string]$BaseUrl    = "https://homesaversscanner.pages.dev",
  [string]$SecretFile = "C:\Homesavers\.sync-secret",
  [string]$LogPath    = "C:\Homesavers\logs\sync-alt-barcodes-service.log",
  [string]$SyncScript = "$PSScriptRoot\sync-alt-barcodes.ps1",
  # How long to wait after a file event before syncing (seconds).
  # Gives Excel / the network copy time to finish writing the file.
  [int]$DebounceSeconds  = 45,
  # Re-read folder config from the app every N minutes.
  [int]$ConfigRefreshMin = 30
)

$ErrorActionPreference = "Stop"

# ── Logging ───────────────────────────────────────────────────────────────────
$logLock = [System.Object]::new()
function Write-Log {
  param([string]$Message, [string]$Level = "INFO")
  $line = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Level, $Message
  Write-Host $line
  [System.Threading.Monitor]::Enter($logLock)
  try {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $LogPath -Value $line
  } catch {}
  finally { [System.Threading.Monitor]::Exit($logLock) }
}

# Trim log to last 5000 lines on startup so it never grows unbounded.
function Trim-Log {
  try {
    if (-not (Test-Path $LogPath)) { return }
    $lines = Get-Content $LogPath
    if ($lines.Count -gt 5000) {
      $lines | Select-Object -Last 5000 | Set-Content $LogPath
      Write-Log "Log trimmed to 5000 lines."
    }
  } catch {}
}

# ── Shared state ──────────────────────────────────────────────────────────────
# Thread-safe flag: the watcher callback sets this; the main loop reads it.
$syncQueue  = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$script:watchedFolder  = $null
$script:filePattern    = '*.xlsx'
$script:namePrefix     = $null
$script:sheet          = '1'
$script:scheduleTime   = $null   # e.g. "06:00"
$script:lastSyncedFile = $null
$script:lastSyncAt     = [datetime]::MinValue
$script:lastPollAt     = [datetime]::MinValue   # for the 5-min polling fallback
$script:secret         = $null
$script:authHeaders    = $null
$script:watcher        = $null

# ── Load secret ───────────────────────────────────────────────────────────────
function Load-Secret {
  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $s = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $s) { throw "Secret file is empty: $SecretFile" }
  $script:secret      = $s
  $script:authHeaders = @{ "X-Sync-Secret" = $s; "Content-Type" = "application/json" }
}

# ── Fetch config from app ─────────────────────────────────────────────────────
function Refresh-Config {
  try {
    $cfg = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/alt-barcodes/sync-config" `
             -Headers $script:authHeaders -TimeoutSec 30
    $newFolder = $cfg.folder
    $newPattern = if ($cfg.file_pattern) { $cfg.file_pattern } else { '*.xlsx' }
    $newPrefix  = $cfg.name_prefix
    $newSheet   = if ($cfg.sheet) { $cfg.sheet } else { '1' }
    $newTime    = $cfg.time   # e.g. "06:00"

    # If the folder changed, re-attach the FileSystemWatcher.
    if ($newFolder -ne $script:watchedFolder) {
      Write-Log "Folder changed: '$($script:watchedFolder)' -> '$newFolder'. Re-attaching watcher."
      Attach-Watcher $newFolder $newPattern
    } elseif ($newPattern -ne $script:filePattern) {
      Write-Log "File pattern changed: '$($script:filePattern)' -> '$newPattern'. Re-attaching watcher."
      Attach-Watcher $newFolder $newPattern
    }

    $script:watchedFolder = $newFolder
    $script:filePattern   = $newPattern
    $script:namePrefix    = $newPrefix
    $script:sheet         = $newSheet
    $script:scheduleTime  = $newTime

    Write-Log "Config refreshed: folder='$newFolder' pattern='$newPattern' prefix='$newPrefix' sheet='$newSheet' time='$newTime'"
  } catch {
    Write-Log "Could not refresh config (will retry in $ConfigRefreshMin min): $($_.Exception.Message)" "WARN"
  }
}

# ── FileSystemWatcher ─────────────────────────────────────────────────────────
function Attach-Watcher {
  param([string]$Folder, [string]$Pattern)

  # Unregister old event subscriptions FIRST. Without this, a second call with
  # the same SourceIdentifier throws (silently swallowed by | Out-Null), so the
  # new watcher's events are never registered — the root cause of the "service
  # running but not watching" bug.
  foreach ($sid in @("HS_FSW_AB_Created","HS_FSW_AB_Changed","HS_FSW_AB_Renamed")) {
    Get-EventSubscriber -SourceIdentifier $sid -ErrorAction SilentlyContinue |
      Unregister-Event -Force -ErrorAction SilentlyContinue
  }

  # Tear down any existing watcher object.
  if ($script:watcher) {
    try { $script:watcher.Dispose() } catch {}
    $script:watcher = $null
    Write-Log "Previous watcher disposed."
  }

  if (-not $Folder) { Write-Log "No folder configured — watcher not attached." "WARN"; return }
  if (-not (Test-Path $Folder)) {
    Write-Log "Folder not accessible: $Folder — watcher not attached. Will retry on next config refresh." "WARN"
    return
  }

  $w = New-Object System.IO.FileSystemWatcher
  $w.Path   = $Folder
  $w.Filter = if ($Pattern) { $Pattern } else { '*.xlsx' }
  $w.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName
  $w.IncludeSubdirectories = $false
  $w.EnableRaisingEvents   = $true

  # Capture the queue in a script block. Both Created and Changed fire because
  # some copy tools write a temp file then rename, and others overwrite in place.
  $action = {
    $path = $Event.SourceEventArgs.FullPath
    $syncQueue.Enqueue($path)
  }
  Register-ObjectEvent -InputObject $w -EventName Created -Action $action -SourceIdentifier "HS_FSW_AB_Created" | Out-Null
  Register-ObjectEvent -InputObject $w -EventName Changed -Action $action -SourceIdentifier "HS_FSW_AB_Changed" | Out-Null
  Register-ObjectEvent -InputObject $w -EventName Renamed -Action $action -SourceIdentifier "HS_FSW_AB_Renamed" | Out-Null

  $script:watcher = $w
  Write-Log "FileSystemWatcher attached: $Folder\$($w.Filter)"
}

# ── Run the actual sync ───────────────────────────────────────────────────────
function Run-Sync {
  param([string]$TriggerFile = "", [string]$Reason = "scheduled")

  # If a specific file was queued, verify prefix match before we spend time on it.
  if ($TriggerFile -and $script:namePrefix) {
    $fname = Split-Path -Leaf $TriggerFile
    if (-not $fname.StartsWith($script:namePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Log "Skipping '$fname' — does not match prefix '$($script:namePrefix)'" "INFO"
      return
    }
  }

  Write-Log "=== Sync triggered ($Reason) — file: $(if ($TriggerFile) { $TriggerFile } else { 'auto-pick' }) ==="

  $args = @(
    "-NonInteractive"
    "-ExecutionPolicy", "Bypass"
    "-File", $SyncScript
    "-BaseUrl", $BaseUrl
    "-SecretFile", $SecretFile
    "-LogPath", ($LogPath -replace '\.log$', '-detail.log')
  )
  if ($TriggerFile -and (Test-Path $TriggerFile)) { $args += "-ExcelPath", $TriggerFile }
  if ($script:sheet)  { $args += "-Sheet", $script:sheet }

  try {
    $proc = Start-Process powershell -ArgumentList $args -Wait -PassThru -NoNewWindow
    if ($proc.ExitCode -eq 0) {
      Write-Log "Sync completed OK (exit 0)."
    } else {
      Write-Log "Sync finished with exit code $($proc.ExitCode) — check detail log." "WARN"
    }
  } catch {
    Write-Log "Failed to start sync process: $($_.Exception.Message)" "ERROR"
  }

  $script:lastSyncAt     = Get-Date
  $script:lastSyncedFile = $TriggerFile
}

# ── Check whether the daily heartbeat is due ─────────────────────────────────
function Test-HeartbeatDue {
  if (-not $script:scheduleTime) { return $false }
  try {
    $parts   = $script:scheduleTime -split ':'
    $target  = (Get-Date).Date.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
    $now     = Get-Date
    # Due if: target is in the past today AND we haven't synced in the last 23h.
    $pastTarget   = $now -ge $target
    $notSyncedYet = ($now - $script:lastSyncAt).TotalHours -ge 23
    return $pastTarget -and $notSyncedYet
  } catch { return $false }
}

# ── Main ──────────────────────────────────────────────────────────────────────
Trim-Log
Write-Log "=== Homesavers Alt-Barcode Sync Service starting ==="
Write-Log "SyncScript : $SyncScript"
Write-Log "BaseUrl    : $BaseUrl"
Write-Log "SecretFile : $SecretFile"

try { Load-Secret } catch {
  Write-Log "FATAL: $($_.Exception.Message)" "ERROR"
  exit 1
}

Refresh-Config
if ($script:watchedFolder) { Attach-Watcher $script:watchedFolder $script:filePattern }

$lastConfigRefresh = Get-Date
$pendingFile       = $null       # file path waiting for debounce
$pendingAt         = $null       # when the debounce timer started

Write-Log "Service loop started. Watching for file events and daily heartbeat."

while ($true) {
  Start-Sleep -Seconds 5

  # ── Config refresh ────────────────────────────────────────────────────────
  if (((Get-Date) - $lastConfigRefresh).TotalMinutes -ge $ConfigRefreshMin) {
    Refresh-Config
    $lastConfigRefresh = Get-Date
  }

  # ── Drain the watcher queue ───────────────────────────────────────────────
  $item = $null
  while ($syncQueue.TryDequeue([ref]$item)) {
    Write-Log "File event: $item"
    # Each new event resets the debounce timer (handles rapid successive writes).
    $pendingFile = $item
    $pendingAt   = Get-Date
  }

  # ── Debounce: fire sync if the file has been stable for $DebounceSeconds ──
  if ($pendingFile -and $pendingAt -and ((Get-Date) - $pendingAt).TotalSeconds -ge $DebounceSeconds) {
    Run-Sync -TriggerFile $pendingFile -Reason "file event (debounced $DebounceSeconds s)"
    $pendingFile = $null
    $pendingAt   = $null
  }

  # ── 5-minute polling fallback ─────────────────────────────────────────────
  # FileSystemWatcher is unreliable on network drives (Y:\ etc.) because the
  # OS may not forward change notifications across the network protocol.
  # This poll checks every 5 minutes for a file newer than the last sync,
  # acting as a guaranteed safety net regardless of watcher status.
  if (((Get-Date) - $script:lastPollAt).TotalMinutes -ge 5) {
    $script:lastPollAt = Get-Date
    if ($script:watchedFolder -and (Test-Path $script:watchedFolder -ErrorAction SilentlyContinue)) {
      try {
        $filterPatt = if ($script:filePattern) { $script:filePattern } else { '*.xlsx' }
        $files = Get-ChildItem -Path $script:watchedFolder -Filter $filterPatt -File -ErrorAction Stop
        if ($script:namePrefix) {
          $files = $files | Where-Object { $_.Name.StartsWith($script:namePrefix, [System.StringComparison]::OrdinalIgnoreCase) }
        }
        $newest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($newest -and $newest.LastWriteTime -gt $script:lastSyncAt) {
          Write-Log "Poll: new/modified file detected since last sync: $($newest.Name) (modified $($newest.LastWriteTime)). Queuing."
          $syncQueue.Enqueue($newest.FullName)
        }
      } catch {
        Write-Log "Poll check failed: $($_.Exception.Message)" "WARN"
      }
    }
  }

  # ── Daily heartbeat ───────────────────────────────────────────────────────
  if ((Test-HeartbeatDue)) {
    Run-Sync -Reason "daily heartbeat ($($script:scheduleTime))"
  }
}
