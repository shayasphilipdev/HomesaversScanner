-- Phase 5: the same name collision, on the D1 side.
--
-- archived_at_ms recorded when the ARCHIVER copied the row here. It has nothing
-- to do with a user pressing Archive, and once that button exists the old name
-- invites exactly the wrong reading. Matches task_records.d1_copied_at.
--
-- Apply with:
--   cd workers/archiver
--   npx wrangler d1 execute homesavers-archive --remote --file=../../d1-migration-rename-copied-at.sql
ALTER TABLE task_record_archive RENAME COLUMN archived_at_ms TO d1_copied_at_ms;
