-- Set by the D1 archiver once a record is confirmed written to the archive.
-- purge_old_task_records() then refuses to delete a Task J record that is not
-- marked -- see supabase-migration-purge-guard-archived.sql.
--
-- Nullable with no default, so this is a metadata-only change: no table rewrite
-- and no lock beyond the catalog update, on a 167k-row table.
--
-- Safe against the stats triggers. trg_task_stats_capture_update early-returns
-- unless status or the photo columns change (verified in its body), so stamping
-- this column on a three-week-old row does NOT rewrite that day's
-- task_stats_daily counts -- which would otherwise have silently shrunk a
-- historical dashboard bar.
ALTER TABLE public.task_records
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.task_records.archived_at IS
  'When the Cloudflare D1 archiver confirmed this record was written to the archive. Only Task J is archived; NULL for every other task type, and for J records not yet moved. purge_old_task_records() will not delete a J record while this is NULL.';
