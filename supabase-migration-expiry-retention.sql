-- ============================================================================
--  Expiry sweep retention — keep Task M records for 180 days
--
--  RUN THIS BEFORE deploying the "stores can clear their own sweep records"
--  change. Until it is applied, clearing a sweep record starts a 14-day
--  countdown to its deletion (see WHY below).
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database (live and
--  test share one Supabase project).
-- ============================================================================
--
--  WHY
--  ---
--  The nightly pg_cron job purge-old-task-records calls
--  public.purge_old_task_records(), which deletes task_records older than
--  app_settings.scan_record_retention_days using:
--
--      created_at < cutoff AND (task_type IN ('J','K') OR status <> 'pending')
--
--  Task M (Routine Expiry Sweep) rows are currently immortal by accident: M is
--  not in ('J','K'), and sweep rows are created with status 'pending'. The
--  moment a store clears one, `status <> 'pending'` becomes true and the row is
--  deleted on the next run — silently shrinking the HO Expiry Overview report
--  (which reads task_type='M' with no status filter) to a rolling window.
--
--  This migration gives Task M its own retention window (default 180 days,
--  applied regardless of status) and leaves every other task type's behaviour
--  exactly as it is today.
-- ============================================================================


-- ── STEP 0 — LOOK BEFORE YOU REPLACE ────────────────────────────────────────
-- purge_old_task_records() is not tracked in this repo, so print the current
-- definition and compare it against the rule quoted above BEFORE running STEP 2.
-- If the live body differs materially, stop and reconcile it first — do not let
-- this migration silently discard logic that was added directly in the DB.

SELECT pg_get_functiondef(p.oid) AS current_definition
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname = 'purge_old_task_records';


-- ── STEP 1 — retention setting ──────────────────────────────────────────────
-- Configurable like the other retention windows, so it can be tuned from SQL
-- without another function change.

INSERT INTO app_settings (key, value)
VALUES ('expiry_record_retention_days', '180')
ON CONFLICT (key) DO NOTHING;


-- ── STEP 2 — replace the purge function ─────────────────────────────────────
-- Behaviour:
--   Task M              → deleted after expiry_record_retention_days (180),
--                         regardless of status.
--   Everything else     → unchanged: deleted after scan_record_retention_days
--                         when task_type IN ('J','K') OR status <> 'pending'
--                         (i.e. still-pending HO query records A–I survive).
--
-- Kept as a plain FUNCTION doing ONE DELETE, called via SELECT. It must NOT
-- become a PROCEDURE with a batched COMMIT loop — pg_cron cannot run that
-- ("invalid transaction termination"), which silently broke this job before.

CREATE OR REPLACE FUNCTION public.purge_old_task_records()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  scan_days    integer;
  expiry_days  integer;
  scan_cutoff  timestamptz;
  expiry_cutoff timestamptz;
  removed      integer;
BEGIN
  SELECT COALESCE(NULLIF(value, '')::integer, 21) INTO scan_days
  FROM app_settings WHERE key = 'scan_record_retention_days';
  scan_days := COALESCE(scan_days, 21);

  SELECT COALESCE(NULLIF(value, '')::integer, 180) INTO expiry_days
  FROM app_settings WHERE key = 'expiry_record_retention_days';
  expiry_days := COALESCE(expiry_days, 180);

  scan_cutoff   := now() - make_interval(days => scan_days);
  expiry_cutoff := now() - make_interval(days => expiry_days);

  DELETE FROM task_records
  WHERE
    CASE
      WHEN task_type = 'M'
        THEN created_at < expiry_cutoff
      ELSE
        created_at < scan_cutoff
        AND (task_type IN ('J', 'K') OR status <> 'pending')
    END;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;


-- ── STEP 3 — verify ─────────────────────────────────────────────────────────
-- Confirm the setting landed and see how many Task M rows exist / would be kept.
-- (Does NOT delete anything — purely a report.)

SELECT key, value FROM app_settings
WHERE key IN ('scan_record_retention_days', 'expiry_record_retention_days')
ORDER BY key;

SELECT
  count(*)                                                              AS total_m_records,
  count(*) FILTER (WHERE created_at >= now() - interval '180 days')      AS kept_180d,
  count(*) FILTER (WHERE created_at <  now() - interval '180 days')      AS would_purge_now,
  min(created_at)                                                        AS oldest
FROM task_records
WHERE task_type = 'M';
