-- ============================================================================
--  Device activity log — server-side mirror ("scan doctor")
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database.
-- ============================================================================
--
--  WHY
--  ---
--  client/src/lib/deviceLog.js already keeps a local, per-device trail of
--  save-ok / save-queued-offline / save-failed / sync / online / offline
--  events (see its own header comment) — built exactly for "we scanned it and
--  it's gone" reports. It was local-only: the only way to read it was
--  physically opening the Sync page on that one device. For a store with no
--  one on site who can do that, the log might as well not exist.
--
--  This gives it a server-side mirror. The device keeps writing to
--  localStorage exactly as before (that stays the fast, always-available
--  source of truth) and additionally best-effort uploads each event here,
--  tagged with a stable per-browser device_id (client/src/lib/deviceId.js) —
--  so "which specific gun is queuing scans, for which department, at which
--  store" becomes a query against this table instead of a phone call asking
--  someone at the till to read a screen.
--
--  Deliberately NOT authoritative and NOT another outbox: a lost upload here
--  loses a diagnostic data point, never a scan. The real task_records save
--  (or its outbox queue entry) already happened by the time this fires.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.device_log_events (
  id          bigserial   PRIMARY KEY,
  device_id   text        NOT NULL,
  user_id     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  store_id    uuid        REFERENCES public.stores(id) ON DELETE SET NULL,
  event_type  text        NOT NULL,
  detail      jsonb,
  client_at   timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- "Everything from this device, in order" and "everything of this kind
-- recently, chain-wide" are the two questions this exists to answer.
CREATE INDEX IF NOT EXISTS idx_dle_device_time ON public.device_log_events (device_id, client_at DESC);
CREATE INDEX IF NOT EXISTS idx_dle_type_time   ON public.device_log_events (event_type, client_at DESC);
CREATE INDEX IF NOT EXISTS idx_dle_store_time  ON public.device_log_events (store_id, client_at DESC);

-- No RLS anywhere else in this project; mirror that. INSERT for the upload,
-- SELECT for querying it back (admin reporting, a future viewer page).
GRANT SELECT, INSERT ON public.device_log_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.device_log_events_id_seq TO anon, authenticated;

-- Diagnostics for a fortnight is plenty (matches deviceLog.js's own MAX_AGE)
-- and keeps this table from growing without bound. Run by hand for now;
-- fold into the existing nightly cleanup if this earns a permanent place.
COMMENT ON TABLE public.device_log_events IS
  'Server-side mirror of client/src/lib/deviceLog.js. Not authoritative -- '
  'diagnostics only. Prune rows older than ~14 days periodically.';
