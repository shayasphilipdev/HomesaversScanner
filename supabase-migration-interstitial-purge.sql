-- Interstitial task-records purge (2026-09-30)
--
-- WHY
-- The archiver Worker runs twice a night (01:30 and 01:45 UTC), but BOTH landed
-- before the single 02:00 purge. So the 01:45 run re-read the exact window the
-- 01:30 run had already archived and marked -- observed in archive_runs as
-- `inserted 0, already_had 11000`: zero net progress. Effective throughput was
-- therefore ONE run's worth (~11,000 records/night), below the chain's daily
-- inflow (~15,000-19,000 Task J/day, 33k on a peak Monday), so task_records --
-- and Supabase usage -- grew without bound even though the archiver itself was
-- healthy.
--
-- This adds a purge at 01:40, BETWEEN the two archiver runs, so the second run
-- sees a fresh window and advances to the next ~11,000 instead of repeating the
-- first. Nightly flow becomes:
--   01:30 archive+mark -> 01:40 purge -> 01:45 archive+mark -> 02:00 purge
-- i.e. ~22,000 records/night, which clears the backlog and outpaces average
-- inflow. It does NOT touch the archiver's per-run subrequest budget.
--
-- SAFETY: identical guard to the 02:00 purge -- purge_old_task_records() only
-- deletes rows with d1_copied_at IS NOT NULL (confirmed already copied to the
-- D1 archive). Nothing unarchived is ever removed by either purge.
--
-- Applied live via cron.schedule() on 2026-09-30 (jobid 9). This file records it
-- so a rebuilt database reproduces the schedule.

SELECT cron.schedule(
  'purge-old-task-records-interstitial',
  '40 1 * * *',
  'SELECT public.purge_old_task_records()'
);

-- Existing companion job, unchanged, for reference:
--   jobid 1  'purge-old-task-records'  '0 2 * * *'  SELECT public.purge_old_task_records()
