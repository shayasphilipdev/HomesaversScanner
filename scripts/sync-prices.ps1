# Prices (ItemMaster) sync.
# Reads the latest ItemMaster*.xlsx from the configured folder, extracts
# EAN_Barcode, ItemGroup, ItemSubGrp_Id, ProductType, SaleRate from the
# ItemMaster sheet, and pushes the rows to /api/prices/sync.
#
# Run by sync-prices-service.ps1 (file watcher + daily heartbeat) or
# directly by Windows Task Scheduler.
# Reuses the same C:\Homesavers\.sync-secret file as the alt-barcode job.

[CmdletBinding()]
param(
  [string]$ExcelPath,                 # force a specific file (optional)
  [string]$Folder,                    # override the configured folder
  [string]$FilePattern,
  [string]$NamePrefix,                # only files whose name starts with this
  [string]$Sheet,
  [string]$BaseUrl    = "https://homesaversscanner.pages.dev",
  [string]$SecretFile = "C:\Homesavers\.sync-secret",
  [string]$LogPath    = "C:\Homesavers\logs\sync-prices.log",
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

function Send-RunStatus {
  param([string]$Status, [string]$Message)
  if (-not $headers) { return }
  try {
    $body = @{
      kind             = "prices"
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
  Write-Log "=== Prices (ItemMaster) sync starting ==="

  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $secret = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $secret) { throw "Secret file is empty: $SecretFile" }
  $headers = @{ "X-Sync-Secret" = $secret; "Content-Type" = "application/json" }

  # Pull config from the app unless overridden on the CLI.
  if (-not $ExcelPath -or -not $Sheet -or -not $Folder -or -not $FilePattern -or -not $NamePrefix) {
    try {
      $cfg = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/prices/sync-config" -Headers $headers -TimeoutSec 30
      if (-not $Folder)      { $Folder      = $cfg.folder }
      if (-not $FilePattern) { $FilePattern = $cfg.file_pattern }
      if (-not $Sheet)       { $Sheet       = $cfg.sheet }
      if (-not $NamePrefix)  { $NamePrefix  = $cfg.name_prefix }
      Write-Log "Config: folder='$Folder' pattern='$FilePattern' nameStartsWith='$NamePrefix' sheet='$Sheet'"
    } catch { Write-Log "Could not fetch config: $($_.Exception.Message). Using defaults." "WARN" }
  }

  if (-not $ExcelPath) {
    if (-not $Folder)      { throw "No folder configured (set prices_sync_folder in Admin -> Settings or pass -Folder)" }
    if (-not $FilePattern) { $FilePattern = '*.xlsx' }
    if (-not (Test-Path $Folder)) { throw "Folder not accessible: $Folder. Check the network drive is mapped." }
    $candidates = Get-ChildItem -Path $Folder -Filter $FilePattern -File -ErrorAction Stop
    if ($NamePrefix) {
      $candidates = $candidates | Where-Object { $_.Name.StartsWith($NamePrefix, [System.StringComparison]::OrdinalIgnoreCase) }
    }
    $candidates = $candidates | Sort-Object LastWriteTime -Descending
    if (-not $candidates -or $candidates.Count -eq 0) {
      $hint = if ($NamePrefix) { " starting with '$NamePrefix'" } else { "" }
      throw "No files matching '$FilePattern'$hint in $Folder"
    }
    $ExcelPath = $candidates[0].FullName
  }
  if (-not $Sheet) { $Sheet = "ItemMaster" }
  if (-not (Test-Path $ExcelPath)) { throw "Excel file not found: $ExcelPath" }

  $fi = Get-Item $ExcelPath
  $fileName = $fi.Name
  $fileSize = $fi.Length
  Write-Log "File: $ExcelPath ($([Math]::Round($fileSize/1MB,1)) MB, modified $($fi.LastWriteTime))"

  # Copy to local temp before processing -- Import-Excel crashes or hangs
  # reading large files directly over a network share.
  $localCopy = Join-Path $env:TEMP $fi.Name
  Write-Log "Copying to local temp: $localCopy"
  Copy-Item -Path $ExcelPath -Destination $localCopy -Force
  Write-Log "Copy complete."

  if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    throw "ImportExcel not installed. Run once: Install-Module ImportExcel -Scope CurrentUser"
  }
  Import-Module ImportExcel
  $importArgs = @{ Path = $localCopy; ErrorAction = "Stop" }
  if ($Sheet -match '^\d+$') { $importArgs["WorksheetName"] = (Get-ExcelSheetInfo -Path $localCopy)[[int]$Sheet - 1].Name }
  else                       { $importArgs["WorksheetName"] = $Sheet }
  $excelRows = Import-Excel @importArgs
  Write-Log "Parsed $($excelRows.Count) row(s) from sheet '$($importArgs.WorksheetName)'"
  Remove-Item $localCopy -Force -ErrorAction SilentlyContinue

  # Column aliases — maps our field names to possible Excel column headers.
  $aliases = @{
    "ean_barcode"    = @("ean_barcode","eanbarcode","ean","article_number","articleno")
    "item_group"     = @("itemgroup","item_group","department","dept")
    "item_subgrp_id" = @("itemsubgrp_id","item_subgrp_id","subgroup","subgrp_id","subgrpid","itemsubgrpid")
    "product_type"   = @("producttype","product_type","type")
    "sale_rate"      = @("salerate","sale_rate","sellingprice","selling_price","price","retail_price")
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
  if (-not $fieldToSource.ContainsKey("ean_barcode")) {
    throw "No EAN_Barcode column found. Columns: $(@($excelRows[0].PSObject.Properties.Name) -join ', ')"
  }

  $payload = New-Object System.Collections.Generic.List[hashtable]
  foreach ($r in $excelRows) {
    $row = @{}
    foreach ($field in $fieldToSource.Keys) {
      $v = $r.($fieldToSource[$field])
      if ($null -ne $v) { $s = "$v".Trim(); if ($s -ne "") { $row[$field] = $s } }
    }
    $ean = if ($row.ContainsKey("ean_barcode")) { $row["ean_barcode"] } else { "" }
    if (-not $ean -or $ean -eq "0") { $recordsSkipped++; continue }
    $payload.Add($row) | Out-Null
  }
  Write-Log "Prepared $($payload.Count) row(s), skipped $recordsSkipped (no EAN)"
  if ($payload.Count -eq 0) { throw "No rows with a valid EAN_Barcode" }

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
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/prices/sync" -Headers $headers -Body $bodyJson -TimeoutSec 300
    $recordsImported += [int]$resp.written
    $recordsSkipped  += [int]$resp.skipped
    Write-Log ("Chunk {0}: written={1} skipped={2}" -f $chunkNum, $resp.written, $resp.skipped)
  }

  Write-Log "Totals: imported=$recordsImported skipped=$recordsSkipped"
  Send-RunStatus -Status "ok" -Message "Imported $recordsImported, skipped $recordsSkipped"
  Write-Log "=== Prices sync finished OK ==="
  exit 0
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)" "ERROR"
  Send-RunStatus -Status "error" -Message $_.Exception.Message
  exit 1
}
