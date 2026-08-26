-- ============================================================================
--  Expiry Management — Phase 1: Task M (Routine Expiry Sweep)
--  Run once in the Supabase SQL Editor.
--
--  Replaces the old Expiry Date Check (Task L) with the fit-for-purpose
--  Routine Expiry Sweep (Task M). L is deactivated (not deleted) so any
--  existing test records keep their foreign key to task_types(code).
--
--  Task M is hidden on the LIVE app until you flip it on (it shows on the
--  test app now). To go live later, remove the `t.code !== 'M'` filter in
--  client/src/pages/Tasks.jsx and HoTasksHelp.jsx (the `testOnly` flag).
-- ============================================================================

-- Defensive: ensure the ordering column exists (it does in production; this is
-- a no-op there and makes the script safe to run on a fresh/older schema).
ALTER TABLE task_types ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- 1. Add Task M, inheriting Task L's ordering slot so it lands in the same place
--    in the picker. Idempotent — safe to run more than once.
INSERT INTO task_types (code, name, frequency, sort_order, display_order, is_active)
SELECT 'M', 'Routine Expiry Sweep', 'weekly',
       COALESCE((SELECT sort_order    FROM task_types WHERE code = 'L'), 90),
       COALESCE((SELECT display_order FROM task_types WHERE code = 'L'), 90),
       true
ON CONFLICT (code) DO UPDATE
  SET name          = EXCLUDED.name,
      frequency     = EXCLUDED.frequency,
      sort_order    = EXCLUDED.sort_order,
      display_order = EXCLUDED.display_order,
      is_active     = true;

-- 2. Deactivate the old Expiry Date Check (Task L). The row stays so existing
--    records still reference a valid task_types.code; /task-types filters on
--    is_active = true, so L disappears from the picker everywhere.
UPDATE task_types SET is_active = false WHERE code = 'L';

-- 3. Verify.
SELECT code, name, frequency, display_order, is_active
FROM task_types
WHERE code IN ('L', 'M')
ORDER BY code;
