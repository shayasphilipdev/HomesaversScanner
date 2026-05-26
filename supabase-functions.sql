-- ============================================================
-- Homesavers Scanner App — Supabase RPC Functions
-- Run these in Supabase SQL Editor if the functions are missing.
-- They are called by the Pages Function backend and must exist
-- in the live database for the app to work correctly.
-- ============================================================

-- ── app_settings additions (Phase 2) ────────────────────────────────────────
-- Add the last_auto_cleanup_at tracking key (used by the automatic daily
-- cleanup that fires on back-office login). Safe to run on an existing DB.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('last_auto_cleanup_at', '', now())
ON CONFLICT (key) DO NOTHING;

-- ── hash_pin ─────────────────────────────────────────────────────────────────
-- Hashes a plain-text PIN with bcrypt inside Postgres.
-- Called by:
--   POST /admin/users          (create user)
--   POST /admin/users/:id/pin  (reset PIN)
-- Returns: { hash: text }
CREATE OR REPLACE FUNCTION hash_pin(pin text)
RETURNS TABLE(hash text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT crypt(pin, gen_salt('bf')) AS hash;
$$;

-- ── list_old_photos ───────────────────────────────────────────────────────────
-- Returns the storage object paths for photos attached to task_records that
-- were created more than `days` days ago. Used by the photo cleanup job
-- (POST /admin/cleanup/photos) to delete stale files from the task-photos bucket.
--
-- Called by:
--   POST /admin/cleanup/photos
-- Returns rows with: { name: text }  (the path segment after the bucket name,
--   e.g. "abc123/product.jpg" or "store-tasks/xyz.jpg")
CREATE OR REPLACE FUNCTION list_old_photos(days integer)
RETURNS TABLE(name text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT regexp_replace(photo_product_url,
           '^.*/storage/v1/object/public/task-photos/', '') AS name
  FROM task_records
  WHERE photo_product_url IS NOT NULL
    AND created_at < now() - (days || ' days')::interval

  UNION ALL

  SELECT regexp_replace(photo_barcode_url,
           '^.*/storage/v1/object/public/task-photos/', '') AS name
  FROM task_records
  WHERE photo_barcode_url IS NOT NULL
    AND created_at < now() - (days || ' days')::interval;
$$;

-- ── verify_pin ────────────────────────────────────────────────────────────────
-- Already in supabase-schema.sql — included here for completeness.
-- Verifies a plain-text PIN against a bcrypt hash.
-- Called by: POST /login, POST /admin/login
-- CREATE OR REPLACE FUNCTION verify_pin(hash text, pin text)
-- RETURNS TABLE(result boolean) LANGUAGE sql SECURITY DEFINER AS $$
--   SELECT (crypt(pin, hash) = hash) AS result;
-- $$;
