# Phase 1 of docs/post-wipe-restoration-plan.md: get a freshly installed PC
# ready to run the sync scripts. Safe to re-run; it only installs or creates
# what is missing and ends with a PASS / WARN / FAIL summary.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-new-pc.ps1
#
# FAIL = blocks the urgent Phase 3 uploads (Item Master, Alt-barcodes, B&M Daily).
# WARN = only needed by a later phase (CN codes, manifest, emails).

[CmdletBinding()]
param([switch]$NoInstall)

$ErrorActionPreference = 'Continue'
$BaseUrl  = 'https://homesaversscanner.pages.dev'
$Home_    = 'C:\Homesavers'
$PyKnown  = 'C:\Users\shayas\AppData\Local\Programs\Python\Python313\python.exe'  # path run_sync.bat / run-manifest.vbs try first

# Source folders, as configured in Admin -> Settings (prices / alt-barcodes) and
# in sync-bm-daily.ps1. UNC paths, so they work without drive letters mapped.
$Sources = @(
  @{ Name = 'Item Master (prices)'; Path = '\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster\2026';           Pattern = 'ItemMaster*.xlsx' },
  @{ Name = 'Alternate Barcodes';   Path = '\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster-ALTBarcode\2026'; Pattern = 'ALT Barcode Master*.xlsx' },
  @{ Name = 'B&M Daily';            Path = '\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\B&M Product File Excel\2026';                    Pattern = 'HomeSavers_*.xlsx' }
)

$results = New-Object System.Collections.ArrayList
function Add-Result([string]$Level, [string]$Check, [string]$Detail) {
  [void]$results.Add([pscustomobject]@{ Result = $Level; Check = $Check; Detail = $Detail })
  $colour = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }[$Level]
  Write-Host ("[{0}] {1} - {2}" -f $Level, $Check, $Detail) -ForegroundColor $colour
}

function Find-Python {
  foreach ($p in @($PyKnown, "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe")) {
    if (Test-Path $p) { return $p }
  }
  foreach ($cmd in @('py', 'python')) {
    $c = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($c) {
      $exe = & $cmd -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe -and $exe -notmatch 'WindowsApps') { return $exe.Trim() }
    }
  }
  return $null
}

Write-Host "`n=== Homesavers new-PC setup (Phase 1) ===`n" -ForegroundColor Cyan

# 1. Python
$py = Find-Python
if (-not $py -and -not $NoInstall -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "Python not found - installing Python 3.13 with winget..."
  winget install --id Python.Python.3.13 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
  $py = Find-Python
}
if ($py) {
  $ver = & $py --version 2>&1
  Add-Result 'PASS' 'Python' "$ver at $py"
  # run_sync.bat and run-manifest.vbs read this first, so the jobs use exactly this Python.
  if (-not (Test-Path $Home_)) { New-Item -ItemType Directory -Path $Home_ -Force | Out-Null }
  Set-Content -Path "$Home_\python-path.txt" -Value $py -NoNewline -Encoding ascii
  if ($py -ne $PyKnown) {
    $hasPy = [bool](Get-Command py -ErrorAction SilentlyContinue)
    $hasPython = [bool](Get-Command python -ErrorAction SilentlyContinue)
    if ($hasPy -and $hasPython) { Add-Result 'PASS' 'Python launcher' "run_sync.bat falls back to 'py', run-manifest.vbs to 'python' - both found" }
    else { Add-Result 'WARN' 'Python launcher' "'py'/'python' not both on PATH yet - open a NEW PowerShell window and re-run; if it persists, reinstall Python with 'Add python.exe to PATH' ticked" }
  }
} else {
  Add-Result 'FAIL' 'Python' 'Not installed. Install Python 3.13 from python.org (tick "Add python.exe to PATH"), then re-run this script.'
}

# 2. Python packages
if ($py) {
  if (-not $NoInstall) {
    Write-Host "Installing/updating requests, pandas, openpyxl..."
    & $py -m pip install --quiet --upgrade requests pandas openpyxl 2>&1 | Out-Host
  }
  & $py -c "import requests, pandas, openpyxl" 2>$null
  if ($LASTEXITCODE -eq 0) { Add-Result 'PASS' 'Python packages' 'requests, pandas, openpyxl import OK' }
  else { Add-Result 'FAIL' 'Python packages' "Missing. Run: `"$py`" -m pip install requests pandas openpyxl" }
}

# 3. Microsoft Excel - sync-bm-daily.ps1 opens the B&M file through Excel itself
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  Add-Result 'PASS' 'Microsoft Excel' 'installed (needed by the B&M Daily sync)'
} catch {
  Add-Result 'FAIL' 'Microsoft Excel' 'Not installed. The B&M Daily sync reads its file through Excel - install Microsoft Office/Excel on this PC.'
}

# 4. Working folders
foreach ($d in @($Home_, "$Home_\scripts", "$Home_\logs", "$Home_\manifest-preview")) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Add-Result 'PASS' 'Working folders' "$Home_ (scripts, logs, manifest-preview)"

# 5. Website reachable
try {
  $ping = Invoke-RestMethod -Uri "$BaseUrl/api/ping" -TimeoutSec 30
  Add-Result 'PASS' 'Website' "reachable, live build rev $($ping.rev)"
} catch {
  Add-Result 'FAIL' 'Website' "Can't reach $BaseUrl/api/ping - $($_.Exception.Message)"
}

# 6. The three critical source folders, and whether fresh files are still arriving
foreach ($s in $Sources) {
  if (-not (Test-Path -LiteralPath $s.Path)) {
    Add-Result 'FAIL' $s.Name "Can't open $($s.Path) - check this PC/user has access to \\192.168.1.205\Buying Data"
    continue
  }
  $latest = Get-ChildItem -LiteralPath $s.Path -Filter $s.Pattern -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { Add-Result 'FAIL' $s.Name "Folder opens but has no $($s.Pattern) files"; continue }
  $age = [math]::Floor(((Get-Date) - $latest.LastWriteTime).TotalDays)
  $detail = "newest file $($latest.Name), saved $($latest.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
  if ($age -le 2) { Add-Result 'PASS' $s.Name $detail }
  else { Add-Result 'WARN' $s.Name "$detail - $age days old; is the system that produces this file still running?" }
}

# 7. Later phases: manifest drives and the CN-code app
$manifestIn  = 'U:\Finance Dept-Shared Folder\B&M - Homesavers Shared Database\Live\Inbound file\Delivery Manifest'
$manifestOut = 'Y:\Supply Chain\SUPPLY CHAIN 2026\STORE MANIFEST'
if (Test-Path -LiteralPath $manifestIn)  { Add-Result 'PASS' 'Manifest input (U:)' $manifestIn }
else { Add-Result 'WARN' 'Manifest input (U:)' "Not reachable - map the U: drive (Finance shared folder) before Phase 5" }
if (Test-Path -LiteralPath $manifestOut) { Add-Result 'PASS' 'Manifest output (Y:)' $manifestOut }
else { Add-Result 'WARN' 'Manifest output (Y:)' 'Not reachable - map Y: to \\192.168.1.205\Buying Data before Phase 5' }

$cn = Test-NetConnection -ComputerName 86.43.71.253 -Port 4000 -WarningAction SilentlyContinue
if ($cn.TcpTestSucceeded) { Add-Result 'PASS' 'CN-code app' '86.43.71.253:4000 reachable' }
else { Add-Result 'WARN' 'CN-code app' '86.43.71.253:4000 not reachable from this PC - needed for Phase 4 only' }

# 8. Deploy the runtime scripts to C:\Homesavers\scripts
$deploy = Join-Path $PSScriptRoot 'deploy-scripts.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $deploy | Out-Host
$needed = 'run_sync.bat', 'sync-prices.py', 'sync-alt-barcodes.py', 'sync-bm-daily.ps1', 'sync-cn-codes.ps1'
$absent = $needed | Where-Object { -not (Test-Path (Join-Path "$Home_\scripts" $_)) }
if ($absent) { Add-Result 'FAIL' 'Deployed scripts' "missing from $Home_\scripts: $($absent -join ', ')" }
else { Add-Result 'PASS' 'Deployed scripts' "$Home_\scripts has everything the syncs need" }

# 9. Phase 2 readiness
if (Test-Path "$Home_\.sync-secret") { Add-Result 'PASS' 'Sync secret' "$Home_\.sync-secret present" }
else { Add-Result 'WARN' 'Sync secret' "Not set yet - that's Phase 2 (new PRODUCT_SYNC_SECRET in Cloudflare + $Home_\.sync-secret)" }

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize -Wrap | Out-Host
$fails = @($results | Where-Object Result -eq 'FAIL').Count
if ($fails) {
  Write-Host "$fails item(s) FAILED - fix these and re-run before Phase 3." -ForegroundColor Red
  exit 1
}
Write-Host 'Phase 1 done for the urgent uploads. Next: Phase 2 (sync secret).' -ForegroundColor Green
