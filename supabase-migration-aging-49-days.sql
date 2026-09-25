-- Aging report over the full 7-week retention window (2026-09-25)
--
-- WHY
-- Until the 7-week change, an unanswered A-F query was purge-EXEMPT: it stayed
-- in Postgres forever, so /reports/aging could read one table and see the whole
-- backlog. That exemption is gone. Postgres now holds 14 days
-- (scan_record_retention_days) and the next 35 (archive_retention_days) live in
-- Cloudflare D1 -- 49 days in total. A report that reads only Postgres would
-- therefore show a backlog that silently ENDS at 14 days and call it "oldest",
-- which is worse than showing nothing: the number would look reassuring
-- precisely because the old records had been moved out from under it.
--
-- The Worker now unions Postgres with D1. This migration supplies the two
-- things that union needs.
--
-- 1. `id` in the payload.
--    A record is copied to D1 by the 01:30 archiver and removed from Postgres
--    by the pg_cron purge -- two separate jobs. Between them the SAME record
--    exists in both databases, so the union has to dedupe, and a uuid is the
--    only key that is guaranteed unique. Without it a record would be counted
--    twice every night for the length of that window.
--
-- 2. NO source filter -- test-app records COUNT.
--    An earlier revision of this file excluded source='test' on the reasoning
--    that test scans should not reach a management report. The owner overruled
--    that on 2026-09-25: "all the records even if it through test app is fine".
--    Test-app scans are real work done by real staff on real stock.
--
--    So the exclusion was removed from aging_report_records AND from the D1
--    half AND from dept_check_summary / dept_check_department_breakdown, which
--    had carried it since the Monday email was built. Filtering one half only
--    would make the 14-day Postgres/D1 boundary visible as a step in the
--    numbers -- the two stores of the same record must be filtered identically.
--
--    MEASURED impact of including test, last complete week:
--      records      60,626 -> 62,550   (+3.2%)
--      stores that flip in or out of the "did not do a check" list:  0
--    Pending A-F today: 19 rows, all live-app, so the aging report itself is
--    unchanged either way.
--
-- SAFE TO RE-RUN. The signature (p_task_types text[]) is UNCHANGED, so this is
-- a true replacement and not a new overload -- PostgREST refuses to dispatch to
-- an overloaded name (PGRST203), which is how the duplicate-keys function broke
-- earlier in this project.

CREATE OR REPLACE FUNCTION public.aging_report_records(p_task_types text[])
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(json_agg(
    json_build_object(
      'id',           tr.id,
      'task_type',    tr.task_type,
      'store_code',   COALESCE(s.store_code, ''),
      'store_name',   COALESCE(s.store_name, '(unknown store)'),
      'product_code', COALESCE(NULLIF(tr.product_code,''), tr.product_barcode, ''),
      'description',  COALESCE(NULLIF(tr.product_name_label,''), tr.description, ''),
      'quantity',     tr.quantity,
      'created_at',   tr.created_at
    ) ORDER BY tr.created_at ASC
  ), '[]'::json)
  FROM task_records tr
  LEFT JOIN stores s ON s.id = tr.store_id
  WHERE tr.status = 'pending'
    AND tr.task_type = ANY(p_task_types)
    AND tr.marked_for_deletion IS DISTINCT FROM true
$function$;

-- Verification: every row carries an id, and no overload was created.
SELECT count(*) AS overloads_must_be_1
  FROM pg_proc WHERE proname = 'aging_report_records';

SELECT count(*) FILTER (WHERE r->>'id' IS NULL) AS rows_missing_id_must_be_0,
       count(*)                                  AS rows
  FROM json_array_elements(
         aging_report_records(ARRAY['A','B','C','D','E','F'])) r;
