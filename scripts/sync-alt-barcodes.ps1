# Daily Alternate-Barcode sync.
# Reads the latest .xlsx from the ALT-Barcode folder and pushes the rows to
# the Homesavers Scanner /api/alt-barcodes/sync endpoint, then records a
# sync_runs row (import time, record count, file size, status) that the app
# shows under Admin -> Settings.
#
# Run by Windows Task Scheduler. Folder/pattern/sheet come from Admin ->
# Settings (alt_barcode_sync_*), fetched at start so the office can change
# them without editing this script. See README-sync-products.md for setup;
# this script reuses the same C:\Homesavers\.sync-secret file.

[CmdletBinding()]
param(
  [string]$ExcelPath,                 # force a specific file (optional)
  [string]$Folder,                    # override the configured folder
  [string]$FilePattern,
  [string]$Sheet,
  [string]$BaseUrl    = "https://homesaversscanner.pages.dev",
  [string]$SecretFile = "C:\Homesavers\.sync-secret",
  [string]$LogPath    = "C:\Homesavers\logs\sync-alt-barcodes.log",
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

$secret  = $null
$headers = $null
$recordsImported = 0
$recordsSkipped  = 0
$fileName = ""
$fileSize = 0

# Post a sync_runs row to the app (best-effort).
function Send-RunStatus {
  param([string]$Status, [string]$Message)
  if (-not $headers) { return }
  try {
    $body = @{
      kind             = "alt_barcodes"
      file_name        = $fileName
      file_size_bytes  = $fileSize
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
  Write-Log "=== Alt-barcode sync starting ==="

  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $secret = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $secret) { throw "Secret file is empty: $SecretFile" }
  $headers = @{ "X-Sync-Secret" = $secret; "Content-Type" = "application/json" }

  # Pull folder/pattern/sheet from the app unless overridden on the CLI.
  if (-not $ExcelPath -or -not $Sheet -or -not $Folder -or -not $FilePattern) {
    try {
      $cfg = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/alt-barcodes/sync-config" -Headers $headers -TimeoutSec 30
      if (-not $Folder)      { $Folder      = $cfg.folder }
      if (-not $FilePattern) { $FilePattern = $cfg.file_pattern }
      if (-not $Sheet)       { $Sheet       = $cfg.sheet }
      Write-Log "Config: folder='$Folder' pattern='$FilePattern' sheet='$Sheet' schedule='$($cfg.schedule) at $($cfg.time)' (set this in Task Scheduler)"
    } catch { Write-Log "Could not fetch config: $($_.Exception.Message). Using defaults." "WARN" }
  }

  if (-not $ExcelPath) {
    if (-not $Folder)      { throw "No folder configured (set alt_barcode_sync_folder in Admin -> Settings or pass -Folder)" }
    if (-not $FilePattern) { $FilePattern = '*.xlsx' }
    if (-not (Test-Path $Folder)) { throw "Folder not accessible: $Folder. Check the network drive is mapped for this account." }
    $candidates = Get-ChildItem -Path $Folder -Filter $FilePattern -File -ErrorAction Stop | Sort-Object LastWriteTime -Descending
    if (-not $candidates -or $candidates.Count -eq 0) { throw "No files matching '$FilePattern' in $Folder" }
    $ExcelPath = $candidates[0].FullName
  }
  if (-not $Sheet) { $Sheet = "1" }
  if (-not (Test-Path $ExcelPath)) { throw "Excel file not found: $ExcelPath" }

  $fi = Get-Item $ExcelPath
  $fileName = $fi.Name
  $fileSize = $fi.Length
  Write-Log "File: $ExcelPath ($([Math]::Round($fileSize/1MB,1)) MB, modified $($fi.LastWriteTime))"

  if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    throw "ImportExcel not installed. Run once: Install-Module ImportExcel -Scope CurrentUser"
  }
  Import-Module ImportExcel
  $importArgs = @{ Path = $ExcelPath; ErrorAction = "Stop" }
  if ($Sheet -match '^\d+$') { $importArgs["WorksheetName"] = (Get-ExcelSheetInfo -Path $ExcelPath)[[int]$Sheet - 1].Name }
  else                       { $importArgs["WorksheetName"] = $Sheet }
  $excelRows = Import-Excel @importArgs
  Write-Log "Parsed $($excelRows.Count) row(s) from sheet '$($importArgs.WorksheetName)'"

  # Build the field -> source-column map once (case-insensitive, with aliases).
  $aliases = @{
    "barcode_no"     = @("barcode_no","barcodeno","barcode","barcode_number","alt_barcode","altbarcode")
    "ean_barcode"    = @("ean_barcode","ean","eanbarcode")
    "item_name"      = @("item_name","itemname","name","description","product_name")
    "supl_id"        = @("supl_id","suplid","supplier_id","supplierid")
    "supplier_code"  = @("supplier_code","suppliercode","supl_code")
    "item_status"    = @("item_status","itemstatus","product_status","status")
    "barcode_status" = @("barcode_status","barcodestatus","bc_status")
  }
  $headerByLower = @{}
  foreach ($h in @($excelRows[0].PSObject.Properties.Name)) { $headerByLower[$h.Trim().ToLower()] = $h }
  $fieldToSource = @{}
  foreach ($field in $aliases.Keys) {
    foreach ($alias in $aliases[$field]) {
      $src = $headerByLower[$alias.ToLower()]
      if ($src) { $fieldToSource[$field] = $src; break }
    }
  }
  Write-Log "Header map: $((($fieldToSource.GetEnumerator() | ForEach-Object { "$($_.Key)<-$($_.Value)" }) -join ', '))"
  if (-not $fieldToSource.ContainsKey("barcode_no")) {
    throw "No Barcode_No column found. Columns: $(@($excelRows[0].PSObject.Properties.Name) -join ', ')"
  }

  $payload = New-Object System.Collections.Generic.List[hashtable]
  foreach ($r in $excelRows) {
    $row = @{}
    foreach ($field in $fieldToSource.Keys) {
      $v = $r.($fieldToSource[$field])
      if ($null -ne $v) { $s = "$v".Trim(); if ($s -ne "") { $row[$field] = $s } }
    }
    $bno = if ($row.ContainsKey("barcode_no")) { $row["barcode_no"] } else { "" }
    if (-not $bno -or $bno -eq "0") { $recordsSkipped++; continue }   # Barcode_No must be a real value
    $payload.Add($row) | Out-Null
  }
  Write-Log "Prepared $($payload.Count) row(s), skipped $recordsSkipped (no/zero Barcode_No)"
  if ($payload.Count -eq 0) { throw "No rows with a valid Barcode_No" }

  # ── De-duplicate on Barcode_No ────────────────────────────────────────────
  # Barcode_No is the primary key. When the same Barcode_No appears more than
  # once, keep the Active barcode and drop the 'DeActive' one. (Status words:
  # Active -> Active, DeActive/De-Actived -> Inactive.) If every duplicate is
  # inactive, keep the first. This must run BEFORE chunking so the right row
  # survives regardless of where chunk boundaries fall.
  function Test-ActiveStatus {
    param([string]$Value)
    if (-not $Value) { return $false }
    return (($Value -replace '[^A-Za-z]', '').ToLower() -eq 'active')
  }
  $byKey = [ordered]@{}
  $dupDropped = 0
  foreach ($row in $payload) {
    $key = "$($row['barcode_no'])"
    $isActive = Test-ActiveStatus $row['barcode_status']
    if (-not $byKey.Contains($key)) {
      $byKey[$key] = $row
    } else {
      $dupDropped++
      $existingActive = Test-ActiveStatus $byKey[$key]['barcode_status']
      # Replace the kept row only when the incoming one is Active and the
      # one we already have is not — i.e. always prefer the Active barcode.
      if ($isActive -and -not $existingActive) { $byKey[$key] = $row }
    }
  }
  $deduped = New-Object System.Collections.Generic.List[hashtable]
  foreach ($v in $byKey.Values) { $deduped.Add($v) | Out-Null }
  $recordsSkipped += $dupDropped
  $payload = $deduped
  Write-Log "After de-dup on Barcode_No: $($payload.Count) row(s), dropped $dupDropped duplicate(s) (kept Active over DeActive)"
  if ($payload.Count -eq 0) { throw "No rows after de-duplication" }

  if ($DryRun) {
    Write-Log "DryRun -- first row: $($payload[0] | ConvertTo-Json -Compress)"
    Write-Log "=== Dry run complete ==="
    exit 0
  }

  $ChunkSize = 2000
  for ($offset = 0; $offset -lt $payload.Count; $offset += $ChunkSize) {
    $slice = $payload.GetRange($offset, [Math]::Min($ChunkSize, $payload.Count - $offset))
    $bodyJson = $slice | ConvertTo-Json -Depth 3 -Compress
    $chunkNum = [Math]::Floor($offset / $ChunkSize) + 1
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/alt-barcodes/sync" -Headers $headers -Body $bodyJson -TimeoutSec 300
    $recordsImported += [int]$resp.written
    $recordsSkipped  += [int]$resp.skipped
    Write-Log ("Chunk {0}: written={1} skipped={2}" -f $chunkNum, $resp.written, $resp.skipped)
  }

  Write-Log "Totals: imported=$recordsImported skipped=$recordsSkipped"
  Send-RunStatus -Status "ok" -Message "Imported $recordsImported, skipped $recordsSkipped"
  Write-Log "=== Alt-barcode sync finished OK ==="
  exit 0
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)" "ERROR"
  Send-RunStatus -Status "error" -Message $_.Exception.Message
  exit 1
}
