# Daily product master sync.
# Reads an Excel file from a local folder and pushes the rows to the
# Homesavers Scanner /api/products/sync endpoint as JSON.
#
# Designed to be run by Windows Task Scheduler once a day. See
# README-sync-products.md for setup steps.

[CmdletBinding()]
param(
  # Path to the Excel file to import. Use a fixed name so the scheduler can
  # find it every day without you having to rename the file.
  [string]$ExcelPath = "C:\Homesavers\products.xlsx",

  # Which sheet to read. "1" = first sheet by index, or pass the sheet name.
  [string]$Sheet = "1",

  # Endpoint to POST to. Override if you're running against a preview deploy.
  [string]$Endpoint = "https://homesaversscanner.pages.dev/api/products/sync",

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
    # Logging is best-effort — never let a log write break the sync.
    Write-Host "WARN: could not write log: $($_.Exception.Message)"
  }
}

try {
  Write-Log "=== Product sync starting ==="
  Write-Log "Excel: $ExcelPath"
  Write-Log "Endpoint: $Endpoint"

  if (-not (Test-Path $ExcelPath)) { throw "Excel file not found: $ExcelPath" }

  # ImportExcel is a pure-.NET module — no Microsoft Excel install required.
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
  # product_id is required — every other field is optional.
  $aliases = @{
    "product_id"    = @("product_id","id","barcode","sku","code")
    "description"   = @("description","name","product","product_name")
    "uom"           = @("uom","unit","unit_of_measure")
    "category"      = @("category","cat")
    "supplier_name" = @("supplier_name","supplier","vendor")
  }

  $payload = New-Object System.Collections.Generic.List[hashtable]
  $skipped = 0

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
    if (-not $row.ContainsKey("product_id")) { $skipped++; continue }
    $payload.Add($row) | Out-Null
  }

  if ($skipped -gt 0) { Write-Log "Skipped $skipped row(s) with no product_id" "WARN" }
  if ($payload.Count -eq 0) { throw "No usable rows found in $ExcelPath" }

  Write-Log "Prepared $($payload.Count) row(s) for upload"

  if ($DryRun) {
    Write-Log "DryRun set — first row preview: $($payload[0] | ConvertTo-Json -Compress)"
    Write-Log "=== Dry run complete — no HTTP POST sent ==="
    exit 0
  }

  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $secret = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $secret) { throw "Secret file is empty: $SecretFile" }

  $bodyJson = $payload | ConvertTo-Json -Depth 3 -Compress

  Write-Log "POSTing $([Math]::Round($bodyJson.Length / 1024, 1)) KB to $Endpoint"
  $response = Invoke-RestMethod -Method Post -Uri $Endpoint `
    -Headers @{ "X-Sync-Secret" = $secret; "Content-Type" = "application/json" } `
    -Body $bodyJson -TimeoutSec 600

  Write-Log "Response: written=$($response.written) duplicates=$($response.duplicates_collapsed) received=$($response.received)"
  Write-Log "=== Product sync finished OK ==="
  exit 0
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)" "ERROR"
  Write-Log "=== Product sync failed ==="
  exit 1
}
