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

- Required column: `product_id` (or any of `id`, `barcode`, `sku`, `code`)
- Optional: `description` (`name`, `product`), `uom` (`unit`), `category`,
  `supplier_name` (`supplier`, `vendor`)
- Sheet 1 is read by default — pass `-Sheet "MySheetName"` to the script
  to read a different one.

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

The script POSTs the whole array in one request; the Cloudflare Function
chunks it server-side into 500-row batches before hitting Supabase. Check
the response:

```
[INFO] Response: written=4225 duplicates=0 received=4231
```

`received - written - duplicates` should be 0; any difference is rows
the backend rejected (e.g., missing `product_id`).

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
