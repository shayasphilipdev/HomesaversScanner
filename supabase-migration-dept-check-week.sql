-- Department Check coverage for a date range: who did one, how many records,
-- and how many distinct departments they covered.
--
-- ONE definition, two consumers:
--   * the Monday 09:00 weekly email (who missed LAST calendar week)
--   * the Dashboard's Department Check card (the selected range)
-- so the email and the screen can never disagree about what "did a Department
-- Check" means.
--
-- WHAT COUNTS AS A DEPARTMENT
-- details->>'item_group', which is what DeptScan.jsx and TaskJForm.jsx write for
-- every Task J record. Counted DISTINCT per store, so "9 departments" means nine
-- different ones were actually recorded -- not nine scans. Rows with no
-- item_group are counted as records but contribute no department, which is the
-- honest reading: the scan happened, it just cannot be attributed.
--
-- EVERY ACTIVE STORE IS RETURNED, including those with zero records. That is the
-- whole point of the weekly email -- a LEFT JOIN, not an inner one, because the
-- stores that did nothing produce no task_records rows to join to and would
-- otherwise silently vanish from a report about exactly them.
--
-- RETENTION TIMING, checked. A Monday 09:00 email about the previous Mon-Sun
-- reads data up to 8 days old. scan_record_retention_days is 14, so the records
-- are still in Postgres with ~6 days to spare. If that setting is ever taken
-- below 9 this report starts silently losing the oldest days of the week, so the
-- Settings page floor (10) is doing real work here.
--
-- source='test' rows are EXCLUDED. The test app writes into the same database,
-- and a report that tells management a store did its Department Check because
-- somebody exercised the test app is worse than no report.

CREATE OR REPLACE FUNCTION public.dept_check_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_store_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  store_id    uuid,
  store_code  text,
  store_name  text,
  records     bigint,
  departments bigint,
  first_at    timestamptz,
  last_at     timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT s.id,
         s.store_code,
         s.store_name,
         COUNT(t.id)                                        AS records,
         COUNT(DISTINCT NULLIF(t.details->>'item_group','')) AS departments,
         MIN(t.created_at)                                  AS first_at,
         MAX(t.created_at)                                  AS last_at
    FROM stores s
    LEFT JOIN task_records t
           ON t.store_id = s.id
          AND t.task_type = 'J'
          AND t.source IS DISTINCT FROM 'test'
          AND t.created_at >= p_from
          AND t.created_at <= p_to
   WHERE s.is_active
     AND (p_store_ids IS NULL OR s.id = ANY (p_store_ids))
   GROUP BY s.id, s.store_code, s.store_name
   ORDER BY COUNT(t.id) ASC, s.store_name ASC;
$function$;

COMMENT ON FUNCTION public.dept_check_summary IS
  'Per active store for a date range: Department Check (task_type J) record count '
  'and DISTINCT department count (details->>''item_group''). Stores with zero '
  'records are returned with records=0 -- that is the point. Excludes source=''test''. '
  'Ordered fewest-first so the stores that missed it come out on top.';

-- The report filters task_type='J' over a date range, which without this walks
-- the whole table. idx_tr_type_created is (task_type, created_at DESC) and
-- already serves it; store_id then groups from the heap. No new index.

-- ── Added 2026-09-25, after the first all-types archiver run hit a hard limit ──
--
-- The archiver marked records by PATCHing PostgREST in chunks of 100 ids, one
-- SUBREQUEST per chunk. A Cloudflare Worker on the free plan is capped at 50 per
-- invocation, and the 2026-09-25 01:30 run hit it exactly -- 8 pages x (1 GET +
-- 1 D1 batch) + 35 PATCHes = 51 -- stopping with 3,500 of ~50,000 due records
-- marked. 3,500 a night is BELOW the 8,000-10,000 a day the chain produces, so
-- the archiver could never have caught up and Postgres would have grown without
-- bound. Nothing was ever at risk of deletion, because the purge only removes
-- what is marked -- which is precisely why this could have gone unnoticed.
--
-- One RPC marks any number of ids for one subrequest.
CREATE OR REPLACE FUNCTION public.mark_archived_ids(p_ids uuid[], p_at timestamptz)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE task_records
     SET d1_copied_at = p_at
   WHERE id = ANY (p_ids)
     AND d1_copied_at IS NULL;   -- idempotent: a re-run must not restamp
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
