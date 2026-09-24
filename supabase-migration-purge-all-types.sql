-- Phase 3a of the 7-week retention change: one purge rule for every task type,
-- and nothing is deleted until the archive is confirmed to hold it.
--
-- STEP 0 -- the definition this replaces (from pg_get_functiondef, 2026-09-24),
-- so the change is reviewable and revertible:
--
--   DELETE FROM task_records
--   WHERE CASE
--           WHEN task_type = 'M' THEN created_at < v_expiry_cutoff
--           WHEN task_type = 'J' THEN created_at < v_cutoff
--                                     AND archived_at IS NOT NULL
--           ELSE created_at < v_cutoff
--                AND (task_type IN ('K','H') OR status <> 'pending')
--         END;
--
-- AFTER:
--
--   DELETE FROM task_records
--   WHERE created_at < v_cutoff AND archived_at IS NOT NULL;
--
-- THREE RULES COLLAPSE INTO ONE
--
-- 1. The 'M' branch goes. Task M kept 180 days via expiry_record_retention_days.
--    The owner's decision is that Expiry follows the same 2+5 weeks as
--    everything else. Zero rows are affected today -- there are no Task M
--    records at all -- but Expiry Overview will only look back 7 weeks from
--    here on. expiry_record_retention_days is left in app_settings, now unread,
--    rather than deleted: removing a setting is not reversible by editing it
--    back.
--
-- 2. The `status <> 'pending'` exemption goes. A pending head-office query
--    (A-I) was never purged -- it lived forever until somebody answered it.
--    The owner chose "7 weeks for everything, no exceptions". Measured before
--    applying: 0 rows qualify, so this destroys nothing today. What it does
--    change permanently is the meaning of /reports/aging, which exists to chase
--    exactly these records and can no longer show a backlog older than the
--    total window.
--
-- 3. The archive guard extends from 'J' to everything. This is the part that
--    makes 1 and 2 safe rather than reckless: a record is now deleted ONLY once
--    the archiver has stamped archived_at, which it does only after D1 has
--    committed the row. Before Phase 2 the archive held Department Check alone,
--    so applying this rule then would have frozen every other type in Postgres
--    forever. Phase 2 shipped first for exactly that reason.
--
-- DIRECTION OF FAILURE. If the archiver stops running, archived_at stops being
-- set, and this deletes NOTHING -- records pile up in Postgres where they are
-- visible and recoverable. The old rule failed the other way: it deleted on a
-- clock and simply trusted that the 01:30 Worker had run before the 02:00 job.
--
-- NOT A PROCEDURE. It must stay a FUNCTION with no COMMIT -- pg_cron cannot run
-- a procedure that terminates its transaction ("invalid transaction
-- termination"), which silently broke this job once before.

CREATE OR REPLACE FUNCTION public.purge_old_task_records()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days    int;
  v_cutoff  timestamptz;
  v_deleted int;
BEGIN
  SELECT NULLIF(value,'')::int INTO v_days
    FROM app_settings WHERE key = 'scan_record_retention_days';
  -- Falls back UP, not down: a larger window deletes less, so a missing or
  -- corrupt setting errs towards keeping data.
  IF v_days IS NULL OR v_days < 1 THEN v_days := 21; END IF;
  v_cutoff := now() - make_interval(days => v_days);

  -- archived_at is stamped by the archiver Worker only after D1 has committed
  -- the row, so this reads as: delete what is past its Postgres window AND
  -- already safe in the archive. Nothing else.
  DELETE FROM task_records
  WHERE created_at < v_cutoff
    AND archived_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

COMMENT ON FUNCTION public.purge_old_task_records() IS
  'Nightly (pg_cron 02:00 UTC). Deletes task records past '
  'scan_record_retention_days that the archiver has confirmed are in the '
  'Cloudflare D1 archive (archived_at IS NOT NULL). Applies to every task type. '
  'If the archiver stops, this deletes nothing rather than deleting unarchived '
  'records.';
