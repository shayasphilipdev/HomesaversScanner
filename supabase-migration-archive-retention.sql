-- Phase 1 of the 7-week retention change: make the ARCHIVE window a setting.
--
-- THE MODEL
--   A record lives `scan_record_retention_days` in Supabase, then
--   `archive_retention_days` more in the Cloudflare D1 archive, then it is gone.
--
--     created ──[ scan_record_retention_days ]──► D1 ──[ archive_retention_days ]──► deleted
--
--   Target is 14 + 35 = 49 days (2 weeks + 5 weeks). This migration seeds the
--   NEW key at its target of 35 and deliberately LEAVES scan_record_retention_days
--   AT 21. Nothing moves today: 35 days of D1 retention has no effect while
--   nothing deletes from D1 (that arrives in Phase 4), and the Supabase window
--   only narrows to 14 in Phase 3, once the archive covers every task type and
--   the backlog has been drained.
--
-- WHY NO `supabase_retention_days` KEY
--   The planned split named a second new key for the Supabase side. It is not
--   worth it: scan_record_retention_days ALREADY means exactly "how long a task
--   record stays in Postgres", and it is read in six places that each delete or
--   protect data --
--     purge_old_task_records()        decides what to DELETE
--     rollup_task_stats_daily()       clamps the recompute window
--     rebuild_task_stats_daily()      refuses to rebuild past it
--     runAutoCleanup()                deletes on back-office login
--     POST /admin/cleanup/task-records
--     workers/archiver retentionCutoffIso()
--   Renaming it would buy a tidier name in exchange for six opportunities to
--   leave one consumer reading a key that no longer exists and silently falling
--   back to a hardcoded 21. The label on the Settings page carries the meaning
--   instead; the key name stays put.
--
-- SAFE DIRECTION OF FAILURE
--   Every consumer defaults to 21 if the row is missing or unparseable. For the
--   Supabase window a LARGER number deletes LESS, so a lost setting fails
--   towards keeping data. archive_retention_days defaults to 35 for the same
--   reason -- and the D1 purge (Phase 4) additionally refuses to run at all if
--   the value is absent or below 1, rather than treating it as zero and
--   emptying the archive.

INSERT INTO app_settings (key, value, updated_at)
VALUES ('archive_retention_days', '35', now())
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE app_settings IS
  'Key/value application settings. Retention chain: a task record is kept '
  'scan_record_retention_days in Postgres, then archive_retention_days in the '
  'Cloudflare D1 archive, then permanently deleted. Dashboard statistics '
  '(task_stats_daily) are governed separately by stats_rollup_retention_days '
  'and survive both, which is what keeps long-range reporting accurate.';
