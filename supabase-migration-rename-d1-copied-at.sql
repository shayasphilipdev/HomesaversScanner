-- Phase 5 of the 7-week retention change: remove the name collision before the
-- Archive button ships.
--
-- THE COLLISION
-- task_records.archived_at does NOT mean "the user archived this record". It
-- means "the archiver Worker has confirmed Cloudflare D1 holds a copy". Those
-- were the same thing while the archive was an internal mechanism nobody saw.
-- Phase 6 puts an **Archive** button in front of every user, at which point a
-- column called archived_at that has nothing to do with that button is a trap
-- laid for whoever reads this schema next -- and the obvious wrong reading
-- ("only archived records have archived_at set") would send them looking for a
-- bug in the purge.
--
-- After this:
--   status = 'cleared'   the record was archived by a user   (label: "Archived")
--   cleared_at           when they did it
--   d1_copied_at         when the archiver copied it to D1   (nothing to do with the button)
--
-- WHY THE STORED STATUS VALUE IS *NOT* RENAMED TO 'archived'
-- The plan called for migrating status 'cleared' -> 'archived' as well. Having
-- now inventoried it, that change costs a great deal and buys nothing:
--
--   * Eight functions embed the literal -- dashboard_stats, dashboard_stats_v2,
--     manager_overview, report_task_records_flat_page, report_task_records_page,
--     rollup_task_stats_daily and both realtime stats triggers -- plus two CHECK
--     constraints, two partial indexes (idx_tr_active_created_at and
--     idx_tr_active_store_date are WHERE status <> 'cleared'), the
--     task_stats_daily.cleared column and 5,678 rows of data.
--   * This is a PWA and live/test share one Supabase. A store running a cached
--     bundle would keep sending status=cleared against a CHECK constraint that
--     no longer permits it, so its archive action would start failing until the
--     device happened to refresh. That is a store-facing outage in exchange for
--     an internal spelling.
--   * Every user-visible surface already reads "Archived" -- all four label maps,
--     the status dropdown, the detail modal. The requirement was that only
--     genuinely archived records show as Archived, and that was met in Phase 2
--     when /reports/archive stopped hardcoding the status for every D1 row.
--
-- So 'cleared' stays as the stored value, documented, with "Archived" as its
-- one and only label. If the spelling is ever wanted, it is a self-contained
-- change that can be made on its own -- it does not need to ride along with a
-- retention change that touches deletion.
--
-- ORDERING NOTE. The rename and the function that reads the column are in ONE
-- transaction, so the purge is never left referencing a column that does not
-- exist. Between this migration and the Worker deploys that follow it, the
-- archiver's PATCH and runAutoCleanup briefly reference the old name; both fail
-- closed -- an error means nothing is marked and nothing is deleted -- which is
-- the direction this whole phase is built to fail in.

ALTER TABLE public.task_records
  RENAME COLUMN archived_at TO d1_copied_at;

COMMENT ON COLUMN public.task_records.d1_copied_at IS
  'When the archiver Worker confirmed the Cloudflare D1 archive holds this row. '
  'NOT a user action and NOT related to the Archive button -- that is status '
  '''cleared'' plus cleared_at. purge_old_task_records() refuses to delete a '
  'record while this is NULL, so a stalled archiver leaves records in Postgres '
  'rather than destroying unarchived ones.';

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

  DELETE FROM task_records
  WHERE created_at < v_cutoff
    AND d1_copied_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
