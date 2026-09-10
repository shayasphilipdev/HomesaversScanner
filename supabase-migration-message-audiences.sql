-- ============================================================================
--  Restricted-audience messages on record threads
--
--  Run once in the Supabase SQL Editor. Affects the LIVE database.
--  (Applied live 2026-09-10 via the apply_migration MCP tool under the name
--  "message_audiences" -- this file is the tracked copy.)
-- ============================================================================
--
--  WHY
--  ---
--  task_record_messages is two-sided (store <-> back-office) and anyone whose
--  store scope covers the record sees the whole thread. Back office needs notes
--  visible ONLY to fellow reviewers (support_admin / buying_manager /
--  buying_head / admin -- the REVIEWER_ROLES set), and separately notes visible
--  ONLY to area managers. Everyone else -- stores, store managers, the other HQ
--  group -- must see nothing: no thread, no preview, no unread badge.
--
--  MODEL (enforced in functions/api/[[route]].js, not in SQL)
--  ---------------------------------------------------------
--    audience 'all'           -> unchanged, existing store-scope rule
--    audience 'backoffice'    -> role in REVIEWER_ROLES OR author OR named recipient
--    audience 'area_managers' -> role = area_manager    OR author OR named recipient
--  recipient_id / recipient_name is a visible "To: X" hint only -- it does NOT
--  narrow visibility, the whole audience group still sees the message.
--
--  Read / dismiss: a third side 'am' joins 'store' / 'bo'.
--    'backoffice' rows    -> tracked on is_read_by_bo / is_dismissed_by_bo
--                            (all reviewers share, exactly as 'all' does today)
--    'area_managers' rows -> tracked on the new is_read_by_am / is_dismissed_by_am
--  On POST, the two sides that must never see the row are forced
--  read + dismissed so it can never surface for them.
--
--  Awaiting Reply: restricted notes are internal, not an HO<->store SLA
--  obligation, so awaiting_reply_threads ranks off audience='all' only. A
--  record whose sole messages are restricted never appears in that queue.
-- ============================================================================

ALTER TABLE public.task_record_messages
  ADD COLUMN IF NOT EXISTS audience           text    NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS recipient_id       uuid,
  ADD COLUMN IF NOT EXISTS recipient_name     text,
  ADD COLUMN IF NOT EXISTS is_read_by_am      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_dismissed_by_am boolean NOT NULL DEFAULT false;

ALTER TABLE public.task_record_messages
  DROP CONSTRAINT IF EXISTS task_record_messages_audience_check;
ALTER TABLE public.task_record_messages
  ADD CONSTRAINT task_record_messages_audience_check
  CHECK (audience IN ('all','backoffice','area_managers'));

-- Every existing row already reads audience='all' via the column default, and
-- the two _am flags default false -- all correct, no backfill needed.

CREATE INDEX IF NOT EXISTS idx_trm_restricted
  ON public.task_record_messages (record_id)
  WHERE audience <> 'all';

-- ── awaiting_reply_threads: consider audience='all' messages only ───────────
-- Verbatim from the live definition (dumped 2026-09-10) except the single
-- `WHERE m.audience = 'all'` added to the `ranked` CTE.
CREATE OR REPLACE FUNCTION public.awaiting_reply_threads(p_store_ids uuid[] DEFAULT NULL::uuid[])
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
    WHERE m.audience = 'all'
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
