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
-- 2. `source <> 'test'`.
--    This is a BEHAVIOUR CHANGE and is deliberate. The old filter had no source
--    clause, which was harmless while the report read Postgres only -- there
--    are no test-app A-F pending rows there. D1 is a different matter: it
--    already holds 272 rows carrying source='test', because one archive serves
--    both apps. Leaving the clause off would have let test-app scans reach a
--    report that goes to Homesavers management. Applying it to BOTH halves
--    keeps the two sources telling the same story, and matches what
--    dept_check_summary() already does for the Monday email.
--    Rows affected today: zero (all 19 pending A-F rows are live-app).
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
    AND tr.source IS DISTINCT FROM 'test'
$function$;

-- Verification: every row carries an id, and no overload was created.
SELECT count(*) AS overloads_must_be_1
  FROM pg_proc WHERE proname = 'aging_report_records';

SELECT count(*) FILTER (WHERE r->>'id' IS NULL) AS rows_missing_id_must_be_0,
       count(*)                                  AS rows
  FROM json_array_elements(
         aging_report_records(ARRAY['A','B','C','D','E','F'])) r;
