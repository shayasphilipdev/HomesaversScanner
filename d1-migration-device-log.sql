-- device_log_events, moved from Supabase Postgres to Cloudflare D1.
--
-- Database: homesavers-archive (same D1 database the Department Check archive
-- already lives in -- one D1 database serves both, exactly as one Supabase
-- project serves every table). database_id: 6c728765-d614-4282-a648-4b3fc3bf78fe
--
-- Apply with:
--   cd workers/archiver   (or wherever the ARCHIVE binding is configured)
--   npx wrangler d1 execute homesavers-archive --remote --file=../../d1-migration-device-log.sql
--
-- WHY THIS MOVED
-- device_log_events is the "scan doctor" diagnostic log (client/src/lib/
-- deviceLog.js) -- a device best-effort uploads its save/queue/duplicate
-- activity here so an issue can be investigated without physical access to the
-- gun. It is write-only from the app's side: nothing in functions/api/
-- [[route]].js ever reads it back (the Sync page's own "Activity on this
-- device" panel reads localStorage directly, not this table) -- the only
-- reader is a human running a query by hand when investigating a report.
--
-- That shape -- high write volume, essentially never read, never joined
-- against anything else -- is exactly what made it the safe thing to move,
-- unlike alt_barcodes/prices (read on every single scan) or task_records
-- itself (read and written constantly by both stores and back office).
-- Moving it costs the store's device ZERO extra requests: the browser still
-- makes the exact same single POST /api/device-log either way, only the
-- backend of that one route now writes to D1 instead of Postgres.
--
-- Measured 2026-09-30: 40,575 rows / ~19 MB in Supabase after only 2 days
-- live, growing ~18,000 rows/day -- comfortably inside D1's 100,000
-- rows/day free-tier write limit even alongside the archiver's own
-- ~16,000-20,000/day (task_record_archive table + index).
--
-- The OLD Supabase table (supabase-migration-device-log.sql) is left in place
-- untouched by this migration -- dropping/truncating it is a separate,
-- explicit decision since it holds two days of real diagnostic history.

CREATE TABLE IF NOT EXISTS device_log_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id      TEXT    NOT NULL,
  user_id        TEXT,
  store_id       TEXT,
  event_type     TEXT    NOT NULL,
  -- JSON text, same convention as task_record_archive.details_json -- SQLite
  -- has no native JSON/JSONB type.
  detail_json    TEXT,
  -- Epoch milliseconds, not ISO text -- same reasoning as task_record_archive:
  -- D1 bills rows SCANNED, and integer comparison over these is how every
  -- query here is shaped ("this device, in order" / "this event type,
  -- recently" / "this store, recently").
  client_at_ms   INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL
);

-- NO SECONDARY INDEXES, deliberately (2026-10-05).
--
-- Three indexes used to live here, one per query shape ("this device, in
-- order", "this event type recently", "this store recently"). They were
-- DROPPED in production and removed here because this table is write-heavy and
-- read almost never: the log takes ~18k inserts/day, and with three indexes
-- plus the AUTOINCREMENT sequence each insert cost ~3.8 D1 row-writes --
-- ~66,000/day, which on its own pushed D1 past its 100,000 rows-written/day
-- free limit and starved the Department Check archiver (the far more important
-- writer) of budget. See the 2026-10-05 D1 write-limit investigation.
--
-- D1 bills rows SCANNED for reads, not time, and a manual investigation query
-- is the only reader here. A full scan of the whole table (tens of thousands of
-- rows) is a few milliseconds and a rounding error against the 5,000,000
-- reads/day limit, so the indexes bought almost nothing and cost a great deal.
-- If a specific access path is ever needed often enough to index, add it back
-- knowing each index adds a write to every insert.
