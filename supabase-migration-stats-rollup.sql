-- ============================================================================
--  Dashboard statistics rollup — task_stats_daily
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database.
-- ============================================================================
--
--  WHY
--  ---
--  Every dashboard number is computed live from task_records, but that table is
--  a rolling window. purge_old_task_records() (nightly 02:00 UTC) deletes rows
--  older than app_settings.scan_record_retention_days where
--      task_type IN ('J','K') OR status <> 'pending'
--  so Department Check (J) and Price Check (K) are deleted after the retention
--  window REGARDLESS of status. Records are also removable at any time via
--  bulk-delete, delete-jk-matching, and the login auto-cleanup.
--
--  Consequence: any dashboard range longer than the retention window is
--  computed over data that no longer exists. The "No Department Check" card
--  lists stores that DID do the check, and every long-range chart/KPI is wrong.
--
--  This table keeps ONLY per-day counts — no product codes, no barcodes, no
--  descriptions, no photos, no notes, no record ids, no per-record timestamps.
--  One row means "on this day, this store logged N records of this task type".
--  From ~8,000 records/day we keep ~25 rows. You could not reconstruct a single
--  scan from it, which is the point.
--
--  Record retention is UNCHANGED by this migration. task_records still purges
--  exactly as before; this is not a 6-month archive of records.
--
--  SIZING (measured 2026-09-02 on live): ~25 distinct (store, task_type) pairs
--  per day at ~8,000 records/day; ceiling 59 active stores x 12 types = 708.
--  At 6 months: ~4,500 rows realistic (<1 MB), ~127k worst case (~18 MB).
-- ============================================================================


-- ── STEP 0 — LOOK BEFORE YOU REPLACE ────────────────────────────────────────
-- dashboard_stats / stores_missing_dept_check / aging_created_last7 are NOT
-- tracked in this repo; they exist only in the live DB. The facts this
-- migration depends on were dumped on 2026-09-02 and are recorded here:
--
--   * DB timezone is UTC; dashboard_stats buckets by created_at::date, i.e.
--     the UTC calendar day. THIS TABLE MUST USE THE SAME EXPRESSION.
--   * dashboard_stats splits Ops = task_type IN ('H','J','K'), HO = everything
--     else (Task M is on the HO side). Not what you would guess — do not
--     confuse it with the client-side CHECK_CODES = {J,H,K,M} in Dashboard.jsx,
--     which drives the donuts only and has deliberately inverted titles.
--   * dashboard_stats excludes status = 'cleared' from EVERY figure it returns
--     (its `scoped` CTE). This table stores cleared separately so the read side
--     can subtract it and match, while `records` stays a true activity count
--     (a cleared Department Check still means the store did it).
--   * scan_record_retention_days is 21 on live (not the 14 quoted in older
--     docs). The recompute-window clamp below depends on it.
--
-- Re-dump before changing any of the above:
--   SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname IN
--     ('dashboard_stats','stores_missing_dept_check','purge_old_task_records');


-- ── STEP 1 — settings ───────────────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
  ('stats_rollup_window_days',    '7'),    -- past days recomputed each night
  ('stats_rollup_retention_days', '180')   -- how long the statistics are kept (6 months)
ON CONFLICT (key) DO NOTHING;


-- ── STEP 2 — the table ──────────────────────────────────────────────────────
--  Grain: one row per (UTC day, store, task type). Statuses are COLUMNS, not
--  part of the key.
--
--  WHY STATUSES AS COLUMNS: a record created on day D as 'pending' and
--  completed on D+3 would, with status in the key, force the rollup to
--  DECREMENT the (D,'pending') row on recompute. Decrementing makes the job a
--  mirror of the source — and a mirror turns every delete into erased history,
--  which is the exact thing this table exists to prevent. Columns let one
--  UPSERT apply two different rules at once (see STEP 3):
--      records/photos   -> GREATEST(old, new)  = never shrink, delete-proof
--      status columns   -> EXCLUDED.*          = mirrored, tracks transitions
--
--  NO FOREIGN KEYS, deliberately:
--    * stores.id — task_records.store_id is ON DELETE SET NULL, so a FK here
--      would NULL or cascade away the very history this table protects.
--      Orphans fold into the all-zeros sentinel uuid, because a NULL in a
--      unique key never conflicts and would silently duplicate rows on every
--      ON CONFLICT upsert.
--    * task_types.code — a deactivated or removed type keeps its statistics.
--
--  If a sixth task_records.status is ever added to the CHECK constraint in
--  supabase-schema.sql, add the matching column HERE and in STEP 3.
CREATE TABLE IF NOT EXISTS public.task_stats_daily (
  day               date        NOT NULL,
  store_id          uuid        NOT NULL,   -- 000...0 = record whose store was deleted
  task_type         text        NOT NULL,
  records           integer     NOT NULL DEFAULT 0,  -- created that day, ANY status; MONOTONIC
  pending           integer     NOT NULL DEFAULT 0,  -- status snapshot; mirrored while in window
  completed         integer     NOT NULL DEFAULT 0,
  no_change_needed  integer     NOT NULL DEFAULT 0,
  store_completed   integer     NOT NULL DEFAULT 0,
  cleared           integer     NOT NULL DEFAULT 0,  -- subtract for dashboard_stats parity
  photos            integer     NOT NULL DEFAULT 0,  -- had a product/barcode photo; MONOTONIC
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, store_id, task_type)
);

COMMENT ON TABLE public.task_stats_daily IS
  'Per-day counts only (no records). Survives task_records purge/deletion. Kept 6 months.';
COMMENT ON COLUMN public.task_stats_daily.records IS
  'Records created that day, any status incl. cleared. Never decreases - delete-proof.';
COMMENT ON COLUMN public.task_stats_daily.cleared IS
  'Of those, currently cleared. dashboard_stats excludes cleared, so reads use records - cleared.';

-- The PK's leading `day` already serves every read on a table this small.
-- Add (store_id, day) only if EXPLAIN on a single-store 6-month dashboard
-- actually shows it is needed — do not add it speculatively.

-- This DB has no RLS; Supabase default privileges cover new public tables.
-- Explicit grant is belt-and-braces so a missing default privilege can never
-- surface as a silently empty dashboard.
GRANT SELECT ON public.task_stats_daily TO anon, authenticated;


-- ── STEP 3 — the nightly rollup ─────────────────────────────────────────────
--  Recomputes the last N COMPLETE days. It never writes a row for today:
--  today is always read live (see dashboard_stats_v2), and a partial today row
--  is the one way this design could double-count.
--
--  COUPLING GUARD — READ BEFORE CHANGING EITHER NUMBER:
--    The recompute window MUST stay below scan_record_retention_days (live: 21).
--    Recomputing a day whose source rows are already purged is what would turn
--    real history into zeros. Two independent safeties, on purpose:
--      1. the window is clamped at run time to (retention - 3)  <- the intent
--      2. records/photos use GREATEST()                          <- the seatbelt
--    so even a mis-set window can only fail to RAISE a count, never lower one.
CREATE OR REPLACE FUNCTION public.rollup_task_stats_daily(p_days integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;  -- must match dashboard_stats
  v_window     integer;
  v_retention  integer;
  v_max_window integer;
  v_from       date;
  v_rows       integer;
BEGIN
  SELECT NULLIF(value,'')::integer INTO v_window
    FROM app_settings WHERE key = 'stats_rollup_window_days';
  v_window := COALESCE(p_days, v_window, 7);

  SELECT NULLIF(value,'')::integer INTO v_retention
    FROM app_settings WHERE key = 'scan_record_retention_days';
  v_retention := COALESCE(v_retention, 21);

  v_max_window := GREATEST(1, v_retention - 3);
  IF v_window > v_max_window THEN
    RAISE NOTICE 'rollup_task_stats_daily: window % clamped to % (scan_record_retention_days=%)',
                 v_window, v_max_window, v_retention;
    v_window := v_max_window;
  END IF;

  v_from := v_today - v_window;

  WITH src AS (
    SELECT
      (tr.created_at AT TIME ZONE 'UTC')::date                             AS day,
      COALESCE(tr.store_id, '00000000-0000-0000-0000-000000000000'::uuid)  AS store_id,
      tr.task_type,
      count(*)                                                             AS records,
      count(*) FILTER (WHERE tr.status = 'pending')                        AS pending,
      count(*) FILTER (WHERE tr.status = 'completed')                      AS completed,
      count(*) FILTER (WHERE tr.status = 'no_change_needed')               AS no_change_needed,
      count(*) FILTER (WHERE tr.status = 'store_completed')                AS store_completed,
      count(*) FILTER (WHERE tr.status = 'cleared')                        AS cleared,
      count(*) FILTER (WHERE tr.photo_product_url IS NOT NULL
                          OR tr.photo_barcode_url IS NOT NULL)             AS photos
    FROM task_records tr
    -- sargable on idx_tr_created_at; today deliberately excluded
    WHERE tr.created_at >= (v_from::timestamp  AT TIME ZONE 'UTC')
      AND tr.created_at <  (v_today::timestamp AT TIME ZONE 'UTC')
    GROUP BY 1, 2, 3
  )
  INSERT INTO task_stats_daily AS d
    (day, store_id, task_type, records, pending, completed,
     no_change_needed, store_completed, cleared, photos, updated_at)
  SELECT day, store_id, task_type, records, pending, completed,
         no_change_needed, store_completed, cleared, photos, now()
  FROM src
  ON CONFLICT (day, store_id, task_type) DO UPDATE SET
    records          = GREATEST(d.records, EXCLUDED.records),  -- never shrinks: delete-proof
    photos           = GREATEST(d.photos,  EXCLUDED.photos),
    pending          = EXCLUDED.pending,                       -- mirrored: tracks transitions
    completed        = EXCLUDED.completed,
    no_change_needed = EXCLUDED.no_change_needed,
    store_completed  = EXCLUDED.store_completed,
    cleared          = EXCLUDED.cleared,
    updated_at       = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;


-- ── STEP 4 — correction escape hatch (manual, never scheduled) ──────────────
--  rollup_task_stats_daily() can only ever RAISE `records`. If a day is
--  genuinely wrong (e.g. duplicate scans deleted on purpose), this rebuilds it
--  from source — and REFUSES any day whose source rows may already be purged,
--  which is the only way a rebuild could destroy real history.
CREATE OR REPLACE FUNCTION public.rebuild_task_stats_daily(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_today     date := (now() AT TIME ZONE 'UTC')::date;
  v_retention integer;
  v_deleted   integer;
BEGIN
  SELECT NULLIF(value,'')::integer INTO v_retention
    FROM app_settings WHERE key = 'scan_record_retention_days';
  v_retention := COALESCE(v_retention, 21);

  IF p_from < v_today - (v_retention - 1) THEN
    RAISE EXCEPTION
      'rebuild_task_stats_daily: % is older than scan_record_retention_days (%) — source rows are gone, rebuilding would zero real history',
      p_from, v_retention;
  END IF;

  DELETE FROM task_stats_daily WHERE day BETWEEN p_from AND LEAST(p_to, v_today - 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM rollup_task_stats_daily((v_today - p_from)::integer);
  RETURN v_deleted;
END;
$function$;


-- ── STEP 5 — 6-month retention for the statistics themselves ────────────────
--  Deliberately its OWN function and OWN cron job rather than folded into
--  purge_old_task_records(): that function is untracked in this repo and each
--  migration replaces it wholesale, so folding this in would leave it one
--  careless CREATE OR REPLACE away from silently disappearing. Separate jobs
--  also fail separately and visibly in cron.job_run_details.
CREATE OR REPLACE FUNCTION public.purge_task_stats_daily()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE keep_days integer; removed integer;
BEGIN
  SELECT NULLIF(value,'')::integer INTO keep_days
    FROM app_settings WHERE key = 'stats_rollup_retention_days';
  keep_days := COALESCE(keep_days, 180);

  DELETE FROM task_stats_daily
  WHERE day < ((now() AT TIME ZONE 'UTC')::date - keep_days);

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$function$;


-- ── STEP 6 — schedule (UTC) ─────────────────────────────────────────────────
--  Existing slots: 01:00 generate-store-task-instances · 01:05 mark-missed ·
--  02:00 purge-old-task-records · 02:30 / 02:40 vacuums.
--  THE ROLLUP MUST RUN BEFORE 02:00 — it reads the rows the purge deletes.
--  Plain FUNCTIONs called via SELECT: pg_cron cannot run a PROCEDURE with a
--  COMMIT loop ("invalid transaction termination"), which silently broke the
--  purge job once before.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rollup-task-stats-daily';
SELECT cron.schedule('rollup-task-stats-daily', '30 1 * * *',
  $$SELECT public.rollup_task_stats_daily();$$);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-task-stats-daily';
SELECT cron.schedule('purge-task-stats-daily', '10 2 * * *',
  $$SELECT public.purge_task_stats_daily();$$);


-- ── STEP 7 — backfill (one-off) ─────────────────────────────────────────────
--  Only the clamped window is recoverable, and its older days are already
--  missing whatever was purged or hard-deleted, so treat pre-deploy history as
--  PARTIAL. Do NOT try to backfill months from the surviving pending A-I rows:
--  that manufactures a history in which no store ever did a Department Check,
--  i.e. exactly the bug this table fixes.
SELECT public.rollup_task_stats_daily() AS backfilled_rows;


-- ── STEP 8 — verify ─────────────────────────────────────────────────────────
SELECT 'rollup_task_stats_daily' AS fn, rollup_task_stats_daily() IS NOT NULL AS ok
UNION ALL
SELECT 'purge_task_stats_daily',       purge_task_stats_daily()  IS NOT NULL;

SELECT min(day) AS coverage_from, max(day) AS coverage_to,
       count(*) AS row_count, count(DISTINCT day) AS days,
       round(count(*)::numeric / GREATEST(count(DISTINCT day),1), 1) AS rows_per_day,
       pg_size_pretty(pg_total_relation_size('task_stats_daily')) AS size
FROM task_stats_daily;

-- Parity against live source for every day still inside retention.
-- MUST return zero rows.
SELECT s.day, s.store_id, s.task_type, s.records AS rollup, l.records AS live
FROM task_stats_daily s
JOIN (
  SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
         COALESCE(store_id,'00000000-0000-0000-0000-000000000000'::uuid) AS store_id,
         task_type, count(*) AS records
  FROM task_records
  WHERE created_at >= (((now() AT TIME ZONE 'UTC')::date - 7)::timestamp AT TIME ZONE 'UTC')
    AND created_at <  (((now() AT TIME ZONE 'UTC')::date)::timestamp     AT TIME ZONE 'UTC')
  GROUP BY 1,2,3
) l ON l.day = s.day AND l.store_id = s.store_id AND l.task_type = s.task_type
WHERE s.records <> l.records;


-- ── STEP 9 — note ───────────────────────────────────────────────────────────
--  store_task_instances gets NO rollup: it has no retention purge anywhere, so
--  store_task_stats_agg() is not at risk. Revisit only if a purge is ever added
--  there.
