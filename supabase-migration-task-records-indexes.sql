-- task_records indexing for the daily store paths (HO tasks, Department Check).
--
-- The single most expensive statement in pg_stat_statements was a store's own
-- record list, run after nearly every scan (332,911 calls, 42 ms mean):
--   WHERE store_id = $1 AND task_type = $2 AND status <> $3
--     AND marked_for_deletion <> $4 ORDER BY created_at DESC LIMIT/OFFSET
-- plus an exact count over the same filter. With no (store_id, task_type)
-- index the count bitmap-scanned the store's whole heap (~1,000 blocks).
--
-- CONCURRENTLY statements cannot run inside a transaction: run them one at a
-- time (e.g. in the SQL editor), not as a single migration.
--
-- Status 2026-10-27: the index is applied (and a one-off VACUUM run).
-- NOT yet applied, awaiting approval: the four DROPs and the nightly
-- vacuum-task-records-visibility job below.

create index concurrently if not exists idx_tr_store_type_created
  on public.task_records (store_id, task_type, created_at desc)
  include (status, marked_for_deletion);

-- Exact prefixes of existing composite indexes, so the planner can use the
-- composite for anything these served. Fewer indexes = less work on every
-- Department Check insert (task_records carried 17).
drop index concurrently if exists public.idx_tr_store_id;     -- (store_id)   ⊂ idx_tr_store_date (store_id, created_at)
drop index concurrently if exists public.idx_tr_task_type;    -- (task_type)  ⊂ idx_tr_type_created (task_type, created_at desc)
drop index concurrently if exists public.idx_tr_status;       -- (status)     ⊂ idx_tr_status_updated (status, updated_at)
drop index concurrently if exists public.idx_tr_created_at;   -- (created_at) ⊂ idx_tr_created_at_id (created_at, id)

-- The nightly VACUUM (FULL) at 02:30 rewrites the table and leaves the
-- visibility map empty (relallvisible = 0), which stops index-only scans --
-- the whole point of the INCLUDE columns above -- for the rest of the day.
-- A plain VACUUM straight after it marks the pages all-visible again.
select cron.schedule('vacuum-task-records-visibility', '35 2 * * *',
                     $$vacuum (analyze) public.task_records$$);
