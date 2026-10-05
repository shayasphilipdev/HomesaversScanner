-- Device-log retention window (2026-10-05)
--
-- WHY
-- device_log_events (the "scan doctor" diagnostic log, now in Cloudflare D1) had
-- NO retention -- nothing ever deleted from it, so it grew forever. Combined
-- with its write amplification it was the single biggest consumer of D1's
-- 100,000 rows-written/day free limit (see the 2026-10-05 D1 write-limit work:
-- its three indexes were dropped the same day). A bounded window caps both the
-- table size and the ongoing delete pressure.
--
-- WHAT
-- Admin-editable setting dept-style: device_log_retention_days (default 21),
-- shown in Settings -> Retention and validated server-side (min 1, max 365).
-- The nightly archiver Worker (workers/archiver/src/index.js) reads it from
-- app_settings and deletes device_log_events rows whose received_at_ms is older
-- than the window, chunked, inside its existing subrequest budget. The log lives
-- only in D1, so the deletion happens there, not in Postgres -- this migration
-- only seeds the knob.
--
-- Nothing is deleted immediately: device_log_events only started filling on
-- 2026-09-30, so the first rows do not reach 21 days old until ~2026-10-21.

INSERT INTO app_settings (key, value, updated_at)
VALUES ('device_log_retention_days', '21', now())
ON CONFLICT (key) DO NOTHING;
