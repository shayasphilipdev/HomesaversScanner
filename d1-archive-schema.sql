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
-- SCOPE: EVERY task type. It was 'J' only until Phase 2, which was safe exactly
-- as long as the purge also singled J out. Once the purge deletes every type at
-- the same age, a J-only archive means every other type is destroyed
-- unarchived -- so the two scopes have to move together.
--
-- SIZING (re-measured 2026-09-24 against the live archive)
--   All-type volume        ~8,150 records/day (21-day mean; J alone is 97.5%)
--                          ~10,100/day over the last 7 days, and rising
--   Window held here       35 days (archive_retention_days)
--   Rows                   ~285,000, or ~354,000 at the recent rate
--   Row cost on disk       ~390 bytes INCLUDING the index and SQLite overhead
--   Table + one index      ~111-138 MB of D1's 500 MB per-database free limit
--
-- CORRECTION. The figures this block previously carried -- 5,310 records/day,
-- ~200 bytes/row, ~210 MB, "~42%" -- were labelled "measured, not estimated"
-- and were wrong in both inputs. Real volume is ~1.5x that, and 200 bytes was
-- the text payload only: it left out the secondary index and SQLite's per-row
-- overhead, which together come to ~390. Under the abandoned 6-month plan the
-- true figure was ~598 MB -- over the free limit, not 42% of it. The 7-week
-- window removes the problem outright, so the month-sharding escape hatch the
-- old note described is no longer needed.
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
-- EVERY task_records column is carried (Phase 2, 2026-09-24). The original
-- schema omitted 15 of them because all 163,517 live J rows had them NULL --
-- correct for a J-only archive, wrong for this one: B carries description and
-- both photo URLs, A carries uom and quantity, D and I carry
-- product_name_label, and completed_at / store_completed_at / reviewed_at /
-- review_notes apply to every type. SQLite stores a NULL as one byte in the row
-- header, so carrying them costs ~18 bytes on each J row.
--
-- Still omitted: messages_resolved_at and messages_resolved_by_name, which
-- describe a message thread that is not archived and mean nothing without it.

CREATE TABLE IF NOT EXISTS task_record_archive (
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

  -- ── Added in Phase 2, when the archive stopped being Department Check only ──
  -- Column order below is the physical order on the live database: these were
  -- added by ALTER TABLE, which appends. The archiver's INSERT names every
  -- column explicitly, so the order is documentation, not a contract.

  -- Which task this was. Its absence is what made the read endpoint hardcode
  -- "Department Check" for every archived row.
  task_type             TEXT,

  description           TEXT,      -- Task B
  uom                   TEXT,      -- Task A
  quantity              REAL,      -- Tasks A, M
  notes                 TEXT,      -- every type except J, K, M
  product_name_label    TEXT,      -- Tasks D, I
  actual_product_name   TEXT,      -- Task D
  supplier_name_text    TEXT,      -- accepted by the API; no form writes it
  photo_product_url     TEXT,      -- Task B at creation; any type afterwards
  photo_barcode_url     TEXT,

  -- Status-workflow columns. These apply to EVERY type, including J -- they are
  -- empty for J only because nothing ever reviews a Department Check.
  review_notes          TEXT,
  reviewed_at_ms        INTEGER,
  completed_at_ms       INTEGER,
  store_completed_at_ms INTEGER,
  priced_at_ms          INTEGER,
  pricing_removed_at_ms INTEGER,

  -- The FULL details jsonb, as JSON text. `department` above stays as a cheap
  -- pre-extracted copy of details->>'item_group' so Department Check reads --
  -- 97.5% of the archive -- never parse JSON. Every other type stores a
  -- different shape there: C {reason_code, current_price}, E the price_marked_*
  -- pair, F {drs_size, units_per_package}, G the promotion_* pair,
  -- H {shop_floor_count}, M the five expiry fields the Expiry Overview reads.
  -- Flattening one key and discarding the rest -- which is what happened before
  -- Phase 2 -- would silently empty those report columns for every archived row.
  details_json          TEXT,

  marked_for_deletion   INTEGER,   -- 0/1

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
  ON task_record_archive (store_id, created_at_ms);

-- ── Run log ──────────────────────────────────────────────────────────────────
-- One row per archiver run. Phase 2 runs in shadow mode, so the only way to
-- know whether the archiver is correct is to compare what it says it moved
-- against what Postgres actually removed that night -- which needs the numbers
-- written down somewhere durable. `shadow` records which mode produced the row,
-- so a later audit cannot mistake a shadow run for a real one.
CREATE TABLE IF NOT EXISTS archive_runs (
  started_at_ms INTEGER PRIMARY KEY,
  trigger_kind  TEXT    NOT NULL,   -- 'cron' | 'manual'
  cutoff_iso    TEXT    NOT NULL,   -- retention cutoff this run used
  shadow        INTEGER NOT NULL,   -- 1 = wrote D1 but deleted nothing
  scanned       INTEGER NOT NULL,   -- rows read from Postgres
  inserted      INTEGER NOT NULL,   -- rows that landed (meta.changes = 1)
  already_had   INTEGER NOT NULL,   -- rows the primary key already held
  deleted       INTEGER NOT NULL,   -- rows deleted from POSTGRES: always 0, the
                                    -- archiver never deletes there; pg_cron does
  duration_ms   INTEGER NOT NULL,
  error         TEXT,
  -- Added live before this file caught up: the archiver has always written
  -- `marked`, and the tracked schema was the thing that was wrong, not the
  -- database. (The 2026-09-24 cron run recorded marked=3091.) The INSERT is
  -- wrapped in a catch that prefers losing the record of a run to failing the
  -- run, which is why a genuine mismatch here would have been silent.
  marked        INTEGER NOT NULL DEFAULT 0,   -- rows stamped archived_at in Postgres
  purged        INTEGER NOT NULL DEFAULT 0    -- rows deleted from D1 (Phase 4)
);
