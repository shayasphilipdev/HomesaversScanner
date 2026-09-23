-- Bring Stock Count (task_type 'H') retention into line with Price Check.
--
-- Task H is a store-owned floor record, not a query awaiting an HO answer, so
-- as of 2026-09-23 the store can clear and delete it directly (STORE_CLEARABLE
-- / HARD_DELETABLE). Retention was the remaining difference: the purge rule
-- exempted anything still 'pending' unless it was J or K, so a Stock Count
-- nobody cleared was kept forever.
--
-- ONLY the task-type list changes. Everything else is reproduced verbatim from
-- the deployed definition so this migration cannot quietly alter the M branch,
-- the settings lookups or the defaults:
--
--     BEFORE   (task_type IN ('J','K')     OR status <> 'pending')
--     AFTER    (task_type IN ('J','K','H') OR status <> 'pending')
--
-- CONSEQUENCE, stated plainly: at the next 02:00 UTC run this deletes the
-- Stock Count records that are already past the cutoff -- 514 rows at the time
-- of writing, all 'pending', created 2026-08-24 to 2026-09-01. They are NOT
-- archived: the D1 archive is Department Check only, so this is a permanent
-- deletion. Chosen deliberately over archiving them, on the basis that a stock
-- count three weeks stale has no operational value.
--
-- From here on, Stock Counts a store clears age out at 21 days through the
-- `status <> 'pending'` branch exactly as before; this only changes the fate of
-- the ones nobody touches.

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
          ELSE created_at < v_cutoff
               -- J, K and H are the store's own floor records: they are done
               -- when the store says so, and nothing is waiting on HO, so
               -- 'pending' does not mean "still owed an answer" for them the
               -- way it does for the query types (A-G, I).
               AND (task_type IN ('J','K','H') OR status <> 'pending')
        END;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
