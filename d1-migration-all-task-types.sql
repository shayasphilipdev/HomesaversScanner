-- Phase 2 of the 7-week retention change: the archive stops being Department
-- Check only and becomes a faithful copy of task_records, for every task type.
--
-- Apply with:
--   cd workers/archiver
--   npx wrangler d1 execute homesavers-archive --remote --file=../../d1-migration-all-task-types.sql
--
-- WHY THE TABLE IS RENAMED
-- dept_scan_archive was accurate when the archive held task_type 'J' and
-- nothing else. It now holds every type, so the name would actively mislead the
-- next person reading the read endpoint. Two code references change with it:
-- the archiver's INSERT and /reports/archive's SELECT.
--
-- WHY EVERY COLUMN, NOT JUST THE ONES J USES
-- The original schema deliberately omitted 15 columns because all 163,517 live J
-- rows had them NULL. That reasoning was correct for a J-only archive and is
-- wrong for this one: Task B carries description and two photo URLs, D and I
-- carry product_name_label, A carries uom and quantity, and completed_at /
-- store_completed_at / reviewed_at / review_notes apply to EVERY type -- they
-- are empty for J only because nothing ever reviews a Department Check.
--
-- The cost is close to nothing. SQLite stores a NULL column as one byte in the
-- record header, so the 18 columns added here cost ~18 bytes on each J row, and
-- J is 97.5% of all records. Measured 372 bytes/row today; this takes it to
-- roughly 390. At the 5-week window that is ~111 MB of D1's 500 MB.
--
-- details IS KEPT WHOLE, not flattened. Only J and K put item_group in there;
-- C stores {reason_code, current_price}, E {price_marked_*}, F {drs_size,
-- units_per_package}, G {promotion_*}, H {shop_floor_count} and M the five
-- expiry fields the Expiry Overview report reads. Flattening one key and
-- discarding the rest -- which is what happens today -- would silently empty
-- those report columns for every archived row. `department` stays alongside it
-- as a cheap pre-extracted copy so J reports need no JSON parsing.
--
-- WHAT IS STILL NOT ARCHIVED, deliberately:
--   task_record_events    ~1.07 rows per record, ~35% more storage, and they
--                         are destroyed by the purge today anyway.
--   task_record_messages  the thread is a live conversation, not a record.
--   messages_resolved_at / messages_resolved_by_name  meaningless without it.
--
-- NO NEW INDEX. Each index costs one extra written row per archived record
-- against D1's 100,000 rows/day free limit, and the table is already physically
-- ordered by (created_at_ms, id) because it is WITHOUT ROWID with that primary
-- key. Filtering by task_type happens inside an already date-bounded read, so it
-- costs nothing extra to scan.

ALTER TABLE dept_scan_archive RENAME TO task_record_archive;

-- Added nullable and then backfilled rather than declared DEFAULT 'J'. A
-- lingering default would silently label a future row 'J' if the archiver ever
-- failed to bind the column, which is exactly the class of bug this phase is
-- meant to make impossible.
ALTER TABLE task_record_archive ADD COLUMN task_type TEXT;

ALTER TABLE task_record_archive ADD COLUMN description           TEXT;
ALTER TABLE task_record_archive ADD COLUMN uom                   TEXT;
ALTER TABLE task_record_archive ADD COLUMN quantity              REAL;
ALTER TABLE task_record_archive ADD COLUMN notes                 TEXT;
ALTER TABLE task_record_archive ADD COLUMN product_name_label    TEXT;
ALTER TABLE task_record_archive ADD COLUMN actual_product_name   TEXT;
ALTER TABLE task_record_archive ADD COLUMN supplier_name_text    TEXT;
ALTER TABLE task_record_archive ADD COLUMN photo_product_url     TEXT;
ALTER TABLE task_record_archive ADD COLUMN photo_barcode_url     TEXT;
ALTER TABLE task_record_archive ADD COLUMN review_notes          TEXT;
ALTER TABLE task_record_archive ADD COLUMN reviewed_at_ms        INTEGER;
ALTER TABLE task_record_archive ADD COLUMN completed_at_ms       INTEGER;
ALTER TABLE task_record_archive ADD COLUMN store_completed_at_ms INTEGER;
ALTER TABLE task_record_archive ADD COLUMN priced_at_ms          INTEGER;
ALTER TABLE task_record_archive ADD COLUMN pricing_removed_at_ms INTEGER;
ALTER TABLE task_record_archive ADD COLUMN details_json          TEXT;
ALTER TABLE task_record_archive ADD COLUMN marked_for_deletion   INTEGER;

-- Every row already in the archive was written by the J-only archiver.
UPDATE task_record_archive SET task_type = 'J' WHERE task_type IS NULL;

-- `purged` is for the D1 deleter that arrives in Phase 4.
--
-- NOTE: archive_runs.marked already exists on the live database -- it was added
-- there by hand and never written back into d1-archive-schema.sql, so the
-- tracked file has been wrong, not the database. (Confirmed: the 2026-09-24
-- cron run recorded marked=3091.) d1-archive-schema.sql is corrected in the
-- same commit as this migration so the file matches reality again.
ALTER TABLE archive_runs ADD COLUMN purged INTEGER NOT NULL DEFAULT 0;
