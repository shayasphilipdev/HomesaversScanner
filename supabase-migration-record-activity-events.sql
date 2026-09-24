-- Let the record History show ALL changes, not just status transitions.
--
-- WHAT IT SHOWS TODAY
-- task_record_events is a status ledger and nothing else. Five paths write to
-- it (create, PATCH status change, bulk review, bulk clear, reverse) and every
-- other mutation of a record is invisible: review-notes edits, photos, send to
-- Pricing, priced, removed from Pricing, messages posted, threads resolved.
--
-- WHY IT CANNOT SHOW MORE WITHOUT THIS
--   to_status text NOT NULL CHECK (to_status = ANY (ARRAY[...5 statuses...]))
-- There is no event_type column, NULL is rejected, and no other value passes
-- the CHECK -- so a non-status event is physically unstorable. The table can
-- only represent a status transition.
--
-- THE TRAP THIS AVOIDS
-- The obvious workaround -- reuse the record's CURRENT status as to_status for
-- a pricing or note event -- silently breaks permissions. Both
-- functions/api/[[route]].js (reverse-status) and
-- client/src/components/RecordDetailModal.jsx decide who may reverse a status
-- by finding the most recent event whose to_status equals the record's current
-- status and comparing its author to the session. A pricing event stamped with
-- the current status would make the person who priced it -- not the reviewer who
-- set it -- the only non-admin allowed to reverse. That is a permission change
-- disguised as a display change, so it is not an option.
--
-- HOW THIS IS SHAPED
-- event_type defaults to 'status', so every existing row and all five existing
-- writers are untouched and keep their meaning. to_status becomes nullable, and
-- the CHECK now only constrains rows that claim to be status transitions:
--
--   (event_type <> 'status') OR (to_status = ANY (ARRAY[...]))
--
-- field / old_value / new_value carry what actually changed for the new kinds.
--
-- SEQUENCING. The two reverse-status gates MUST be narrowed to
-- event_type = 'status' in the same deploy that adds any new writer. This
-- migration alone is safe to apply ahead of the code: until something writes a
-- non-status row, every row still has event_type 'status' and both gates behave
-- exactly as before.
--
-- VOLUME. Task J alone accounts for 175,003 of 176,195 event rows at ~1.07
-- events per record. The new event kinds attach to head-office activity
-- (pricing, notes, messages), which is a few hundred records, not the scan
-- volume -- so this does not meaningfully change the size of a table that is
-- already destroyed by ON DELETE CASCADE with the record.

ALTER TABLE public.task_record_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'status',
  ADD COLUMN IF NOT EXISTS field      text,
  ADD COLUMN IF NOT EXISTS old_value  text,
  ADD COLUMN IF NOT EXISTS new_value  text;

ALTER TABLE public.task_record_events
  ALTER COLUMN to_status DROP NOT NULL;

ALTER TABLE public.task_record_events
  DROP CONSTRAINT IF EXISTS task_record_events_status_chk;

-- NOTE THE `to_status IS NOT NULL`. A CHECK passes when it evaluates to NULL,
-- not only when TRUE. Written as `event_type <> 'status' OR to_status = ANY(...)`
-- a status row with to_status NULL gives `NULL = ANY(...)` -> NULL -> accepted,
-- and since the column has just lost its NOT NULL there is nothing else to stop
-- it. That row would render as "— → " with nothing after the arrow and be
-- invisible to the reverse-status gate. Caught by a BEGIN/ROLLBACK harness that
-- tried to insert one.
ALTER TABLE public.task_record_events
  ADD CONSTRAINT task_record_events_status_chk
  CHECK (
    event_type <> 'status'
    OR (to_status IS NOT NULL
        AND to_status = ANY (ARRAY['pending','completed','no_change_needed','store_completed','cleared']))
  );

-- Keeps the vocabulary closed: a typo'd event_type is rejected rather than
-- quietly creating a kind the renderer has never heard of and will not label.
ALTER TABLE public.task_record_events
  DROP CONSTRAINT IF EXISTS task_record_events_kind_chk;

ALTER TABLE public.task_record_events
  ADD CONSTRAINT task_record_events_kind_chk
  CHECK (event_type = ANY (ARRAY[
    'status',            -- a status transition (everything that exists today)
    'created',           -- reserved: creation currently logs as a status row
    'note',              -- back-office review_notes edited
    'pricing_sent',      -- copied to the Pricing page
    'pricing_priced',    -- a price was saved
    'pricing_removed',   -- removed from the Pricing page
    'message',           -- a message was posted on the record
    'message_resolved'   -- the message thread was resolved / reopened
  ]));

COMMENT ON COLUMN public.task_record_events.event_type IS
  'What kind of change this row records. ''status'' is the original behaviour and '
  'the default, so existing rows and writers are unchanged. The reverse-status '
  'permission gates in the API and RecordDetailModal must filter on '
  'event_type = ''status'' -- they pick "the last event whose to_status equals the '
  'record''s status" to decide who may reverse, and a non-status row matching '
  'that would hand the right to the wrong person.';

-- The History panel reads one record's events in time order; the existing
-- idx_tre_record (record_id, at) already serves that and needs no change.
