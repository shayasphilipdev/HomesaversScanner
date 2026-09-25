-- ============================================================================
--  Record assignment — hand a task_records row to a colleague
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database.
--  (Applied live 2026-09-25 via the apply_migration MCP tool under the name
--  "record_assignment" -- this file is the tracked copy.)
-- ============================================================================
--
--  WHY
--  ---
--  Back-office reviewers split up work by hand today (Slack, a shout across
--  the office) with nothing recorded on the record itself. Any back-office
--  role can now assign any HO task record (Non-Scan, Wrong Price, etc. — every
--  task type, not a subset) to any OTHER back-office role, bidirectionally,
--  the same way /message-recipients already treats "back office" as one flat
--  group rather than a hierarchy.
--
--  MODEL
--  -----
--  Both an id (authoritative) and a denormalized display name are stored for
--  the assignee AND the assigner, matching task_record_messages'
--  recipient_id/recipient_name precedent -- the grid can show "Assigned to
--  Chamya" without a join, while the id is what the API actually filters and
--  compares on ("assigned to me" = assigned_to = session.user_id).
--
--  assigned_at is nulled together with the other four columns on unassign,
--  matching the reverse-status pattern of clearing a whole status-linked group
--  of timestamps together rather than leaving a stale one behind.
--
--  ON DELETE SET NULL on both FKs: a deactivated/removed user should not block
--  deleting them, and a record whose assignee disappeared just quietly becomes
--  unassigned rather than the delete failing.
-- ============================================================================

ALTER TABLE public.task_records
  ADD COLUMN IF NOT EXISTS assigned_to      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_name text,
  ADD COLUMN IF NOT EXISTS assigned_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by_name text,
  ADD COLUMN IF NOT EXISTS assigned_at      timestamptz;

-- Serves both "which records are assigned to me" (the grid's pinned-to-top
-- rows) and the nav badge's count query. Partial: the overwhelming majority
-- of rows are never assigned, so indexing only the ones that are keeps this
-- small on a table this size.
CREATE INDEX IF NOT EXISTS idx_task_records_assigned_to
  ON public.task_records (assigned_to)
  WHERE assigned_to IS NOT NULL;

-- Extend the closed event_type vocabulary (supabase-migration-record-activity-events.sql)
-- so an assign/unassign can log to the record's History like every other
-- non-status change (a note edit, a pricing move, a message).
ALTER TABLE public.task_record_events
  DROP CONSTRAINT IF EXISTS task_record_events_kind_chk;

ALTER TABLE public.task_record_events
  ADD CONSTRAINT task_record_events_kind_chk
  CHECK (event_type = ANY (ARRAY[
    'status', 'created', 'note', 'photo',
    'pricing_sent', 'pricing_priced', 'pricing_removed',
    'message', 'message_resolved',
    'assigned'            -- record assigned to, or unassigned from, a colleague
  ]));
