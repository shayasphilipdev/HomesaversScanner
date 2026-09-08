-- ============================================================================
--  Real-time stats capture — close the same-day create-then-delete gap
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database.
-- ============================================================================
--
--  WHY
--  ---
--  task_stats_daily (supabase-migration-stats-rollup.sql) exists so a Department
--  Check still counts toward compliance even after its record is deleted -- but
--  it was only ever filled once a night, by rollup_task_stats_daily() at 01:30
--  UTC. A store can scan a Department Check and hit Delete (store users are
--  allowed to hard-delete their own J/K records -- functions/api/[[route]].js,
--  the recMatch DELETE handler, "Store users may permanently delete
--  Department/Price Check (J/K) records in their stores") within the SAME day,
--  well before that night's rollup ever runs. That record is then gone from
--  task_records (deleted) AND absent from task_stats_daily (rollup hasn't run
--  yet) -- it never gets counted anywhere, and the store looks like it skipped
--  the check it actually did. Reported 2026-09-08: "Store can do a department
--  check and delete immediately" / "you need to capture every Department Check
--  ... when it is created" (in the dashboard charts and graphs).
--
--  FIX
--  ---
--  Two triggers on task_records populate task_stats_daily the INSTANT a record
--  is created/updated, instead of waiting for the nightly batch:
--    * AFTER INSERT  -> +1 to records (and the matching status/photo column)
--    * AFTER UPDATE  -> status/photo-presence transitions kept in sync
--    * (deliberately NO trigger on DELETE -- the whole point is that removing
--      the live record must never reduce what was already captured)
--  rollup_task_stats_daily() is UNCHANGED and keeps running nightly as a
--  reconciling backstop (its GREATEST()-based UPSERT can only raise a count to
--  match live reality, never lower one the trigger already captured).
--
--  dashboard_stats_v2's dept_check_7d sub-query is adjusted by exactly one
--  bound: its task_stats_daily branch read "day <= v_today - 1" (deliberately
--  skipping today, because at design time nothing ever populated today's row
--  before this migration). Now that a trigger populates today's row live, that
--  branch is widened to "day <= v_today" so it can stand in for the live
--  task_records branch when a same-day record has since been deleted. This is
--  the ONLY change to that function; every other CTE (hist/gap/live/by_day/
--  by_store/totals) is copied verbatim from the live definition dumped below.
--  dept_check_7d selects DISTINCT store_id (existence, not a sum), so folding
--  today into both branches cannot double-count anything.
--
--  Everything here was proven first inside a BEGIN...ROLLBACK transaction on
--  the live DB (store 1045, which had zero J records ever): insert a J record
--  -> task_stats_daily.records goes 0 -> 1 -> hard-delete the record (confirmed
--  gone from task_records) -> task_stats_daily.records stays 1 and the store's
--  id now appears in dept_check_7d.store_ids. Then rolled back -- this file is
--  what actually applies it.
-- ============================================================================


-- ── STEP 0 — the live dashboard_stats_v2 definition this migration edits ───
-- Dumped 2026-09-08. Only the "day <= v_today - 1" -> "day <= v_today" bound
-- in the dept_check CTE differs from what was live; nothing else changed.
-- (Full prior definition kept in supabase-migration-dashboard-stats-v2.sql.)


-- ── Trigger 1: capture on INSERT ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.task_stats_daily_capture_insert()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_day       date := (NEW.created_at AT TIME ZONE 'UTC')::date;
  v_store     uuid := COALESCE(NEW.store_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_has_photo boolean := (NEW.photo_product_url IS NOT NULL OR NEW.photo_barcode_url IS NOT NULL);
BEGIN
  INSERT INTO task_stats_daily AS d
    (day, store_id, task_type, records, pending, completed, no_change_needed, store_completed, cleared, photos, updated_at)
  VALUES (
    v_day, v_store, NEW.task_type, 1,
    (NEW.status = 'pending')::int, (NEW.status = 'completed')::int,
    (NEW.status = 'no_change_needed')::int, (NEW.status = 'store_completed')::int,
    (NEW.status = 'cleared')::int, v_has_photo::int, now()
  )
  ON CONFLICT (day, store_id, task_type) DO UPDATE SET
    records          = d.records + 1,
    pending          = d.pending          + (NEW.status = 'pending')::int,
    completed        = d.completed        + (NEW.status = 'completed')::int,
    no_change_needed = d.no_change_needed + (NEW.status = 'no_change_needed')::int,
    store_completed  = d.store_completed  + (NEW.status = 'store_completed')::int,
    cleared          = d.cleared          + (NEW.status = 'cleared')::int,
    photos           = d.photos + v_has_photo::int,
    updated_at       = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_task_stats_capture_insert ON public.task_records;
CREATE TRIGGER trg_task_stats_capture_insert
AFTER INSERT ON public.task_records
FOR EACH ROW EXECUTE FUNCTION public.task_stats_daily_capture_insert();


-- ── Trigger 2: keep status/photo columns in sync on UPDATE ─────────────────
-- Never touches `records` (that column only ever grows, on INSERT). Status
-- columns move with the record right up until it's deleted, then freeze at
-- whatever they last were -- same "survive deletion" rule the INSERT side
-- follows, just applied continuously instead of only at nightly rollup time.
CREATE OR REPLACE FUNCTION public.task_stats_daily_capture_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_day       date := (NEW.created_at AT TIME ZONE 'UTC')::date;
  v_store     uuid := COALESCE(NEW.store_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_old_photo boolean := (OLD.photo_product_url IS NOT NULL OR OLD.photo_barcode_url IS NOT NULL);
  v_new_photo boolean := (NEW.photo_product_url IS NOT NULL OR NEW.photo_barcode_url IS NOT NULL);
BEGIN
  IF NEW.status = OLD.status AND v_new_photo = v_old_photo THEN
    RETURN NEW;
  END IF;

  UPDATE task_stats_daily d SET
    pending          = GREATEST(0, d.pending          - (OLD.status = 'pending')::int          + (NEW.status = 'pending')::int),
    completed        = GREATEST(0, d.completed        - (OLD.status = 'completed')::int        + (NEW.status = 'completed')::int),
    no_change_needed = GREATEST(0, d.no_change_needed - (OLD.status = 'no_change_needed')::int + (NEW.status = 'no_change_needed')::int),
    store_completed  = GREATEST(0, d.store_completed  - (OLD.status = 'store_completed')::int  + (NEW.status = 'store_completed')::int),
    cleared          = GREATEST(0, d.cleared          - (OLD.status = 'cleared')::int          + (NEW.status = 'cleared')::int),
    -- photos is monotonic like records -- a photo being added can raise it,
    -- but it can never be pushed back down even if a photo URL is cleared.
    photos           = GREATEST(d.photos, d.photos - v_old_photo::int + v_new_photo::int),
    updated_at       = now()
  WHERE d.day = v_day AND d.store_id = v_store AND d.task_type = NEW.task_type;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_task_stats_capture_update ON public.task_records;
CREATE TRIGGER trg_task_stats_capture_update
AFTER UPDATE ON public.task_records
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status
   OR OLD.photo_product_url IS DISTINCT FROM NEW.photo_product_url
   OR OLD.photo_barcode_url IS DISTINCT FROM NEW.photo_barcode_url)
EXECUTE FUNCTION public.task_stats_daily_capture_update();


-- ── dashboard_stats_v2: widen dept_check's rollup-branch bound by one day ──
-- Every CTE below is unchanged from the live function except the single
-- "AND day >= v_dc_from AND day <= v_today" line inside dept_check (was
-- "day <= v_today - 1").
CREATE OR REPLACE FUNCTION public.dashboard_stats_v2(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_store_ids uuid[] DEFAULT NULL::uuid[], p_bucket text DEFAULT 'auto'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
 SET work_mem TO '32MB'
AS $function$
DECLARE
  v_today    date := (now() AT TIME ZONE 'UTC')::date;
  v_from_day date := COALESCE((p_from AT TIME ZONE 'UTC')::date, v_today - 29);
  v_to_day   date := COALESCE((p_to   AT TIME ZONE 'UTC')::date, v_today);
  v_hist_to  date;
  v_bucket   text;
  v_sentinel uuid := '00000000-0000-0000-0000-000000000000';
  v_dc_from  date := v_today - 6;
  result json;
BEGIN
  v_hist_to := LEAST(v_to_day, v_today - 1);

  v_bucket := CASE
    WHEN p_bucket IN ('day','week','month') THEN p_bucket
    WHEN (v_to_day - v_from_day) <= 31  THEN 'day'
    WHEN (v_to_day - v_from_day) <= 120 THEN 'week'
    ELSE 'month' END;

  WITH
  covered AS (
    SELECT DISTINCT day FROM task_stats_daily
     WHERE day >= v_from_day AND day <= v_hist_to
  ),
  hist AS (
    SELECT day, store_id, task_type,
           GREATEST(0, records - cleared) AS active,
           records AS raw_records,
           pending, completed, no_change_needed, store_completed
    FROM task_stats_daily
    WHERE day >= v_from_day AND day <= v_hist_to
      AND (p_store_ids IS NULL OR store_id = ANY(p_store_ids))
  ),
  gap AS (
    SELECT (tr.created_at AT TIME ZONE 'UTC')::date            AS day,
           COALESCE(tr.store_id, v_sentinel)                   AS store_id,
           tr.task_type,
           count(*)                                            AS active,
           count(*)                                            AS raw_records,
           count(*) FILTER (WHERE tr.status='pending')          AS pending,
           count(*) FILTER (WHERE tr.status='completed')        AS completed,
           count(*) FILTER (WHERE tr.status='no_change_needed') AS no_change_needed,
           count(*) FILTER (WHERE tr.status='store_completed')  AS store_completed
    FROM task_records tr
    WHERE tr.status <> 'cleared'
      AND tr.created_at >= GREATEST(COALESCE(p_from,'-infinity'::timestamptz),
                                    (v_from_day::timestamp AT TIME ZONE 'UTC'))
      AND tr.created_at <  (LEAST(v_hist_to + 1, v_today)::timestamp AT TIME ZONE 'UTC')
      AND (p_to IS NULL OR tr.created_at <= p_to)
      AND (p_store_ids IS NULL OR tr.store_id = ANY(p_store_ids))
      AND (tr.created_at AT TIME ZONE 'UTC')::date NOT IN (SELECT day FROM covered)
    GROUP BY 1,2,3
  ),
  live AS (
    SELECT (tr.created_at AT TIME ZONE 'UTC')::date            AS day,
           COALESCE(tr.store_id, v_sentinel)                   AS store_id,
           tr.task_type,
           count(*)                                            AS active,
           count(*)                                            AS raw_records,
           count(*) FILTER (WHERE tr.status='pending')          AS pending,
           count(*) FILTER (WHERE tr.status='completed')        AS completed,
           count(*) FILTER (WHERE tr.status='no_change_needed') AS no_change_needed,
           count(*) FILTER (WHERE tr.status='store_completed')  AS store_completed
    FROM task_records tr
    WHERE v_to_day >= v_today
      AND tr.status <> 'cleared'
      AND tr.created_at >= GREATEST(COALESCE(p_from,'-infinity'::timestamptz),
                                    (v_today::timestamp AT TIME ZONE 'UTC'))
      AND (p_to IS NULL OR tr.created_at <= p_to)
      AND (p_store_ids IS NULL OR tr.store_id = ANY(p_store_ids))
    GROUP BY 1,2,3
  ),
  all_rows AS (
    SELECT * FROM hist UNION ALL SELECT * FROM gap UNION ALL SELECT * FROM live
  ),
  series AS (
    SELECT generate_series(
      CASE v_bucket WHEN 'day'  THEN v_from_day
                    WHEN 'week' THEN date_trunc('week',  v_from_day)::date
                    ELSE             date_trunc('month', v_from_day)::date END,
      v_to_day,
      CASE v_bucket WHEN 'day' THEN interval '1 day'
                    WHEN 'week' THEN interval '1 week'
                    ELSE interval '1 month' END)::date AS b
  ),
  bucketed AS (
    SELECT CASE v_bucket WHEN 'day'  THEN day
                         WHEN 'week' THEN date_trunc('week',  day)::date
                         ELSE             date_trunc('month', day)::date END AS b,
           sum(active)                                                        AS cnt,
           sum(active) FILTER (WHERE task_type NOT IN ('H','J','K'))          AS ho_cnt,
           sum(active) FILTER (WHERE task_type     IN ('H','J','K'))          AS ops_cnt
    FROM all_rows GROUP BY 1
  ),
  dept_check AS (
    SELECT DISTINCT store_id FROM (
      SELECT store_id FROM task_stats_daily
       WHERE task_type='J' AND records > 0
         AND day >= v_dc_from AND day <= v_today          -- was: day <= v_today - 1
         AND (p_store_ids IS NULL OR store_id = ANY(p_store_ids))
      UNION ALL
      SELECT COALESCE(store_id, v_sentinel) FROM task_records
       WHERE task_type='J'
         AND created_at >= (v_dc_from::timestamp AT TIME ZONE 'UTC')
         AND (p_store_ids IS NULL OR store_id = ANY(p_store_ids))
    ) d
  )
  SELECT json_build_object(
    'totals', (SELECT json_build_object(
        'all', COALESCE(sum(active),0), 'pending', COALESCE(sum(pending),0),
        'completed', COALESCE(sum(completed),0),
        'no_change_needed', COALESCE(sum(no_change_needed),0),
        'store_completed', COALESCE(sum(store_completed),0)) FROM all_rows),
    'ho_totals', (SELECT json_build_object(
        'all', COALESCE(sum(active),0), 'pending', COALESCE(sum(pending),0),
        'completed', COALESCE(sum(completed),0),
        'no_change_needed', COALESCE(sum(no_change_needed),0),
        'store_completed', COALESCE(sum(store_completed),0))
        FROM all_rows WHERE task_type NOT IN ('H','J','K')),
    'ops_totals', (SELECT json_build_object(
        'all', COALESCE(sum(active),0), 'pending', COALESCE(sum(pending),0),
        'store_completed', COALESCE(sum(store_completed),0))
        FROM all_rows WHERE task_type IN ('H','J','K')),
    'by_task_type', COALESCE((
        SELECT json_agg(json_build_object('code', x.task_type,
                                          'name', COALESCE(tt.name, x.task_type),
                                          'count', x.cnt) ORDER BY x.cnt DESC)
        FROM (SELECT task_type, sum(active) cnt FROM all_rows GROUP BY 1 HAVING sum(active) > 0) x
        LEFT JOIN task_types tt ON tt.code = x.task_type), '[]'::json),
    'by_store', COALESCE((
        SELECT json_agg(json_build_object(
                 'id', ps.store_id, 'store_name', s.store_name, 'store_code', s.store_code,
                 'count', ps.total, 'total', ps.total, 'types', ps.types) ORDER BY ps.total DESC)
        FROM (SELECT a.store_id, sum(a.per_type)::bigint AS total,
                     json_agg(json_build_object('code', a.task_type,
                                                'name', COALESCE(tt2.name, a.task_type),
                                                'count', a.per_type) ORDER BY a.per_type DESC) AS types
              FROM (SELECT store_id, task_type, sum(active) per_type
                    FROM all_rows GROUP BY 1,2 HAVING sum(active) > 0) a
              LEFT JOIN task_types tt2 ON tt2.code = a.task_type
              WHERE a.store_id <> v_sentinel
              GROUP BY a.store_id) ps
        JOIN stores s ON s.id = ps.store_id), '[]'::json),
    'by_day', COALESCE((
        SELECT json_agg(json_build_object(
          'date', to_char(sr.b,'YYYY-MM-DD'),
          'label', CASE v_bucket WHEN 'day'  THEN to_char(sr.b,'DD Mon')
                                 WHEN 'week' THEN 'Wk '||to_char(sr.b,'DD Mon')
                                 ELSE to_char(sr.b,'Mon YYYY') END,
          'count', COALESCE(bd.cnt,0), 'ho_count', COALESCE(bd.ho_cnt,0),
          'ops_count', COALESCE(bd.ops_cnt,0)) ORDER BY sr.b)
        FROM series sr LEFT JOIN bucketed bd ON bd.b = sr.b), '[]'::json),
    'bucket', v_bucket,
    'data_from', (SELECT to_char(min(day),'YYYY-MM-DD') FROM all_rows WHERE active > 0),
    'data_to',   (SELECT to_char(max(day),'YYYY-MM-DD') FROM all_rows WHERE active > 0),
    'stats_from',(SELECT to_char(min(day),'YYYY-MM-DD') FROM task_stats_daily),
    'dept_check_7d', json_build_object(
        'days', 7,
        'from', to_char(v_dc_from,'YYYY-MM-DD'),
        'store_ids', COALESCE((SELECT json_agg(store_id) FROM dept_check), '[]'::json)),
    'recent', COALESCE((
        SELECT json_agg(r) FROM (
          SELECT s.id, s.task_type, s.store_id,
                 COALESCE(st.store_name,'') AS store_name,
                 COALESCE(NULLIF(s.item_name,''), NULLIF(s.description,''),
                          NULLIF(s.product_name_label,''), NULLIF(s.product_code,''),
                          s.product_barcode, '') AS product,
                 s.status, s.created_at
          FROM task_records s
          LEFT JOIN stores st ON st.id = s.store_id
          WHERE s.status <> 'cleared'
            AND (p_store_ids IS NULL OR s.store_id = ANY(p_store_ids))
            AND (p_from IS NULL OR s.created_at >= p_from)
            AND (p_to   IS NULL OR s.created_at <= p_to)
          ORDER BY s.created_at DESC LIMIT 10) r), '[]'::json)
  ) INTO result;
  RETURN result;
END;
$function$;


-- ── VERIFY (read-only, safe to run any time) ────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgrelid='public.task_records'::regclass AND NOT tgisinternal;
--   -> expect trg_task_stats_capture_insert, trg_task_stats_capture_update
--
-- Live proof, non-destructive (swap store_code for any real store):
--   BEGIN;
--     INSERT INTO task_records (id, store_id, task_type, status, product_code,
--       description, uom, quantity, created_at, updated_at)
--     SELECT gen_random_uuid(), id, 'J', 'pending', 'VERIFY-TEST', 'verify', 'Eachs', 1, now(), now()
--     FROM stores WHERE store_code = '1045' RETURNING store_id \gset
--     -- records should now show 1 for today/that store/J in task_stats_daily
--     DELETE FROM task_records WHERE product_code = 'VERIFY-TEST';
--     -- records should STILL show 1 -- that's the fix
--   ROLLBACK;
-- ============================================================================
