# CN-code master sync.
#
# Pulls the CN-code master export from the internal app, keeps ONLY the
# product_prism_code column (= EAN_Barcode / the same key as ean_barcode in
# the prices and alt_barcodes tables), and full-replaces the cn_code_master
# table in the Homesavers Scanner database.
#
#   GET  http://86.43.71.253:4000/api/cn-code-master/export   (cookie auth)
#        -> { success: true, data: [ { product_prism_code, ... }, ... ] }
#   POST /api/cn-codes/sync/reset   (empty the table)
#   POST /api/cn-codes/sync         (insert codes, in chunks)
#
# Reuses the SAME sync secret as the ItemMaster jobs (C:\Homesavers\.sync-secret).
# The source cookie lives in its own file so nothing sensitive is in the repo.
#
# Schedule nightly with Task Scheduler (see scripts/README-cn-codes.md).

[CmdletBinding()]
param(
  [string]$SourceUrl  = "http://86.43.71.253:4000/api/cn-code-master/export",
  [string]$BaseUrl    = "https://homesaversscanner.pages.dev",
  [string]$SecretFile = "C:\Homesavers\.sync-secret",
  [string]$CookieFile = "C:\Homesavers\.cn-source-cookie",  # one line, e.g. admin_authenticated=true; user_email=you@x.ie
  [string]$Cookie     = "",                                  # optional override (skips CookieFile)
  [string]$LogPath    = "C:\Homesavers\logs\sync-cn-codes.log",
  [int]$ChunkSize     = 5000,
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

# PS 5.1 collapses a single-element array to a scalar in ConvertTo-Json, which
# would make the endpoint reject the body. Always emit a real JSON array.
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
      kind             = "cn_codes"
      file_name        = "cn-code-master/export"
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
  Write-Log "=== CN-code master sync starting ==="

  # --- secret (shared with the ItemMaster jobs) ---
  if (-not (Test-Path $SecretFile)) { throw "Secret file not found: $SecretFile" }
  $secret = (Get-Content -Path $SecretFile -Raw).Trim()
  if (-not $secret) { throw "Secret file is empty: $SecretFile" }
  $headers = @{ "X-Sync-Secret" = $secret; "Content-Type" = "application/json" }

  # --- source cookie ---
  if (-not $Cookie) {
    if (-not (Test-Path $CookieFile)) { throw "Cookie file not found: $CookieFile (put the source Cookie header value in it)" }
    $Cookie = (Get-Content -Path $CookieFile -Raw).Trim()
  }
  if (-not $Cookie) { throw "Source cookie is empty." }

  # --- pull the export ---
  Write-Log "GET $SourceUrl"
  $resp = Invoke-RestMethod -Method Get -Uri $SourceUrl -Headers @{ "Cookie" = $Cookie } -TimeoutSec 300
  if (-not $resp) { throw "Empty response from source." }
  if ($null -ne $resp.success -and -not $resp.success) { throw "Source returned success=false." }
  $data = $resp.data
  if (-not $data) { throw "Source response has no 'data' array." }
  Write-Log "Source returned $($data.Count) row(s)."

  # --- keep only product_prism_code, trimmed, non-empty, de-duplicated ---
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($row in $data) {
    $code = $null
    if ($row -is [string]) { $code = $row } else { $code = $row.product_prism_code }
    if ($null -eq $code) { $recordsSkipped++; continue }
    $code = "$code".Trim()
    if ($code -eq "" -or $code -eq "0") { $recordsSkipped++; continue }
    [void]$set.Add($code)
  }
  $codes = @($set)
  Write-Log "Distinct product_prism_code: $($codes.Count) (skipped $recordsSkipped empty/blank)"
  if ($codes.Count -eq 0) { throw "No product_prism_code values found -- not touching the table." }

  if ($DryRun) {
    Write-Log ("DryRun -- first 10: " + (($codes | Select-Object -First 10) -join ', '))
    Write-Log "=== Dry run complete (table NOT modified) ==="
    exit 0
  }

  # --- full replace: empty first, then insert in chunks ---
  # Only reset AFTER a good fetch, so a source outage never wipes the table.
  Write-Log "Reset (truncate) cn_code_master..."
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/cn-codes/sync/reset" -Headers $headers -TimeoutSec 120 | Out-Null

  for ($offset = 0; $offset -lt $codes.Count; $offset += $ChunkSize) {
    $take  = [Math]::Min($ChunkSize, $codes.Count - $offset)
    $slice = $codes[$offset..($offset + $take - 1)]
    $bodyJson = ConvertTo-JsonArray $slice
    $chunkNum = [Math]::Floor($offset / $ChunkSize) + 1
    $resp2 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/cn-codes/sync" -Headers $headers -Body $bodyJson -TimeoutSec 300
    $recordsImported += [int]$resp2.written
    Write-Log ("Chunk {0}: written={1}" -f $chunkNum, $resp2.written)
  }

  Write-Log "Totals: imported=$recordsImported skipped=$recordsSkipped"
  Send-RunStatus -Status "ok" -Message "Imported $recordsImported codes" -Total $codes.Count
  Write-Log "=== CN-code sync finished OK ==="
  exit 0
}
catch {
  Write-Log "FAILED: $($_.Exception.Message)" "ERROR"
  Send-RunStatus -Status "error" -Message $_.Exception.Message
  exit 1
}
