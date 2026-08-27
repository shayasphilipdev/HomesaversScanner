-- ============================================================================
--  Reopen a mis-completed store task
--
--  RUN THIS BEFORE deploying the reopen feature.
--
--  The app adds reopened_at / reopened_by / reopen_count to the SELECT used by
--  /store-tasks/today. PostgREST rejects the WHOLE query with a 400 if a
--  selected column does not exist, which would take down the task list for
--  every store. Apply this first, confirm STEP 2 returns the columns, then
--  deploy.
--
--  Safe to run at any time: the columns are additive, nullable/defaulted, and
--  nothing reads them until the new code ships. Run once in the Supabase SQL
--  Editor (live and test share one Supabase project).
-- ============================================================================
--
--  WHY
--  ---
--  store_task_instances has only a /complete transition — there is no way back.
--  Because UNIQUE (template_id, store_id, period_key) means the instance cannot
--  be regenerated either, one early tap of "Mark complete" locks that period for
--  everyone including HQ. On an expiry sweep that can discard a part-finished
--  aisle with no recovery.
--
--  Store tasks have no audit ledger, and task_record_events cannot be reused
--  (it has a FK to task_records(id) and a CHECK on to_status), so these columns
--  are the audit trail for a reopen.
-- ============================================================================


-- ── STEP 1 — add the columns ────────────────────────────────────────────────

ALTER TABLE store_task_instances
  ADD COLUMN IF NOT EXISTS reopened_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopen_reason text;


-- ── STEP 2 — verify ─────────────────────────────────────────────────────────
-- Must list all four columns before the app is deployed.

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'store_task_instances'
  AND  column_name IN ('reopened_at', 'reopened_by', 'reopen_count', 'reopen_reason')
ORDER  BY column_name;
