-- ── Fix silent non-compliance in Store Tasks ─────────────────────────────────
-- Before this: a store_task_instances row only came into existence when
-- someone opened that store's Store Tasks page — GET /store-tasks/today
-- lazily calls ensureInstancesExist() (functions/api/[[route]].js) for
-- whichever ONE store is being viewed. A store nobody opened had literally
-- no rows for that day, so every compliance report showed it as "no data"
-- rather than "non-compliant" — the disengaged stores that most need
-- flagging were invisible to the very stats meant to flag them. Worse, the
-- "mark overdue pending -> missed" sweep (M7) ran inside that same
-- single-store branch, so it too only ever touched whichever one store
-- happened to be open that day.
--
-- Verified against live data before writing this:
--   - 981 of 1,653 expected instances for today did not exist yet.
--   - 4,971 pending rows across all stores have an already-ended period and
--     would flip to 'missed' on the first run (spot-checked a sample —
--     genuine ended periods, e.g. yesterday's daily instances, not a
--     period_key format mismatch).
--
-- Fix: two SQL functions replicating ensureInstancesExist()/the M7 sweep
-- exactly, run nightly via pg_cron for EVERY active store — not a
-- Cloudflare-side scheduled call to /store-tasks/generate, which loops
-- per-store (templates + existing-check + insert = several subrequests
-- each) and would blow the Worker's 50-subrequest cap at 55+ stores. A
-- pg_cron job runs inside Postgres itself, so that cap never applies.
--
-- The lazy JS path is left exactly as-is — this is additive, a same-day
-- safety net for a template or store added after the nightly run, not a
-- replacement.

CREATE OR REPLACE FUNCTION public.generate_store_task_instances(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_inserted int;
BEGIN
  WITH candidates AS (
    SELECT
      t.id AS template_id,
      s.id AS store_id,
      CASE t.frequency
        WHEN 'daily'    THEN to_char(p_date, 'YYYY-MM-DD')
        WHEN 'weekly'   THEN to_char(p_date, 'IYYY-"W"IW')
        WHEN 'monthly'  THEN to_char(p_date, 'YYYY-MM')
        WHEN 'yearly'   THEN to_char(p_date, 'YYYY')
        WHEN 'once_off' THEN 'once_' || t.id::text
        ELSE to_char(p_date, 'YYYY-MM-DD')
      END AS period_key
    FROM store_task_templates t
    CROSS JOIN stores s
    WHERE t.is_active = true
      AND s.is_active = true
      AND (
        t.applies_to = 'all'
        OR (t.applies_to = 'area'   AND s.area_id = ANY(t.area_ids))
        OR (t.applies_to IN ('stores', 'one') AND s.id = ANY(t.store_ids))
      )
      AND (t.start_at IS NULL OR t.start_at <= p_date)
      AND (t.end_at   IS NULL OR t.end_at   >= p_date)
  )
  INSERT INTO store_task_instances (template_id, store_id, period_key, due_date, status)
  SELECT template_id, store_id, period_key, p_date, 'pending'
  FROM candidates
  ON CONFLICT (template_id, store_id, period_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_missed_store_task_instances(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_updated int;
  v_keys    text[];
BEGIN
  -- The four possible "current" period-key spellings for p_date, one per
  -- frequency. A pending row whose period_key matches none of these (and
  -- isn't a once-off, which never expires this way) had its period end
  -- before today, so it's overdue.
  v_keys := ARRAY[
    to_char(p_date, 'YYYY-MM-DD'),
    to_char(p_date, 'IYYY-"W"IW'),
    to_char(p_date, 'YYYY-MM'),
    to_char(p_date, 'YYYY')
  ];

  UPDATE store_task_instances
  SET status = 'missed'
  WHERE status = 'pending'
    AND due_date >= (p_date - INTERVAL '90 days')::date  -- same bound as the JS sweep: bulk-safe, doesn't touch ancient backlog
    AND NOT (period_key = ANY(v_keys))
    AND period_key NOT LIKE 'once%';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

-- Idempotent scheduling: unschedule-then-schedule so re-running this file
-- (or a future edit to the cron expression) doesn't error on a duplicate
-- jobname. Runs ahead of the existing 1-2am retention jobs (purge-old-
-- task-records at 02:00, the two VACUUMs at 02:30/02:40) — see cron.job.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'generate-store-task-instances';
SELECT cron.schedule(
  'generate-store-task-instances', '0 1 * * *',
  $$SELECT public.generate_store_task_instances();$$
);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mark-missed-store-task-instances';
SELECT cron.schedule(
  'mark-missed-store-task-instances', '5 1 * * *',
  $$SELECT public.mark_missed_store_task_instances();$$
);

-- ── Verify ────────────────────────────────────────────────────────────────
SELECT 'generate_store_task_instances' AS fn, generate_store_task_instances() IS NOT NULL AS ok
UNION ALL
SELECT 'mark_missed_store_task_instances', mark_missed_store_task_instances() IS NOT NULL;
