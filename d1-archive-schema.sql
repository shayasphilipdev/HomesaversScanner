-- Cloudflare D1 (SQLite) archive for Department Check / Department Scan records.
--
-- Database: homesavers-archive
-- database_id: 6c728765-d614-4282-a648-4b3fc3bf78fe   (created 2026-09-23)
-- Not a secret -- it is an identifier, and reaching it still needs account
-- credentials. This is the value the Phase 2 archiver Worker binds to.
--
-- ONE database serves BOTH apps, exactly as one Supabase project does today.
-- Test-app records carry source='test' here just as they do in Postgres, so
-- they stay identifiable and excludable rather than needing separate storage.
--
-- WHY THIS EXISTS
-- Supabase is on the 500 MB free tier and is already at 243 MB. Six months of
-- task_records would be ~542 MB on its own, so long retention cannot live in
-- Postgres. Instead a record spends its first 21 days in Supabase
-- (scan_record_retention_days) and the rest of its 6-month life here, after
-- which it is deleted permanently.
--
-- SCOPE: task_type 'J' ONLY (Department Check, including the Department Scan
-- page). Every other task type keeps its existing Supabase lifecycle untouched
-- -- which is what keeps /reports/aging (Tasks A-F, deliberately purge-exempt)
-- and Expiry Overview (Task M, 180 days in Postgres) working unchanged.
--
-- SIZING (measured 2026-09-23, not estimated)
--   Task J volume          5,310 records/day
--   Window held here       ~159 days (6 months minus the 21 days in Supabase)
--   Rows                   ~844,000
--   Row payload            ~200 bytes (Task J populates only the columns below)
--   Table + one index      ~210 MB of D1's 500 MB per-database free limit
-- That is ~42%, with room for the volume growth the Department Scan rollout is
-- expected to bring. If it ever approaches the ceiling, this schema can be
-- sharded by month WITHOUT migrating what is already here: the archiver and the
-- report reader both resolve "which database for this date range" through one
-- function, which today simply always answers "this one".
--
-- WHAT IS DELIBERATELY NOT HERE
-- task_record_events. Task J carries ~1.07 events per record (175,003 of the
-- 176,195 in the whole table) and they are destroyed today anyway when pg_cron
-- purges the record, so omitting them is no worse than current behaviour. For a
-- Department Check the event log says little the row does not already say, and
-- carrying it would add ~35% to storage. cleared_at below captures the only
-- transition that matters. Reversible: add an events_json column if the audit
-- trail is ever wanted.
--
-- Columns that are ALWAYS NULL for task_type 'J' are omitted entirely, measured
-- across all 163,517 live J rows: completed_at, store_completed_at, notes,
-- description, quantity, uom, photo_product_url, photo_barcode_url,
-- review_notes, reviewed_at, product_name_label, actual_product_name,
-- supplier_name_text, priced_at, pricing_removed_at.

CREATE TABLE IF NOT EXISTS dept_scan_archive (
  -- Postgres uuid, stored as text. Half of the primary key, so re-running the
  -- archiver over a batch it already moved is a no-op rather than a duplicate.
  id               TEXT    NOT NULL,

  -- Epoch MILLISECONDS, not ISO text. Date range is the only way this table is
  -- ever queried, and D1 bills rows SCANNED rather than returned, so integer
  -- comparison over a physically date-ordered table is what protects the
  -- 5,000,000 rows/day free read limit.
  created_at_ms    INTEGER NOT NULL,
  updated_at_ms    INTEGER,
  cleared_at_ms    INTEGER,

  store_id         TEXT    NOT NULL,
  -- Denormalised on purpose. D1 cannot join back to Supabase's stores table, so
  -- without snapshotting the name every archived report row would show a bare
  -- uuid where the live path shows "HS Tallaght".
  store_name       TEXT,

  -- Exactly what the handheld transmitted, even where the check digit was
  -- recovered. This is what keeps a mis-configured gun detectable months later.
  product_code     TEXT,
  -- The real barcode: the corrected 12-digit UPC-A where one was recovered,
  -- otherwise the scan as sent.
  barcode_no       TEXT,
  -- alt_barcodes.ean_barcode -- the internal item code, shown as "Product Code"
  -- in reports. Despite the name it is NOT a barcode.
  product_barcode  TEXT,

  item_name        TEXT,
  supl_id          TEXT,
  supplier_code    TEXT,
  item_status      TEXT,
  barcode_status   TEXT,

  -- details->>'item_group' flattened. Task J writes nothing else into details,
  -- so keeping the jsonb would cost bytes and buy nothing.
  department       TEXT,

  -- The status the record held at the moment it was archived. Stores never see
  -- this -- they see Current / Archived -- but back office needs it for the
  -- management performance reports.
  status           TEXT    NOT NULL,

  -- NULL = live app, 'test' = test app. Same convention as Supabase, so test
  -- traffic stays identifiable and excludable here too.
  source           TEXT,

  -- When the archiver moved it. Lets a purge run prove what it actually did,
  -- and lets us tell "archived last night" from "archived in March".
  archived_at_ms   INTEGER NOT NULL,

  -- Date first: WITHOUT ROWID makes the primary key the physical table order,
  -- so a date-range report reads a contiguous run instead of scanning. id
  -- second only to make the key unique.
  PRIMARY KEY (created_at_ms, id)
) WITHOUT ROWID;

-- Reports are always bounded by store AND date. The primary key already orders
-- by date; this covers the store-scoped case so a single-store report does not
-- scan every store's rows for that period.
--
-- Deliberately the ONLY secondary index. Each one adds a written row per insert
-- (table + index = 2 rows/record = ~10,600/day against the 100,000/day free
-- limit), so an index that is not certain to earn its keep is not created. A
-- department index can be added in the reporting phase once the real query
-- shape is known -- cheaper to judge then than to carry a guess now.
CREATE INDEX IF NOT EXISTS idx_archive_store_created
  ON dept_scan_archive (store_id, created_at_ms);
