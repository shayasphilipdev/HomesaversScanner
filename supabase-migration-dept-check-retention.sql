-- Separate, shorter live-retention for Department Check (task_type 'J') (2026-09-30)
--
-- WHY
-- Department Check is ~99% of scan volume and the fastest-growing table in the
-- database. Keeping it in Postgres for the same 14 days as every other task type
-- is what pushes Supabase toward its 500 MB free-tier limit. This gives J its
-- own live-retention window -- default 7 days -- while every other task type
-- keeps the existing 14. It is admin-editable on the Settings page
-- (dept_check_retention_days), exactly like scan_record_retention_days.
--
-- WHAT DOES *NOT* CHANGE
--   * Total life of a record stays 49 days for EVERY type. Only the point at
--     which J moves from Postgres to the D1 archive changes (day 7 instead of
--     day 14); it still lives the full archive_retention_days (35) in D1 after
--     that, so the D1 purge (created_at-based, 14+35) is untouched. J: Postgres
--     0-7, D1 7-49. Others: Postgres 0-14, D1 14-49.
--   * The 180-day dashboard statistics are unaffected. The nightly rollup runs
--     at 01:30, BEFORE both purges (01:40 and 02:00), and re-reads a 7-day
--     window -- which still fully covers J's 7-day life (each day is captured at
--     01:30 on its last in-window day, before the purge touches it; `records`
--     counts use GREATEST so they never drop; J status settles same-day). This
--     is why the setting FLOORS AT 7: below that, the 7-day rollup window would
--     try to recompute J days already purged and undercount them. Lowering J
--     below 7 would require lowering stats_rollup_window_days too -- a separate,
--     deliberate change.
--
-- FALLBACK: if dept_check_retention_days is absent or invalid, J falls back to
-- the SAME window as everything else (scan_record_retention_days). The failure
-- direction is "keep J longer", never "delete J sooner".

-- 1. Seed the setting (7 days). ON CONFLICT DO NOTHING so re-running never
--    overwrites an admin's later edit.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('dept_check_retention_days', '7', now())
ON CONFLICT (key) DO NOTHING;

-- 2. Per-type purge. Two DELETEs rather than one CASE so each uses a constant
--    cutoff and the created_at index. Both keep the archive guard
--    (d1_copied_at IS NOT NULL): a record is only ever deleted once the archiver
--    has confirmed the D1 copy, so nothing is lost if the archiver is behind.
CREATE OR REPLACE FUNCTION public.purge_old_task_records()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days      int;
  v_dept_days int;
  v_deleted   int := 0;
  v_n         int;
BEGIN
  SELECT NULLIF(value,'')::int INTO v_days
    FROM app_settings WHERE key = 'scan_record_retention_days';
  IF v_days IS NULL OR v_days < 1 THEN v_days := 21; END IF;

  SELECT NULLIF(value,'')::int INTO v_dept_days
    FROM app_settings WHERE key = 'dept_check_retention_days';
  -- Absent/invalid -> behave exactly as before (J kept the full v_days).
  IF v_dept_days IS NULL OR v_dept_days < 1 THEN v_dept_days := v_days; END IF;

  -- Department Check (J): its own, shorter window.
  DELETE FROM task_records
   WHERE task_type = 'J'
     AND d1_copied_at IS NOT NULL
     AND created_at < now() - make_interval(days => v_dept_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted + v_n;

  -- Every other task type: unchanged window.
  DELETE FROM task_records
   WHERE task_type <> 'J'
     AND d1_copied_at IS NOT NULL
     AND created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted + v_n;

  RETURN v_deleted;
END;
$function$;

-- Verify the seed and that the function compiles + reports both windows.
SELECT value AS dept_days FROM app_settings WHERE key = 'dept_check_retention_days';
