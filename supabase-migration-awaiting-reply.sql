-- ── Awaiting-reply queue ──────────────────────────────────────────────────
-- Message threads (task_record_messages) currently only track per-side
-- read/dismissed flags — there is no shared "this conversation is done"
-- state, and no way to say whose turn it is to answer. This adds both:
--
--   1. messages_resolved_at / messages_resolved_by_name on task_records —
--      either side can mark a thread resolved once no further reply is
--      needed. A new message on a resolved thread clears it again (mirrors
--      the existing un-dismiss-on-new-message behaviour).
--   2. awaiting_reply_threads() RPC — one call returning every unresolved
--      thread with its last message and a derived `waiting_on` ('bo' |
--      'store'), the side that did NOT send the last message. Oldest
--      last-message first, so the longest-standing "your turn" items sort
--      to the top.
--
-- Verified against live data before writing this: 110 messages across 90
-- threads today (author_role values seen: admin, sales_assistant,
-- store_manager) — comfortably small, no pagination/subrequest-cap concerns.

ALTER TABLE task_records
  ADD COLUMN IF NOT EXISTS messages_resolved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS messages_resolved_by_name text;

-- Supports the last-message-per-thread window function below. Cheap now
-- (90 threads) but grows with usage, so it's worth having from day one.
CREATE INDEX IF NOT EXISTS idx_trm_record_created
  ON task_record_messages (record_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.awaiting_reply_threads(p_store_ids uuid[] DEFAULT NULL)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH ranked AS (
    SELECT
      m.record_id, m.author_role, m.author_name, m.body, m.created_at,
      row_number() OVER (PARTITION BY m.record_id ORDER BY m.created_at DESC) AS rn,
      count(*)     OVER (PARTITION BY m.record_id)                            AS message_count
    FROM task_record_messages m
  ),
  last_msg AS (SELECT * FROM ranked WHERE rn = 1)
  SELECT COALESCE(json_agg(
    json_build_object(
      'record_id',        tr.id,
      'store_id',         tr.store_id,
      'store_code',       COALESCE(s.store_code, ''),
      'store_name',       COALESCE(s.store_name, '(unknown store)'),
      'task_type',        tr.task_type,
      'label',            COALESCE(
                             NULLIF(tr.item_name, ''), NULLIF(tr.description, ''),
                             NULLIF(tr.product_name_label, ''), NULLIF(tr.product_code, ''),
                             tr.product_barcode, 'Record'
                           ),
      'preview',          left(regexp_replace(COALESCE(lm.body, ''), '\s+', ' ', 'g'), 90),
      'last_message_at',  lm.created_at,
      'last_author_name', lm.author_name,
      'last_author_role', lm.author_role,
      'message_count',    lm.message_count,
      'waiting_on',
        CASE
          WHEN lm.author_role IN ('area_manager','support_admin','buying_manager','buying_head','admin')
            THEN 'store'
          WHEN lm.author_role IN ('sales_assistant','supervisor','assistant_store_manager','store_manager')
            THEN 'bo'
          ELSE NULL
        END
    ) ORDER BY lm.created_at ASC
  ), '[]'::json)
  FROM last_msg lm
  JOIN task_records tr ON tr.id = lm.record_id
  LEFT JOIN stores s ON s.id = tr.store_id
  WHERE tr.messages_resolved_at IS NULL
    AND (p_store_ids IS NULL OR tr.store_id = ANY(p_store_ids))
$function$;

-- ── Verify ────────────────────────────────────────────────────────────────
SELECT 'awaiting_reply_threads' AS fn, awaiting_reply_threads() IS NOT NULL AS ok;
