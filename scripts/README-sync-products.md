# Daily product master sync — setup

This script reads a product master `.xlsx` from a local Windows folder and
pushes the rows to the live app once a day. Existing rows are updated by
`product_id`; new rows are inserted. The Cloudflare backend handles
chunking and dedup, so you don't need to do anything special for big files.

Files involved:
- `sync-products.ps1` — the worker script
- `C:\Homesavers\products.xlsx` — the source file (you replace this daily)
- `C:\Homesavers\.sync-secret` — one-line text file holding the shared secret
- `C:\Homesavers\logs\sync-products.log` — append-only log

## 1. One-time PowerShell prep on the Windows box

Open PowerShell **as the user that the scheduled task will run as** (so the
module install ends up on their profile).

```powershell
Install-Module -Name ImportExcel -Scope CurrentUser
```

`ImportExcel` is a pure-.NET module — Microsoft Excel does **not** need
to be installed on the machine.

## 2. Generate the shared secret

Pick a long random string. Easiest from PowerShell:

```powershell
[Convert]::ToBase64String((1..32 | %{ Get-Random -Maximum 256 }))
```

Save it to `C:\Homesavers\.sync-secret` (one line, no quotes):

```powershell
New-Item -ItemType Directory -Path C:\Homesavers -Force | Out-Null
"PASTE-THE-RANDOM-STRING-HERE" | Out-File C:\Homesavers\.sync-secret -Encoding ascii -NoNewline
```

Then in the Cloudflare Pages dashboard:
- **Settings → Environment variables → Production**
- Add `PRODUCT_SYNC_SECRET` = the same string
- Redeploy (Settings → Builds & deployments → Retry deployment) so the new
  env var is picked up by the Function.

## 3. Prepare the Excel file

The script only reads these columns and ignores everything else in the
workbook (so a 100k-row × 80-column master is trimmed to 6 columns × the
relevant rows before anything leaves the machine):

| Field | Accepted column names in the workbook |
|---|---|
| `product_id` *(required)* | `product_id`, `id`, `barcode`, `sku`, `code`, `item_code`, `item_id` |
| `description` | `description`, `name`, `product`, `product_name`, `item_description`, `item_name` |
| `uom` | `uom`, `unit`, `unit_of_measure`, `measure` |
| `category` | `category`, `cat`, `department` |
| `supplier_code` | `supplier_code`, `suppliercode`, `vendor_code`, `supplier_id_code` |
| `supplier_name` | `supplier_name`, `supplier`, `vendor` |

**Row filter**: a product is uploaded only if its `supplier_code` (or
fallback `supplier_name`) matches an **active** row in the `suppliers`
table. Everything else is silently dropped. This is what trims 100k rows
down to the few thousand the stores actually scan.

Sheet 1 is read by default — pass `-Sheet "MySheetName"` to read a
different one.

## 4. Test the parse without uploading

```powershell
powershell -ExecutionPolicy Bypass -File C:\Scraping\homesavers-scanner\scripts\sync-products.ps1 -DryRun
```

You should see something like:

```
2026-05-18 09:00:01 [INFO] Parsed 4231 row(s) from sheet 'Sheet1'
2026-05-18 09:00:01 [INFO] Prepared 4225 row(s) for upload
2026-05-18 09:00:01 [INFO] DryRun set — first row preview: {"product_id":"5098786545678", ...}
```

## 5. Run it for real

Once happy with the dry run, run without `-DryRun`:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Scraping\homesavers-scanner\scripts\sync-products.ps1
```

The script splits the payload into 2,000-row chunks and POSTs them
sequentially. The Cloudflare Function then sub-chunks each one into
500-row PostgREST batches before hitting Supabase. You'll see one log
line per chunk and a totals line at the end:

```
[INFO] Chunk 1/12: written=2000 dup=0 skipped_no_supplier=300
[INFO] Chunk 2/12: written=2000 dup=0 skipped_no_supplier=274
...
[INFO] Totals: written=22875 duplicates=0 received=24000 skipped_no_supplier=1125 skipped_no_id=0 chunks_failed=0
```

`skipped_no_supplier` is rows whose `supplier_code` didn't match any
active supplier — that's the row-filter doing its job. If
`chunks_failed > 0`, the run exits non-zero so Task Scheduler shows it
as a failure.

## 6. Schedule it daily at 06:00 Ireland time

Open **Task Scheduler** → **Create Basic Task**:

- **Name:** Homesavers product sync
- **Trigger:** Daily, start time 06:00
- **Action:** Start a program
  - **Program/script:** `powershell.exe`
  - **Arguments:** `-NoProfile -ExecutionPolicy Bypass -File "C:\Scraping\homesavers-scanner\scripts\sync-products.ps1"`
- **Finish** → tick "Open the Properties dialog"
- In Properties:
  - **Run whether user is logged on or not** (you'll be prompted for the
    account password)
  - **Run with highest privileges**

Check `C:\Homesavers\logs\sync-products.log` the next morning. A clean run
ends with `=== Product sync finished OK ===`.

## Overriding defaults

All paths and the endpoint URL are parameters. E.g. to point at a preview
deploy or a different file:

```powershell
.\sync-products.ps1 `
  -ExcelPath "D:\Exports\products-master.xlsx" `
  -Sheet "Master" `
  -Endpoint "https://preview.homesaversscanner.pages.dev/api/products/sync"
```

## Troubleshooting

- `Forbidden` (HTTP 403) — the `X-Sync-Secret` header doesn't match the
  `PRODUCT_SYNC_SECRET` env var on Cloudflare. Re-check both, and make
  sure Cloudflare was redeployed after the env var was added.
- `PRODUCT_SYNC_SECRET not configured` (HTTP 500) — same thing: env var
  isn't set on the Cloudflare project.
- `ImportExcel module not installed` — run the Install-Module command in
  step 1 as the account the scheduler will use.
- `Chunk N failed at row X` — Supabase rejected a batch. The error in the
  log tells you which row range and the underlying message. Fix the bad
  rows in the spreadsheet and rerun.
