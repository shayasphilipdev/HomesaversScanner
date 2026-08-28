# Deploy the runtime scripts to C:\Homesavers\scripts.
#
# WHY THIS EXISTS
# ---------------
# The scheduled tasks used to execute scripts straight out of the git working
# tree (C:\Scraping\homesavers-scanner\scripts). That makes the nightly jobs
# depend on whichever branch happens to be checked out: the `test` branch was
# missing the B&M / CN sync scripts entirely, and run_sync.bat differed between
# branches, so an ordinary `git checkout test` would silently break the syncs.
#
# The tasks now run from C:\Homesavers\scripts, which is a stable deployed copy
# that no branch switch can touch. Run this after pulling changes that affect
# any of the files below.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-scripts.ps1
#
# Idempotent: copies only what changed and prints what it did.

$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = 'C:\Homesavers\scripts'

if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

# Everything a scheduled task needs at runtime. The *.ps1 sync scripts already
# live in $dst and are edited there, so they are not listed here.
$files = @(
  'run_sync.bat',            # wrapper the Item Master / Prices / B&M tasks call
  'sync-prices.py',
  'sync-alt-barcodes.py',
  'local_upload_server.py',  # run_sync.bat "server" job
  'manifest-generator.py',
  'run-manifest.vbs',
  'aging-report.py'
)

# Git-ignored, so it only exists locally — copy it if present, never fail on it.
$optional = @('aging-report.config.json')

$copied = 0; $skipped = 0; $missing = @()

foreach ($f in ($files + $optional)) {
  $s = Join-Path $src $f
  $d = Join-Path $dst $f
  if (-not (Test-Path $s)) {
    if ($optional -contains $f) { Write-Host "  (optional, absent) $f" -ForegroundColor DarkGray }
    else { $missing += $f }
    continue
  }
  $same = (Test-Path $d) -and
          ((Get-FileHash $s -Algorithm SHA256).Hash -eq (Get-FileHash $d -Algorithm SHA256).Hash)
  if ($same) { Write-Host "  unchanged  $f" -ForegroundColor DarkGray; $skipped++ }
  else       { Copy-Item $s $d -Force; Write-Host "  DEPLOYED   $f" -ForegroundColor Green; $copied++ }
}

Write-Host ""
Write-Host ("Deployed {0}, unchanged {1}, target {2}" -f $copied, $skipped, $dst)
if ($missing.Count) {
  Write-Host ("MISSING from the repo (wrong branch checked out?): {0}" -f ($missing -join ', ')) -ForegroundColor Red
  exit 1
}
