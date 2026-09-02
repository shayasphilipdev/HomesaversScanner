-- ============================================================================
--  dashboard_stats_v2 + stores_missing_dept_check_v2 — read from the rollup
--
--  Run AFTER supabase-migration-stats-rollup.sql. Affects the LIVE database.
-- ============================================================================
--
--  WHY
--  ---
--  task_stats_daily now preserves per-day counts past the nightly purge, but
--  nothing reads it yet. These two functions are the read side.
--
--  THE READ RULE — every day is served by exactly one source, so nothing can
--  be counted twice and nothing that still exists is ever dropped:
--
--      day <  today, rollup HAS that day   ->  task_stats_daily (delete-proof)
--      day <  today, rollup MISSING it     ->  live task_records (`gap` CTE)
--      day == today                        ->  live task_records
--
--  The `gap` arm matters more than it looks. Without it the dashboard would
--  REGRESS on the day this ships: the rollup starts empty, so every day before
--  deployment would read as zero even though up to scan_record_retention_days
--  of real records are still sitting in task_records. Measured 2026-09-02, a
--  30-day range dropped from 135,769 to 47,305 without this arm. It also
--  covers a mid-history hole if the nightly job ever fails for a few days.
--
--  Guards against double counting: rollup_task_stats_daily() never writes a row
--  for today; the rollup read is clamped to day <= (today - 1); and `gap` is
--  restricted to days NOT IN (SELECT day FROM covered), so hist and gap are
--  disjoint by construction.
--
--  WHY v2 RATHER THAN CREATE OR REPLACE dashboard_stats:
--    * v1's definition was never tracked in this repo (it is reproduced in the
--      appendix at the bottom of this file so that stops being true).
--      Replacing an untracked function risks silently discarding logic added
--      directly in the DB.
--    * Rollback is one string in functions/api/[[route]].js.
--    * Both can run side by side, which is what made the parity check below
--      possible.
--
--  VERIFIED PARITY (2026-09-02, live, v1 vs v2, midnight-aligned ranges):
--    last 7 days   38129 = 38129
--    last 30 days 135769 = 135769
--    last 90 days 135769 = 135769
--    and on a 7-day range: ho_totals.all 46 = 46 · ops_totals.all 38076 =
--    38076 · totals.pending 38077 = 38077 · by_day / by_store / by_task_type
--    element-wise mismatches: 0 / 0 / 0.
--    Bucketing: 7d -> day(7 pts) · 30d -> day(30) · 90d -> week(14) ·
--    6 months -> month(7). The old Worker-side loop capped every one of these
--    at 14 daily points.
--    NOTE the range must start at a UTC midnight for exact parity. The rollup
--    is day-grained, so a range starting mid-day (e.g. `now() - interval '6
--    days'`) rounds out to the whole first day and legitimately reports more
--    than v1. Every preset in client/src/lib/dateRange.js emits midnight
--    boundaries, so this does not arise in the app.
--
--  FACTS COPIED FROM THE v1 DUMP (do not "simplify" these):
--    * Ops = task_type IN ('H','J','K'); HO = everything else. Task M is on
--      the HO side. This is NOT the client-side CHECK_CODES = {J,H,K,M} in
--      Dashboard.jsx, which drives the donuts only.
--    * status = 'cleared' is excluded from every figure. The rollup stores
--      `cleared` separately, so the read subtracts it: active = records -
--      cleared. `records` itself stays a true activity count, which is what
--      dept_check_7d uses (a cleared Department Check still means it was done).
--    * by_task_type ORDER BY count DESC; by_store ORDER BY total DESC with
--      types ORDER BY count DESC; by_store INNER JOINs stores, so orphaned
--      store_id rows count in totals but are never listed per store.
--    * `recent` is raw records, not statistics — it still reads task_records
--      and is unchanged.
-- ============================================================================


-- ── STEP 1 — the dashboard read ─────────────────────────────────────────────
--  Adds over v1: p_bucket (day/week/month, auto by range length), by_day[].label,
--  data_from/data_to, stats_from (so the UI can say "statistics start ..."
--  instead of drawing a fake flatline for months before deploy), and
--  dept_check_7d (stores that DID a Department Check in the last 7 days,
--  including today — the card no longer follows the selected range).
CREATE OR REPLACE FUNCTION public.dashboard_stats_v2(
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL,
  p_store_ids uuid[]      DEFAULT NULL,
  p_bucket    text        DEFAULT 'auto'
)
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
  v_dc_from  date := v_today - 6;   -- dept-check window: 7 days INCLUDING today
  result json;
BEGIN
  v_hist_to := LEAST(v_to_day, v_today - 1);

  v_bucket := CASE
    WHEN p_bucket IN ('day','week','month') THEN p_bucket
    WHEN (v_to_day - v_from_day) <= 31  THEN 'day'
    WHEN (v_to_day - v_from_day) <= 120 THEN 'week'
    ELSE 'month' END;

  WITH
  -- Which past days does the rollup actually cover? Anything it does not cover
  -- is served from live records by `gap` below, so hist and gap are disjoint.
  -- NOTE: deliberately NOT scoped by p_store_ids -- this answers "is the day
  -- rolled up at all", which must not change with the store filter.
  covered AS (
    SELECT DISTINCT day FROM task_stats_daily
     WHERE day >= v_from_day AND day <= v_hist_to
  ),
  -- Past days the rollup covers: authoritative and delete-proof.
  -- active = records - cleared, to match v1 which excludes cleared.
  -- GREATEST(0, ...) because `records` is monotonic while `cleared` is
  -- mirrored, so a heavily-deleted old day could otherwise cross over.
  hist AS (
    SELECT day, store_id, task_type,
           GREATEST(0, records - cleared) AS active,
           records AS raw_records,
           pending, completed, no_change_needed, store_completed
    FROM task_stats_daily
    WHERE day >= v_from_day
      AND day <= v_hist_to                              -- guard #2 vs double count
      AND (p_store_ids IS NULL OR store_id = ANY(p_store_ids))
  ),
  -- Past days the rollup does NOT cover (pre-deployment history, or a night the
  -- job failed): fall back to whatever records survive. Without this the
  -- dashboard regresses on deploy day -- see THE READ RULE at the top.
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
  -- Today only: live, because nothing is purged same-day.
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
  -- Bucket series gap-filled IN SQL: the Worker has a 10ms CPU budget and must
  -- not loop over 180 days in JS (that loop is deleted from [[route]].js).
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
  -- Independent of the selected range: "who did a Department Check in the last
  -- 7 days?" Uses raw `records` (a cleared check still counts as done).
  dept_check AS (
    SELECT DISTINCT store_id FROM (
      SELECT store_id FROM task_stats_daily
       WHERE task_type='J' AND records > 0
         AND day >= v_dc_from AND day <= v_today - 1
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


-- ── STEP 2 — the weekly aging email ─────────────────────────────────────────
--  Same {store_code, store_name} shape and same semantics as v1 (last p_days
--  FULL days, today excluded), but reads the rollup so it stays correct if the
--  window is ever widened past scan_record_retention_days or retention is
--  shortened. It ALSO checks live task_records, so a rollup outage can only
--  ever reduce false "missing" reports, never create one.
--
--  Boundary note: v1 bucketed on Europe/Dublin days, this uses UTC days — a
--  <=1h difference that only matters for a check logged between midnight and
--  01:00 IST, when stores are shut.
--
--  VERIFIED 2026-09-02: v1 and v2 both return the same 7 stores, zero
--  difference in either direction.
CREATE OR REPLACE FUNCTION public.stores_missing_dept_check_v2(p_days integer DEFAULT 7)
RETURNS TABLE(store_code text, store_name text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_from  date := v_today - GREATEST(1, p_days);
BEGIN
  RETURN QUERY
  SELECT s.store_code, s.store_name
  FROM stores s
  WHERE s.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM task_stats_daily d
       WHERE d.store_id = s.id AND d.task_type = 'J' AND d.records > 0
         AND d.day >= v_from AND d.day < v_today
    )
    AND NOT EXISTS (
      SELECT 1 FROM task_records tr
       WHERE tr.store_id = s.id AND tr.task_type = 'J'
         AND tr.created_at >= (v_from::timestamp  AT TIME ZONE 'UTC')
         AND tr.created_at <  (v_today::timestamp AT TIME ZONE 'UTC')
    )
  ORDER BY s.store_code;
END;
$function$;


-- ── STEP 3 — verify ─────────────────────────────────────────────────────────
-- Parity on a midnight-aligned 7-day range. Every pair must be equal.
WITH p AS (SELECT (((now() AT TIME ZONE 'UTC')::date - 6)::timestamp AT TIME ZONE 'UTC') f,
                  now() t),
v1 AS (SELECT dashboard_stats   ((SELECT f FROM p),(SELECT t FROM p),NULL)       AS j),
v2 AS (SELECT dashboard_stats_v2((SELECT f FROM p),(SELECT t FROM p),NULL,'day') AS j)
SELECT (SELECT j->'totals'->>'all'     FROM v1) AS v1_all,
       (SELECT j->'totals'->>'all'     FROM v2) AS v2_all,
       (SELECT j->'ho_totals'->>'all'  FROM v1) AS v1_ho,
       (SELECT j->'ho_totals'->>'all'  FROM v2) AS v2_ho,
       (SELECT j->'ops_totals'->>'all' FROM v1) AS v1_ops,
       (SELECT j->'ops_totals'->>'all' FROM v2) AS v2_ops;

-- Email parity. only_in_v1 and only_in_v2 must both be 0.
WITH a AS (SELECT store_code FROM stores_missing_dept_check(7)),
     b AS (SELECT store_code FROM stores_missing_dept_check_v2(7))
SELECT (SELECT count(*) FROM a) AS v1_missing,
       (SELECT count(*) FROM b) AS v2_missing,
       (SELECT count(*) FROM (SELECT store_code FROM a EXCEPT SELECT store_code FROM b) x) AS only_in_v1,
       (SELECT count(*) FROM (SELECT store_code FROM b EXCEPT SELECT store_code FROM a) y) AS only_in_v2;


-- ============================================================================
--  APPENDIX — dashboard_stats (v1) as deployed, dumped 2026-09-02.
--
--  Recorded here ONLY so the definition stops being untracked. v1 is left in
--  place and unchanged; this is the rollback target. Do not run this block —
--  it is already live.
-- ============================================================================
--
-- CREATE OR REPLACE FUNCTION public.dashboard_stats(
--   p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
--   p_store_ids uuid[] DEFAULT NULL)
--  RETURNS json LANGUAGE plpgsql STABLE
--  SET search_path TO 'public','pg_catalog' SET work_mem TO '32MB'
-- AS $function$
-- DECLARE result json;
-- BEGIN
--   WITH scoped AS (
--     SELECT id, task_type, store_id, product_code, product_barcode,
--            item_name, description, product_name_label, status, created_at
--     FROM task_records
--     WHERE (p_store_ids IS NULL OR store_id = ANY(p_store_ids))
--       AND (p_from IS NULL OR created_at >= p_from)
--       AND (p_to   IS NULL OR created_at <= p_to)
--       AND status <> 'cleared'
--   ),
--   totals AS (SELECT COUNT(*) AS "all",
--     COUNT(*) FILTER (WHERE status='pending')          AS pending,
--     COUNT(*) FILTER (WHERE status='completed')        AS completed,
--     COUNT(*) FILTER (WHERE status='no_change_needed') AS no_change_needed,
--     COUNT(*) FILTER (WHERE status='store_completed')  AS store_completed FROM scoped),
--   ho_totals AS (SELECT ... FROM scoped WHERE task_type NOT IN ('H','J','K')),
--   ops_totals AS (SELECT ... FROM scoped WHERE task_type IN ('H','J','K')),
--   by_task AS (SELECT s.task_type AS code, COALESCE(tt.name,s.task_type) AS name,
--     COUNT(*) AS count FROM scoped s LEFT JOIN task_types tt ON tt.code=s.task_type
--     GROUP BY s.task_type, tt.name ORDER BY COUNT(*) DESC),
--   by_store_type AS (SELECT s.store_id, s.task_type AS code,
--     COALESCE(tt.name,s.task_type) AS name, COUNT(*) AS count
--     FROM scoped s LEFT JOIN task_types tt ON tt.code=s.task_type
--     GROUP BY s.store_id, s.task_type, tt.name),
--   by_store AS (SELECT st.id, st.store_name, st.store_code,
--     SUM(bst.count)::bigint AS total,
--     json_agg(json_build_object('code',bst.code,'name',bst.name,'count',bst.count)
--              ORDER BY bst.count DESC) AS types
--     FROM by_store_type bst JOIN stores st ON st.id=bst.store_id
--     GROUP BY st.id, st.store_name, st.store_code ORDER BY SUM(bst.count) DESC),
--   by_day AS (   -- follows the selected range; no hardcoded cap
--     SELECT to_char(created_at::date,'YYYY-MM-DD') AS date, COUNT(*) AS count,
--       COUNT(*) FILTER (WHERE task_type NOT IN ('H','J','K')) AS ho_count,
--       COUNT(*) FILTER (WHERE task_type     IN ('H','J','K')) AS ops_count
--     FROM scoped GROUP BY created_at::date ORDER BY created_at::date),
--   recent AS (SELECT s.id, s.task_type, s.store_id,
--     COALESCE(st.store_name,'') AS store_name,
--     COALESCE(NULLIF(s.item_name,''), NULLIF(s.description,''),
--              NULLIF(s.product_name_label,''), NULLIF(s.product_code,''),
--              s.product_barcode,'') AS product, s.status, s.created_at
--     FROM scoped s LEFT JOIN stores st ON st.id=s.store_id
--     ORDER BY s.created_at DESC LIMIT 10)
--   SELECT json_build_object('totals',..., 'ho_totals',..., 'ops_totals',...,
--     'by_task_type',..., 'by_store',..., 'by_day',..., 'recent',...) INTO result;
--   RETURN result;
-- END;
-- $function$;
