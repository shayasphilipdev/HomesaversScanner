# B&M Daily File sync.
#
# Reads the LATEST HomeSavers_*.xlsx from the Supply Chain B&M Product File
# folder, keeps ONLY the ProductID column (= ean_barcode / the same key as
# prices.ean_barcode and cn_code_master.product_prism_code), and full-replaces
# the bm_daily_file table. Feeds the B&M Reductions report.
#
#   latest .xlsx in the folder  ->  keep ProductID, de-dupe
#   POST /api/bm-daily/sync/reset   (empty the table)
#   POST /api/bm-daily/sync         (insert in chunks)
#
# Reuses C:\Homesavers\.sync-secret (same secret as the ItemMaster jobs).
# Schedule daily with Task Scheduler (see scripts/README-cn-codes.md for the pattern).

[CmdletBinding()]
param(
  # UNC path (not the Y: mapped drive) so it also resolves when the task runs
  # unattended / whether-logged-on-or-not, where per-user drive maps don't exist.
  [string]$Folder      = "\\192.168.1.205\Buying Data\Supply Chain & Buying - Shared\Data\B&M Product File Excel\2026",
  [string]$FilePattern = "HomeSavers_*.xlsx",
  [string]$Sheet       = "First Sheet",
  [string]$Column      = "ProductID",
  [string]$BaseUrl     = "https://homesaversscanner.pages.dev",
  [string]$SecretFile  = "C:\Homesavers\.sync-secret",
  [string]$LogPath     = "C:\Homesavers\logs\sync-bm-daily.log",
  [int]$ChunkSize      = 5000,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$startedAt = (Get-Date).ToUniversalTime().ToString("o")

function Write-Log {
  param([string]$Message, [string]$Level = "INFO")
  $line = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Level, $Message
  Write-Host $line
  try {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $LogPath -Value $line
  } catch { Write-Host "WARN: could not write log: $($_.Exception.Message)" }
}

# PS 5.1 collapses a single-element array to a scalar in ConvertTo-Json; always
# emit a real JSON array so the endpoint accepts the body.
function ConvertTo-JsonArray {
  param($Items)
  $arr = @($Items)
  if ($arr.Count -eq 0) { return '[]' }
  if ($arr.Count -eq 1) { return '[' + ($arr[0] | ConvertTo-Json -Compress) + ']' }
  return (ConvertTo-Json -InputObject $arr -Compress)
}

$headers = $null
$recordsImported = 0
$recordsSkipped  = 0

function Send-RunStatus {
  param([string]$Status, [string]$Message, [int]$Total = 0)
  if (-not $headers) { return }
  try {
    $body = @{
      kind             = "bm_daily"
      file_name        = $script:fileName
      file_size_bytes  = $Total
      records_imported = $recordsImported
      records_skipped  = $recordsSkipped
      status           = $Status
      message          = $Message
      started_at       = $startedAt
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/sync-runs" -Headers $headers -Body $body -TimeoutSec 60 | Out-Null
  } catch { Write-Log "Could not record sync run: $($_.Exception.Message)" "WARN" }
}

try {
  Write-Log "=== B&M Daily File sync starting ==="

  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $secret = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $secret) { throw "Secret file is empty: $SecretFile" }
  $headers = @{ "X-Sync-Secret" = $secret; "Content-Type" = "application/json" }

  # --- find the latest file ---
  if (-not (Test-Path $Folder)) { throw "Folder not accessible: $Folder (is the Y: drive mapped?)" }
  $file = Get-ChildItem -Path $Folder -Filter $FilePattern -File -ErrorAction Stop |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { throw "No files matching '$FilePattern' in $Folder" }
  $script:fileName = $file.Name
  Write-Log "Latest file: $($file.Name) ($([math]::Round($file.Length/1MB,1)) MB, modified $($file.LastWriteTime))"

  # --- read ONLY the ProductID column via Excel COM (fast single-column read) ---
  $codes = New-Object 'System.Collections.Generic.HashSet[string]'
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false
  try {
    $wb = $xl.Workbooks.Open($file.FullName, 0, $true)   # ReadOnly
    $ws = $null
    if ($Sheet -match '^\d+$') {
      $ws = $wb.Worksheets([int]$Sheet)
    } else {
      foreach ($s in $wb.Worksheets) { if ($s.Name.Trim().ToLower() -eq $Sheet.Trim().ToLower()) { $ws = $s; break } }
    }
    if (-not $ws) { $ws = $wb.Worksheets(1) }

    $used  = $ws.UsedRange
    $nRows = $used.Rows.Count
    $nCols = [Math]::Min($used.Columns.Count, 60)

    $aliases = @($Column, 'ProductID', 'Product ID', 'product_id', 'ProductId')
    $col = 0
    for ($c = 1; $c -le $nCols; $c++) {
      $h = ("" + $ws.Cells(1, $c).Text).Trim()
      if ($aliases -contains $h) { $col = $c; break }
    }
    if ($col -eq 0) { throw "Column '$Column' not found in sheet '$($ws.Name)'." }
    Write-Log "Sheet '$($ws.Name)', ProductID at column $col, $($nRows - 1) data rows."

    if ($nRows -ge 2) {
      $vals = $ws.Range($ws.Cells(2, $col), $ws.Cells($nRows, $col)).Value2
      if ($vals -is [Array]) {
        foreach ($v in $vals) {
          if ($null -eq $v) { $recordsSkipped++; continue }
          $s = ("" + $v).Trim()
          if ($s -eq "" -or $s -eq "0") { $recordsSkipped++; continue }
          [void]$codes.Add($s)
        }
      } elseif ($null -ne $vals) {
        $s = ("" + $vals).Trim(); if ($s -and $s -ne "0") { [void]$codes.Add($s) }
      }
    }
    $wb.Close($false)
  } finally {
    $xl.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
  }

  $list = @($codes)
  Write-Log "Distinct ProductID: $($list.Count) (skipped $recordsSkipped blank)"
  if ($list.Count -eq 0) { throw "No ProductID values found -- not touching the table." }

  if ($DryRun) {
    Write-Log ("DryRun -- first 10: " + (($list | Select-Object -First 10) -join ', '))
    Write-Log "=== Dry run complete (table NOT modified) ==="
    exit 0
  }

  # --- full replace: empty first (only after a good read), then insert in chunks ---
  Write-Log "Reset (truncate) bm_daily_file..."
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/bm-daily/sync/reset" -Headers $headers -TimeoutSec 120 | Out-Null

  for ($offset = 0; $offset -lt $list.Count; $offset += $ChunkSize) {
    $take  = [Math]::Min($ChunkSize, $list.Count - $offset)
    $slice = $list[$offset..($offset + $take - 1)]
    $bodyJson = ConvertTo-JsonArray $slice
    $chunkNum = [Math]::Floor($offset / $ChunkSize) + 1
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/bm-daily/sync" -Headers $headers -Body $bodyJson -TimeoutSec 300
    $recordsImported += [int]$resp.written
    Write-Log ("Chunk {0}: written={1}" -f $chunkNum, $resp.written)
  }

  Write-Log "Totals: imported=$recordsImported skipped=$recordsSkipped"
  Send-RunStatus -Status "ok" -Message "Imported $recordsImported ProductIDs" -Total $list.Count
  Write-Log "=== B&M Daily sync finished OK ==="
  exit 0
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)" "ERROR"
  Send-RunStatus -Status "error" -Message $_.Exception.Message
  exit 1
}
