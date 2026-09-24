-- Make "in Pricing but not priced" a visible state.
--
-- THE PROBLEM
-- Sending a record to Pricing writes NOTHING to task_records. It inserts a
-- pricing_items row and, at [[route]].js:1815, clears pricing_removed_at -- that
-- is all. So of the four states the business wants on the report bubble:
--
--   1. In Pricing, not priced   -> INDISTINGUISHABLE from "never sent"
--   2. Priced                   -> priced_at IS NOT NULL, pricing_removed_at IS NULL
--   3. Priced, then removed     -> both set
--   4. Removed, never priced    -> pricing_removed_at set, priced_at NULL
--
-- only the first was unreachable. States 3 and 4 are already distinguishable
-- because DELETE /pricing/items/:id stamps pricing_removed_at and deliberately
-- does NOT clear priced_at.
--
-- WHY A COLUMN RATHER THAN A JOIN
-- The obvious alternative is EXISTS(SELECT 1 FROM pricing_items ...). It is
-- accurate but it cannot reach the grid: that list is served by PostgREST
-- (GET /task-records), which has no way to express a correlated subquery, so a
-- join would mean a second round trip per page or a view. A column is read by
-- the existing select list for free, and it also survives the thing a join
-- cannot -- a pricing_items row is HARD deleted on removal, so after that the
-- join has nothing left to find while the timestamps remain.
--
-- BACKFILL
-- Live pricing_items rows get their real created_at. Records that were priced
-- or removed had to have been sent at some point, so they are backfilled from
-- the earliest evidence available; that is an approximation of WHEN, never of
-- WHETHER, and it only affects rows whose state is already decided by
-- priced_at / pricing_removed_at. 67 records are affected in total today
-- (2 live, 52 priced-and-removed, 13 removed-never-priced).

ALTER TABLE public.task_records
  ADD COLUMN IF NOT EXISTS sent_to_pricing_at timestamptz;

COMMENT ON COLUMN public.task_records.sent_to_pricing_at IS
  'When this record was last copied to the Pricing page. Set by POST /pricing/items; '
  'NOT cleared on removal -- pricing_removed_at records that. Exists so the report '
  'bubble can show "in Pricing but not priced", which is otherwise indistinguishable '
  'from "never sent" once pricing_items is hard-deleted.';

-- Live items: the authoritative timestamp.
UPDATE public.task_records t
   SET sent_to_pricing_at = p.created_at
  FROM public.pricing_items p
 WHERE p.task_record_id = t.id
   AND t.sent_to_pricing_at IS NULL;

-- Historical: priced or removed implies it was sent. Earliest known evidence.
UPDATE public.task_records
   SET sent_to_pricing_at = LEAST(
         COALESCE(priced_at,           pricing_removed_at),
         COALESCE(pricing_removed_at,  priced_at))
 WHERE sent_to_pricing_at IS NULL
   AND (priced_at IS NOT NULL OR pricing_removed_at IS NOT NULL);

-- Partial: the overwhelming majority of records never touch Pricing, so this
-- indexes only the ones that did.
CREATE INDEX IF NOT EXISTS idx_tr_sent_to_pricing
  ON public.task_records (sent_to_pricing_at)
  WHERE sent_to_pricing_at IS NOT NULL;
