-- 2026-11-10 — Pending HO-review records stay in the app (all actions work on them)
--
-- Before: every record left Postgres after scan_record_retention_days (14), was
-- kept in the D1 archive for archive_retention_days (35) and deleted at 49 days.
-- In D1 a record can be read and exported but not reviewed, assigned or messaged.
--
-- Now: a record of an HO-review task type (everything except the stores' own
-- checks J/K/M/H) that is still PENDING stays in Postgres until it is dealt
-- with, or until its total life (14 + 35 = 49 days) is up. Once reviewed it
-- follows the normal rule. The archiver Worker applies the same rule on its
-- side (workers/archiver/src/index.js), so it neither copies nor re-scans them.
--
-- Also: any change to a record that is already copied to D1 clears
-- d1_copied_at, so the purge waits until the archiver has copied the CURRENT
-- version (the archiver now writes INSERT OR REPLACE).

CREATE OR REPLACE FUNCTION public.purge_old_task_records()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days         int;
  v_dept_days    int;
  v_archive_days int;
  v_deleted      int := 0;
  v_n            int;
BEGIN
  SELECT NULLIF(value,'')::int INTO v_days
    FROM app_settings WHERE key = 'scan_record_retention_days';
  IF v_days IS NULL OR v_days < 1 THEN v_days := 21; END IF;

  SELECT NULLIF(value,'')::int INTO v_dept_days
    FROM app_settings WHERE key = 'dept_check_retention_days';
  IF v_dept_days IS NULL OR v_dept_days < 1 THEN v_dept_days := v_days; END IF;

  SELECT NULLIF(value,'')::int INTO v_archive_days
    FROM app_settings WHERE key = 'archive_retention_days';
  IF v_archive_days IS NULL OR v_archive_days < 1 THEN v_archive_days := 35; END IF;

  DELETE FROM task_records
   WHERE task_type = 'J'
     AND d1_copied_at IS NOT NULL
     AND created_at < now() - make_interval(days => v_dept_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted + v_n;

  DELETE FROM task_records
   WHERE task_type <> 'J'
     AND d1_copied_at IS NOT NULL
     AND created_at < now() - make_interval(days => v_days)
     -- pending HO-review records stay until their total life is up
     AND NOT (status = 'pending'
              AND task_type NOT IN ('K','M','H')
              AND created_at >= now() - make_interval(days => v_days + v_archive_days));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_deleted := v_deleted + v_n;

  RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.task_records_reset_d1_copy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.d1_copied_at IS NOT NULL
     AND NEW.d1_copied_at IS NOT DISTINCT FROM OLD.d1_copied_at
     AND (NEW.status       IS DISTINCT FROM OLD.status
       OR NEW.review_notes IS DISTINCT FROM OLD.review_notes
       OR NEW.notes        IS DISTINCT FROM OLD.notes
       OR NEW.details      IS DISTINCT FROM OLD.details
       OR NEW.cleared_at   IS DISTINCT FROM OLD.cleared_at) THEN
    NEW.d1_copied_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_task_records_reset_d1_copy ON public.task_records;
CREATE TRIGGER trg_task_records_reset_d1_copy
  BEFORE UPDATE ON public.task_records
  FOR EACH ROW EXECUTE FUNCTION public.task_records_reset_d1_copy();
