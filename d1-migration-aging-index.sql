-- D1 (homesavers-archive): partial index for the aging report.
-- APPLIED 2026-11-26 (read 675,543 rows once to build; wrote ~nothing).
--
-- Why: GET /api/reports/aging asks the archive for pending A-F queries from the
-- last 49 days. With only the primary key on created_at_ms that range-scanned
-- every archived record in the window (~800k rows per call). Three test runs
-- plus other report testing on 2026-11-25 used up the 5,000,000 rows-read/day
-- allowance and D1 reads were blocked until 00:00 UTC.
--
-- Partial, not a plain index: a plain (status, task_type, created_at_ms) index
-- would have written one entry per archived row (~700k) against the
-- 100,000 rows-written/day allowance. This one only holds the rows the report
-- wants, which are few (0 at creation).
--
-- The query MUST repeat these literals exactly (no "?" for status/task_type),
-- or SQLite cannot prove the partial index applies. See /reports/aging in
-- functions/api/[[route]].js.

CREATE INDEX IF NOT EXISTS idx_archive_pending_af
  ON task_record_archive (created_at_ms)
  WHERE status = 'pending' AND task_type IN ('A','B','C','D','E','F');
