# CN-code master nightly sync

Pulls the CN-code master export from the internal app and full-replaces the
`cn_code_master` table (a single column: `product_prism_code`, the same value as
`ean_barcode` in `prices` / `alt_barcodes`) in the Homesavers Scanner database.

```
GET http://86.43.71.253:4000/api/cn-code-master/export   (cookie auth)
     -> keep product_prism_code only, de-dupe
POST /api/cn-codes/sync/reset   (empty the table)
POST /api/cn-codes/sync         (insert in chunks)
```

Runs on the **same machine as the ItemMaster sync** and reuses the same
`PRODUCT_SYNC_SECRET` (no new Cloudflare env var needed).

## One-off setup

1. **Sync secret** — already present from the ItemMaster jobs:
   `C:\Homesavers\.sync-secret` (must equal the `PRODUCT_SYNC_SECRET` set in the
   Cloudflare Pages project). Nothing to do if the ItemMaster sync already runs.

2. **Source cookie** — create `C:\Homesavers\.cn-source-cookie` containing one
   line (the Cookie header the source expects):

   ```
   admin_authenticated=true; user_email=shayas.philip@supplychain.ie
   ```

   Keep this file out of the repo (it's a credential).

3. **Test without touching the database** (verifies the pull + parse):

   ```powershell
   powershell -ExecutionPolicy Bypass -File "C:\Homesavers\scripts\sync-cn-codes.ps1" -DryRun
   ```

   You should see `Source returned N row(s)` and `Distinct product_prism_code: N`.

4. **Do one real run:**

   ```powershell
   powershell -ExecutionPolicy Bypass -File "C:\Homesavers\scripts\sync-cn-codes.ps1"
   ```

## Schedule it nightly (Task Scheduler)

Runs at 02:45 every day (after the ItemMaster sync). Adjust `/st` as needed.

```cmd
schtasks /Create /TN "Homesavers CN Code Sync" /SC DAILY /ST 02:45 /RL HIGHEST /F ^
  /TR "powershell -NonInteractive -ExecutionPolicy Bypass -File \"C:\Homesavers\scripts\sync-cn-codes.ps1\""
```

(Run that in an elevated `cmd`. Or create it in the Task Scheduler GUI: Daily,
02:45, Action = Start a program, `powershell`, arguments =
`-NonInteractive -ExecutionPolicy Bypass -File "C:\Homesavers\scripts\sync-cn-codes.ps1"`.)

## Verify

- Log: `C:\Homesavers\logs\sync-cn-codes.log`
- Run history: Admin -> Settings (sync runs list, `kind = cn_codes`)
- Row count (SQL): `SELECT count(*) FROM cn_code_master;`
- Membership check: `SELECT exists(SELECT 1 FROM cn_code_master WHERE product_prism_code = '01-24-086-00');`

## Notes

- **Safe on source outage:** the table is only emptied *after* a successful
  fetch that returns rows. A failed/empty pull leaves the existing table intact.
- **Full replace:** codes removed at source disappear here too (that's the point).
- Chunk size defaults to 5000 codes/POST; override with `-ChunkSize`.
- To add more columns later (e.g. the actual CN code, duty rate, country of
  origin), it's a small change to the table + the `/cn-codes/sync` endpoint.
