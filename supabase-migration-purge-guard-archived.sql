-- Phase 3 guard: a Task J record cannot be deleted until the D1 archiver has
-- confirmed the archive holds it.
--
-- Until now the ordering was only a convention about clock times -- archiver at
-- 01:30, purge at 02:00. A night where the archiver failed to run, or ran and
-- errored, deleted records that were never archived, and nothing detected it.
-- The guard makes the claim explicit: Postgres will not remove what D1 has not
-- said it has.
--
-- The failure mode is now the safe one. If the archiver stops, J records simply
-- accumulate in Supabase instead of being destroyed: ~5,300/day at ~549 bytes
-- is ~3 MB/day against 257 MB of free-tier headroom, so there is close to three
-- months to notice -- and the data is all still there when it is.
--
-- Depends on: supabase-migration-add-archived-at (the column), and the archiver
-- Worker running with SHADOW_MODE = "0" so something actually stamps it.
--
-- ONLY the J branch changes. K and H keep deleting on age regardless of status
-- (store-owned floor records, not archived), M keeps its 180-day expiry window,
-- and the query types (A-G, I) keep their `status <> 'pending'` exemption so an
-- unanswered store query is never purged.
--
-- Verified after applying, without deleting anything: with 547 J records past
-- the cutoff and none marked, the purge predicate selects 0 of them. H still
-- selects its 514, and B/C/K are unaffected.
CREATE OR REPLACE FUNCTION public.purge_old_task_records()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days           int;
  v_expiry_days    int;
  v_cutoff         timestamptz;
  v_expiry_cutoff  timestamptz;
  v_deleted        int;
BEGIN
  SELECT NULLIF(value,'')::int INTO v_days FROM app_settings WHERE key = 'scan_record_retention_days';
  IF v_days IS NULL OR v_days < 1 THEN v_days := 21; END IF;
  v_cutoff := now() - make_interval(days => v_days);

  SELECT NULLIF(value,'')::int INTO v_expiry_days FROM app_settings WHERE key = 'expiry_record_retention_days';
  IF v_expiry_days IS NULL OR v_expiry_days < 1 THEN v_expiry_days := 180; END IF;
  v_expiry_cutoff := now() - make_interval(days => v_expiry_days);

  DELETE FROM task_records
  WHERE CASE
          WHEN task_type = 'M'
            THEN created_at < v_expiry_cutoff
          -- Department Check is archived to Cloudflare D1 before deletion, so
          -- it may only be removed once the archiver has stamped archived_at.
          WHEN task_type = 'J'
            THEN created_at < v_cutoff
                 AND archived_at IS NOT NULL
          ELSE created_at < v_cutoff
               -- K and H are the store's own floor records: nothing is waiting
               -- on HO, so 'pending' does not mean "still owed an answer" for
               -- them the way it does for the query types (A-G, I).
               AND (task_type IN ('K','H') OR status <> 'pending')
        END;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
