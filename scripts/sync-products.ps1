# Daily product master sync.
# Reads an Excel file from a local folder and pushes the rows to the
# Homesavers Scanner /api/products/sync endpoint as JSON.
#
# Designed to be run by Windows Task Scheduler once a day. See
# README-sync-products.md for setup steps.

[CmdletBinding()]
param(
  # Override the source folder / file. By default the script asks the app
  # for the folder + glob (settings under Admin -> Settings) and picks the
  # newest matching file. Pass -ExcelPath to force a specific file.
  [string]$ExcelPath,
  [string]$Folder,
  [string]$FilePattern,

  # Which sheet to read. "1" = first sheet by index, or pass the sheet name.
  # Pulled from app settings by default; override with -Sheet.
  [string]$Sheet,

  # App base URL. Both the config and sync endpoints live under it.
  [string]$BaseUrl = "https://homesaversscanner.pages.dev",

  # Path to a plain text file holding the shared secret on one line.
  # Keep it outside of OneDrive / source control. The Cloudflare Pages env
  # var PRODUCT_SYNC_SECRET must match this value.
  [string]$SecretFile = "C:\Homesavers\.sync-secret",

  # Where to write the daily log. The folder must exist.
  [string]$LogPath = "C:\Homesavers\logs\sync-products.log",

  # If set, parses the Excel and prints a summary but doesn't POST.
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param([string]$Message, [string]$Level = "INFO")
  $line = "{0:yyyy-MM-dd HH:mm:ss} [{1}] {2}" -f (Get-Date), $Level, $Message
  Write-Host $line
  try {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -Path $LogPath -Value $line
  } catch {
    # Logging is best-effort -- never let a log write break the sync.
    Write-Host "WARN: could not write log: $($_.Exception.Message)"
  }
}

try {
  Write-Log "=== Product sync starting ==="
  Write-Log "Base URL: $BaseUrl"

  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $secret = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $secret) { throw "Secret file is empty: $SecretFile" }
  $headers = @{ "X-Sync-Secret" = $secret; "Content-Type" = "application/json" }

  # Pull folder / file pattern / sheet from Admin -> Settings unless the user
  # passed explicit overrides on the command line. This is what lets the
  # office change the folder via the UI without anyone editing this script.
  if (-not $ExcelPath -or -not $Sheet -or -not $Folder -or -not $FilePattern) {
    try {
      $cfg = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/products/sync-config" -Headers $headers -TimeoutSec 30
      if (-not $Folder)      { $Folder      = $cfg.folder }
      if (-not $FilePattern) { $FilePattern = $cfg.file_pattern }
      if (-not $Sheet)       { $Sheet       = $cfg.sheet }
      Write-Log "Fetched sync config: folder='$Folder' pattern='$FilePattern' sheet='$Sheet'"
    } catch {
      Write-Log "Could not fetch sync config from app: $($_.Exception.Message). Falling back to script defaults." "WARN"
    }
  }

  # If no specific file was passed, find the newest match in the folder.
  if (-not $ExcelPath) {
    if (-not $Folder)      { throw "No folder configured (set 'product_sync_folder' in Admin -> Settings or pass -Folder)" }
    if (-not $FilePattern) { $FilePattern = '*.xlsx' }
    if (-not (Test-Path $Folder)) { throw "Source folder not accessible: $Folder. Check the network share is mounted and the scheduled task account has read access." }
    $candidates = Get-ChildItem -Path $Folder -Filter $FilePattern -File -ErrorAction Stop | Sort-Object LastWriteTime -Descending
    if (-not $candidates -or $candidates.Count -eq 0) { throw "No files matching '$FilePattern' found in $Folder" }
    $ExcelPath = $candidates[0].FullName
    Write-Log "Picked newest file: $ExcelPath  (modified $($candidates[0].LastWriteTime), $([Math]::Round($candidates[0].Length / 1MB, 1)) MB, $($candidates.Count) candidate(s))"
  }
  if (-not $Sheet) { $Sheet = "1" }

  Write-Log "Excel: $ExcelPath"
  $Endpoint = "$BaseUrl/api/products/sync"
  Write-Log "Endpoint: $Endpoint"

  if (-not (Test-Path $ExcelPath)) { throw "Excel file not found: $ExcelPath" }

  # ImportExcel is a pure-.NET module -- no Microsoft Excel install required.
  # First run only: Install-Module ImportExcel -Scope CurrentUser
  if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    throw "ImportExcel module not installed. Run once: Install-Module ImportExcel -Scope CurrentUser"
  }
  Import-Module ImportExcel

  $importArgs = @{ Path = $ExcelPath; ErrorAction = "Stop" }
  if ($Sheet -match '^\d+$') { $importArgs["WorksheetName"] = (Get-ExcelSheetInfo -Path $ExcelPath)[[int]$Sheet - 1].Name }
  else                       { $importArgs["WorksheetName"] = $Sheet }

  $excelRows = Import-Excel @importArgs
  Write-Log "Parsed $($excelRows.Count) row(s) from sheet '$($importArgs.WorksheetName)'"

  # Tolerate slightly different column names in the source workbook by
  # building a lookup from lower-cased headers to canonical fields. Only
  # product_id is required -- every other field is optional.
  # Only these fields are sent -- every other column in the 80+ column
  # master is silently ignored so the network payload stays tiny.
  $aliases = @{
    "product_id"    = @("product_id","id","barcode","sku","code","item_code","item_id")
    "description"   = @("description","name","product","product_name","item_description","item_name")
    "uom"           = @("uom","unit","unit_of_measure","measure")
    "category"      = @("category","cat","department")
    "supplier_code" = @("supplier_code","suppliercode","vendor_code","supplier_id_code")
    "supplier_name" = @("supplier_name","supplier","vendor")
  }

  $payload = New-Object System.Collections.Generic.List[hashtable]
  $skippedNoId       = 0
  $skippedNoSupplier = 0

  foreach ($r in $excelRows) {
    $row = @{}
    foreach ($field in $aliases.Keys) {
      foreach ($alias in $aliases[$field]) {
        $val = $r.PSObject.Properties | Where-Object { $_.Name.Trim().ToLower() -eq $alias.ToLower() } | Select-Object -First 1
        if ($val -and $null -ne $val.Value -and "$($val.Value)".Trim() -ne "") {
          $row[$field] = "$($val.Value)".Trim()
          break
        }
      }
    }
    if (-not $row.ContainsKey("product_id")) { $skippedNoId++; continue }
    # User rule: drop any row that has no supplier_code AND no supplier_name.
    # The backend will do the final supplier-table match; this just keeps the
    # JSON payload tiny by removing the supplier-less mass up front.
    if (-not $row.ContainsKey("supplier_code") -and -not $row.ContainsKey("supplier_name")) {
      $skippedNoSupplier++; continue
    }
    $payload.Add($row) | Out-Null
  }

  if ($skippedNoId       -gt 0) { Write-Log "Skipped $skippedNoId row(s) with no product_id" "WARN" }
  if ($skippedNoSupplier -gt 0) { Write-Log "Skipped $skippedNoSupplier row(s) with no supplier code or name (won't match a supplier)" "INFO" }
  if ($payload.Count -eq 0) { throw "No usable rows found in $ExcelPath" }

  Write-Log "Prepared $($payload.Count) row(s) for upload (out of $($excelRows.Count) read)"

  if ($DryRun) {
    Write-Log "DryRun set -- first row preview: $($payload[0] | ConvertTo-Json -Compress)"
    Write-Log "=== Dry run complete -- no HTTP POST sent ==="
    exit 0
  }

  # Client-side chunking: each POST carries at most $ChunkSize rows so that
  # even an unfiltered 100k-row workbook never exceeds the Cloudflare Worker
  # CPU/time budget for a single request. We send chunks sequentially since
  # the script runs unattended at 06:00.
  $ChunkSize = 2000
  $totals    = @{ written = 0; duplicates = 0; received = 0; skippedNoSupplier = 0; skippedNoId = 0; chunksFailed = 0 }

  for ($offset = 0; $offset -lt $payload.Count; $offset += $ChunkSize) {
    $slice = $payload.GetRange($offset, [Math]::Min($ChunkSize, $payload.Count - $offset))
    $bodyJson = $slice | ConvertTo-Json -Depth 3 -Compress
    $chunkNum = [Math]::Floor($offset / $ChunkSize) + 1
    $totalChunks = [Math]::Ceiling($payload.Count / $ChunkSize)
    try {
      $response = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers $headers `
        -Body $bodyJson -TimeoutSec 300
      $totals.written           += [int]$response.written
      $totals.duplicates        += [int]$response.duplicates_collapsed
      $totals.received          += [int]$response.received
      $totals.skippedNoSupplier += [int]$response.skipped_no_supplier
      $totals.skippedNoId       += [int]$response.skipped_no_id
      Write-Log ("Chunk {0}/{1}: written={2} dup={3} skipped_no_supplier={4}" -f `
        $chunkNum, $totalChunks, $response.written, $response.duplicates_collapsed, $response.skipped_no_supplier)
    }
    catch {
      $totals.chunksFailed++
      Write-Log ("Chunk {0}/{1} FAILED: {2}" -f $chunkNum, $totalChunks, $_.Exception.Message) "ERROR"
    }
  }

  Write-Log ("Totals: written={0} duplicates={1} received={2} skipped_no_supplier={3} skipped_no_id={4} chunks_failed={5}" -f `
    $totals.written, $totals.duplicates, $totals.received, $totals.skippedNoSupplier, $totals.skippedNoId, $totals.chunksFailed)
  if ($totals.chunksFailed -gt 0) { throw "$($totals.chunksFailed) chunk(s) failed -- see log above" }
  Write-Log "=== Product sync finished OK ==="
  exit 0
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)" "ERROR"
  Write-Log "=== Product sync failed ==="
  exit 1
}
