-- ============================================================================
--  Phase 5 — indexes for the expiry queries and the retention purge
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database (live and
--  test share one Supabase project).
--
--  ⚠ RUN EACH "CREATE INDEX CONCURRENTLY" STATEMENT ON ITS OWN.
--  CONCURRENTLY cannot run inside a transaction block. If the editor wraps the
--  whole script in one transaction you will get:
--      ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--  Select a single statement and run it, then the next. CONCURRENTLY is used
--  deliberately: task_records is ~325k rows and a plain CREATE INDEX takes a
--  write lock, which would stall scanning in every store while it builds.
--
--  All three are additive. Nothing breaks if they are not applied — the queries
--  simply keep using less selective plans.
-- ============================================================================


-- ── 1. Expiry Overview, source 1 ────────────────────────────────────────────
-- /reports/expiry-overview filters task_records by
--     task_type = 'M' AND created_at BETWEEN … AND store_id IN (…)
--
-- ⚠ READ THIS BEFORE APPLYING — this index was tried and DELIBERATELY REVERTED
-- before. The 2026-08-12 index audit (Project_Status.MD) EXPLAIN-tested exactly
-- this composite and reverted it, on the reasoning that "the 14-day retention
-- keeps every real date window small enough that idx_tr_created_at always wins,
-- and rare-type wide scans use idx_tr_task_type".
--
-- What changed: Task M records are now kept for 180 days, not 14 (see
-- supabase-migration-expiry-retention.sql). M is the one task type whose rows
-- accumulate for six months across 55 stores, so the premise behind that revert
-- no longer holds for this query — a date window over M can be far larger than
-- any window the audit measured, and idx_tr_task_type stops being selective
-- once M is no longer rare.
--
-- If the 180-day retention is ever reduced back toward the others, revisit
-- this: the audit's original conclusion would apply again and the index could
-- be dropped. It is NOT needed today for correctness — only for the report's
-- cost as sweep data grows. Skip it if you would rather re-measure first.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tr_type_created
  ON task_records (task_type, created_at DESC);


-- ── 2. Expiry Overview, source 2 + the store task list ──────────────────────
-- store_task_instances is filtered by store_id + due_date (the report) and by
-- store_id + period/status (the task list). Existing indexes are
-- (store_id, status) and (due_date) separately, so a store+date-range query
-- walks one and filters the rest by hand.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sti_store_due
  ON store_task_instances (store_id, due_date);


-- ── 3. The retention purge ──────────────────────────────────────────────────
-- Both the login-triggered cleanup and the admin Maintenance button select
--     status IN ('cleared','store_completed') AND updated_at < cutoff
-- updated_at has no index at all, so that is a scan of the whole
-- cleared/store_completed slice of a 325k-row table on every run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tr_status_updated
  ON task_records (status, updated_at);


-- ── Verify ──────────────────────────────────────────────────────────────────
-- All three should be listed, and valid (indisvalid = true). A CONCURRENTLY
-- build that was interrupted leaves an INVALID index behind — drop and rebuild
-- it if indisvalid comes back false.

SELECT i.relname AS index_name,
       t.relname AS table_name,
       x.indisvalid,
       pg_size_pretty(pg_relation_size(i.oid)) AS size
FROM   pg_class i
JOIN   pg_index x ON x.indexrelid = i.oid
JOIN   pg_class t ON t.oid = x.indrelid
WHERE  i.relname IN ('idx_tr_type_created', 'idx_sti_store_due', 'idx_tr_status_updated')
ORDER  BY i.relname;
