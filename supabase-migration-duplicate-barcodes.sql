-- Highlight task records that share a barcode with another record of the SAME task.
--
-- WHY AN RPC AND NOT A CLIENT-SIDE CHECK
-- The report grid pages 200 rows at a time and appends on "Load more"
-- (client/src/pages/Reports.jsx), so a duplicate check done in the browser only
-- ever sees the pages already loaded. A record whose twin sits on page 4 would
-- render as unique -- which is wrong in exactly the case anyone cares about.
-- The owner asked for the highlight to consider every matching record, so the
-- grouping has to happen in Postgres over the whole filtered set.
--
-- WHY A SEPARATE CALL AND NOT PART OF THE GRID QUERY
-- GET /task-records is served by PostgREST and cannot express GROUP BY/HAVING,
-- and the Excel path is a CPU-tuned RPC that was already tripping the Worker
-- budget once. Folding an aggregate over ~171,000 rows into either would risk a
-- report that is slower or, worse, fails. This runs on its own endpoint, in
-- parallel, and if it fails the grid still renders -- the rows simply are not
-- highlighted.
--
-- SCOPE: ACROSS ALL STORES, by owner's decision. Measured before building:
--
--   task type            rows      dup across stores   dup same store
--   J Department Check   171,303   94.4%               25.5%
--   K Price Check          3,962   78.0%               77.5%
--   B Non-Scans              119   27.7%               13.4%
--   C Wrong Prices            66   28.8%                9.1%
--   G Promotion Error         30   56.7%               20.0%
--
-- For the reports back office actually runs this is the right call -- their
-- default task-type filter excludes J/K/H/M, leaving the 28-57% band where a
-- shared barcode genuinely means two stores hit the same problem. It degenerates
-- only when the report is filtered TO Department Check, where nearly every row
-- lights up because 55 stores legitimately scan the same products. That is a
-- property of the data, not a bug, and p_limit below stops it becoming a
-- performance problem.
--
-- The filter parameters mirror GET /task-records in functions/api/[[route]].js
-- exactly -- store scope, task types, statuses (with the neq.cleared default),
-- item/barcode status, marked_for_deletion and the created_at range. If a filter
-- is added there it must be added here, or the highlight stops matching what is
-- on screen.

-- SIGNATURE NOTE. CREATE OR REPLACE only replaces when the signature matches;
-- adding a parameter creates an OVERLOAD. PostgREST dispatches RPCs by named
-- arguments, so more than one candidate makes EVERY call fail with PGRST203
-- ("could not choose the best candidate function"). That is invisible to a SQL
-- client, which resolves positionally without complaint -- it only shows up when
-- the RPC is called over REST, which is how the app calls it. These DROPs clear
-- the two earlier signatures this function passed through during development.
DROP FUNCTION IF EXISTS public.task_record_duplicate_keys(
  uuid[], text[], text[], boolean, text[], text[], timestamptz, timestamptz, integer);
DROP FUNCTION IF EXISTS public.task_record_duplicate_keys(
  uuid[], text[], text[], boolean, text[], text[], timestamptz, timestamptz, integer, text[]);

-- p_barcodes narrows WHICH barcodes are asked about, without narrowing what is
-- COUNTED: the grouping still runs over the whole filtered set, so a row is
-- flagged correctly even when its twin is on a page the browser has not loaded,
-- but the answer is never larger than the page asking. Without it, "Department
-- Check over 30 days" returns 19,197 keys (~290 KB) on every report run and an
-- unfiltered report hits the cap and silently under-reports. With it, ~49.
--
-- p_pricing_states keeps the highlight matching the grid when the report is
-- filtered by Pricing state. Its CASE is the single SQL definition of the four
-- states and must stay in step with pricingStateId() in
-- client/src/lib/pricingState.js and the or= filter in GET /task-records.
CREATE OR REPLACE FUNCTION public.task_record_duplicate_keys(
  p_store_ids        uuid[]      DEFAULT NULL,
  p_task_types       text[]      DEFAULT NULL,
  p_statuses         text[]      DEFAULT NULL,
  p_include_cleared  boolean     DEFAULT false,
  p_item_status      text[]      DEFAULT NULL,
  p_barcode_status   text[]      DEFAULT NULL,
  p_from             timestamptz DEFAULT NULL,
  p_to               timestamptz DEFAULT NULL,
  p_limit            int         DEFAULT 20000,
  p_barcodes         text[]      DEFAULT NULL,
  p_pricing_states   text[]      DEFAULT NULL
)
RETURNS TABLE (k text)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT tr.task_type || '|' || tr.barcode_no
    FROM task_records tr
   WHERE tr.barcode_no IS NOT NULL
     AND tr.barcode_no <> ''
     AND (p_barcodes IS NULL OR tr.barcode_no = ANY (p_barcodes))
     AND tr.marked_for_deletion IS DISTINCT FROM true
     AND (p_store_ids  IS NULL OR tr.store_id  = ANY (p_store_ids))
     AND (p_task_types IS NULL OR tr.task_type = ANY (p_task_types))
     AND (
           CASE
             WHEN p_statuses IS NOT NULL THEN tr.status = ANY (p_statuses)
             WHEN p_include_cleared      THEN true
             ELSE tr.status <> 'cleared'
           END
         )
     -- ILIKE for both the one-value and many-value cases. The grid uses ilike
     -- for a single value and an exact IN for several, because the product sync
     -- has historically written both cases; ILIKE here is the forgiving side of
     -- that inconsistency, so the highlight set can never be SMALLER than what
     -- the grid shows.
     AND (p_item_status    IS NULL OR tr.item_status    ILIKE ANY (p_item_status))
     AND (p_barcode_status IS NULL OR tr.barcode_status ILIKE ANY (p_barcode_status))
     AND (p_from IS NULL OR tr.created_at >= p_from)
     AND (p_to   IS NULL OR tr.created_at <= p_to)
     AND (p_pricing_states IS NULL OR (CASE
            WHEN tr.pricing_removed_at IS NOT NULL AND tr.priced_at IS NOT NULL THEN 'priced_removed'
            WHEN tr.pricing_removed_at IS NOT NULL                              THEN 'removed_unpriced'
            WHEN tr.priced_at          IS NOT NULL                              THEN 'priced'
            WHEN tr.sent_to_pricing_at IS NOT NULL                              THEN 'in_pricing'
            ELSE 'none'
          END) = ANY (p_pricing_states))
   GROUP BY tr.task_type, tr.barcode_no
  HAVING COUNT(*) > 1
   LIMIT GREATEST(1, p_limit);
$function$;

COMMENT ON FUNCTION public.task_record_duplicate_keys IS
  'Returns "task_type|barcode_no" keys that occur more than once within the same '
  'filter the report grid is showing, across all stores. Used to highlight '
  'duplicate records in Reports and Pricing. Filters mirror GET /task-records.';

-- The grouping key. Without this the HAVING COUNT(*) > 1 is a full scan of
-- task_records on every report run.
CREATE INDEX IF NOT EXISTS idx_tr_type_barcode
  ON public.task_records (task_type, barcode_no)
  WHERE barcode_no IS NOT NULL AND barcode_no <> '';
