-- ============================================================
-- Homesavers Scanner App — Supabase Schema (v2, live-accurate)
-- Last verified: 2026-05-26 against project eggspkdengnxktwkdwpw
--
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- All statements are idempotent — safe to re-run on an existing DB.
--
-- Table creation order respects FK dependencies:
--   areas → stores → users → task_types → task_records → …
-- ============================================================

-- Enable pgcrypto for bcrypt PIN hashing (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Areas ────────────────────────────────────────────────────────────────────
-- Geographic groupings for stores.  Area managers are scoped to one or more areas.
CREATE TABLE IF NOT EXISTS areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_code   text UNIQUE,                               -- e.g. 'LEIN', 'MUNS'
  area_name   text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_areas_active ON areas (is_active);

-- ── Stores ───────────────────────────────────────────────────────────────────
-- One row per physical Homesavers store (55 stores).
-- Store PINs were removed in the user-account migration; login is now via users.
CREATE TABLE IF NOT EXISTS stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code  text UNIQUE NOT NULL,                      -- e.g. 'HS001'
  store_name  text        NOT NULL,
  region      text,                                      -- free-text region label
  area_id     uuid REFERENCES areas(id) ON DELETE SET NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stores_area_id ON stores (area_id);

-- ── App settings (global key-value store) ─────────────────────────────────
-- Operational knobs editable from Admin → Settings.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed defaults (safe to re-run; ON CONFLICT skips existing rows)
INSERT INTO app_settings (key, value) VALUES
  ('backoffice_pin_hash',         ''),     -- set via: SELECT crypt('pin', gen_salt('bf'))
  ('list_auto_close_hours',       '24'),
  ('scan_record_retention_days',  '90'),
  ('photo_retention_days',        '7'),
  ('last_auto_cleanup_at',        '')      -- tracks the last background cleanup run
ON CONFLICT (key) DO NOTHING;

-- ── Task types ────────────────────────────────────────────────────────────
-- Lookup table for HO Task codes (A–J, etc.).  Referenced by task_records.task_type.
CREATE TABLE IF NOT EXISTS task_types (
  code       text PRIMARY KEY,                           -- 'A', 'B', … single letter
  name       text        NOT NULL,                       -- display name
  frequency  text        NOT NULL DEFAULT 'daily',       -- 'daily' | 'weekly' | 'monthly'
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Users ────────────────────────────────────────────────────────────────
-- All app users — store staff, area managers, back-office, admin.
-- A single role per user (role column) replaces the old roles text[] array.
-- store_id is a legacy single-store reference; store_ids[] is the authoritative list.
CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text UNIQUE NOT NULL,
  display_name    text        NOT NULL,
  role            text        NOT NULL
    CHECK (role = ANY (ARRAY[
      'sales_assistant', 'supervisor', 'assistant_store_manager', 'store_manager',
      'area_manager', 'support_admin', 'buying_manager', 'buying_head', 'admin'
    ])),
  -- Store assignment (pick one model; both kept for compatibility)
  store_id        uuid        REFERENCES stores(id) ON DELETE SET NULL, -- legacy single-store
  store_ids       uuid[]      NOT NULL DEFAULT '{}',    -- authoritative multi-store list
  area_ids        uuid[]      NOT NULL DEFAULT '{}',    -- area-manager scope
  all_stores      boolean     NOT NULL DEFAULT false,   -- true = no store filter applied
  -- Feature flags
  can_access_hq_tasks    boolean NOT NULL DEFAULT true,
  can_access_store_tasks boolean NOT NULL DEFAULT true,
  -- Auth
  pin_hash        text        NOT NULL DEFAULT '',      -- bcrypt hash; set after insert
  is_active       boolean     NOT NULL DEFAULT true,
  -- Contact / HR (optional)
  email           text,
  phone           text,
  department      text,
  employee_code   text,
  start_date      date,
  notes           text,
  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_active         ON users (is_active);
CREATE INDEX IF NOT EXISTS idx_users_role           ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_store_id       ON users (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_code_unique
  ON users (employee_code) WHERE employee_code IS NOT NULL;

-- ── Lookup options ────────────────────────────────────────────────────────
-- Generic lookup values for reason codes, size groups, etc.
-- kind groups the options; task_types[] scopes them to specific HO task types.
CREATE TABLE IF NOT EXISTS lookup_options (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text        NOT NULL,                      -- e.g. 'reason', 'size'
  label      text        NOT NULL,
  task_types text[]      NOT NULL DEFAULT '{}',         -- empty = applies to all types
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, label)
);

CREATE INDEX IF NOT EXISTS idx_lookup_kind ON lookup_options (kind, is_active);

-- ── Alt barcodes (product master) ─────────────────────────────────────────
-- Bulk-synced daily by a PowerShell job from the central product Excel.
-- ~207 k rows.  barcode_no is the primary lookup key.
CREATE TABLE IF NOT EXISTS alt_barcodes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_no     text UNIQUE NOT NULL,                  -- the barcode scanned in store
  ean_barcode    text,                                  -- EAN-13 / secondary barcode
  item_name      text,
  supl_id        text,                                  -- supplier internal ID
  supplier_code  text,
  item_status    text,                                  -- 'Active' | 'Inactive'
  barcode_status text,                                  -- 'Active' | 'Inactive'
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_altbc_ean ON alt_barcodes (ean_barcode);

-- ── Sync runs ─────────────────────────────────────────────────────────────
-- Audit log written once per PowerShell sync job invocation.
CREATE TABLE IF NOT EXISTS sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text        NOT NULL DEFAULT 'alt_barcodes', -- 'alt_barcodes' | 'products'
  file_name        text,
  file_size_bytes  bigint,
  records_imported integer,
  records_skipped  integer,
  status           text        NOT NULL DEFAULT 'ok',   -- 'ok' | 'error'
  message          text,
  started_at       timestamptz,
  finished_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_recent ON sync_runs (finished_at DESC);

-- ── Task records (HO Tasks) ───────────────────────────────────────────────
-- One row per HO task entry submitted by a back-office user.
-- task_type references task_types.code.
-- Alt-barcode snapshot columns (barcode_no … barcode_status) store a point-
-- in-time copy of alt_barcodes data so reports remain stable after re-syncs.
CREATE TABLE IF NOT EXISTS task_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            uuid REFERENCES stores(id) ON DELETE SET NULL,
  task_type           text        NOT NULL DEFAULT 'A'
    REFERENCES task_types(code),
  -- Core product fields
  product_code        text,                             -- barcode as typed / scanned
  description         text,
  uom                 text,
  quantity            numeric,
  -- Task-type-specific fields
  notes               text,
  product_barcode     text,                             -- Task B: secondary barcode field
  product_name_label  text,                             -- Tasks D/I: label as printed
  supplier_id         uuid,                             -- Task C: FK to suppliers (future)
  supplier_name_text  text,                             -- Task C: free-text supplier name
  -- Alt-barcode snapshot (set on create from alt_barcodes lookup)
  barcode_no          text,
  item_name           text,
  supl_id             text,
  supplier_code       text,
  item_status         text,
  barcode_status      text,
  -- Photo URLs (Supabase Storage: bucket = task-photos)
  photo_product_url   text,                             -- product photo
  photo_barcode_url   text,                             -- barcode photo
  -- Flexible extra data for future task types
  details             jsonb       NOT NULL DEFAULT '{}',
  -- Status workflow:  pending → completed | no_change_needed → store_completed → cleared
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY[
      'pending', 'completed', 'no_change_needed', 'store_completed', 'cleared'
    ])),
  marked_for_deletion boolean     NOT NULL DEFAULT false, -- set when store confirms; cleanup flag
  -- Status timestamps
  completed_at        timestamptz,                      -- set when HO marks completed
  store_completed_at  timestamptz,                      -- set when store confirms
  cleared_at          timestamptz,                      -- set when HO clears
  reviewed_at         timestamptz,
  review_notes        text,
  -- Row timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tr_store_id   ON task_records (store_id);
CREATE INDEX IF NOT EXISTS idx_tr_task_type  ON task_records (task_type);
CREATE INDEX IF NOT EXISTS idx_tr_status     ON task_records (status);
CREATE INDEX IF NOT EXISTS idx_tr_created_at ON task_records (created_at);
CREATE INDEX IF NOT EXISTS idx_tr_store_date ON task_records (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tr_supplier   ON task_records (supplier_id);
CREATE INDEX IF NOT EXISTS idx_tr_barcode_no ON task_records (barcode_no);
-- Partial index: find records with no cleared_at (i.e. still open)
CREATE INDEX IF NOT EXISTS idx_tr_cleared_at ON task_records (cleared_at) WHERE cleared_at IS NULL;

-- ── Task record events (audit ledger) ─────────────────────────────────────
-- Immutable append-only log of every status transition on task_records.
-- by_user_name is a point-in-time snapshot so history survives user deletion.
CREATE TABLE IF NOT EXISTS task_record_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id     uuid        NOT NULL REFERENCES task_records(id) ON DELETE CASCADE,
  from_status   text,
  to_status     text        NOT NULL
    CHECK (to_status = ANY (ARRAY[
      'pending', 'completed', 'no_change_needed', 'store_completed', 'cleared'
    ])),
  by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  by_user_name  text        NOT NULL DEFAULT 'unknown', -- snapshot; survives user deletion
  note          text,
  at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tre_record ON task_record_events (record_id, at);
CREATE INDEX IF NOT EXISTS idx_tre_user   ON task_record_events (by_user_id);

-- ── Store task templates ───────────────────────────────────────────────────
-- Back-office-authored recurring checklist tasks pushed to stores.
-- blocks[] is a JSONB array of structured question blocks (text, checkbox, photo, etc.).
CREATE TABLE IF NOT EXISTS store_task_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text        NOT NULL,
  description          text,
  instructions         text,
  category             text,
  frequency            text        NOT NULL DEFAULT 'daily'
    CHECK (frequency = ANY (ARRAY['daily', 'weekly', 'monthly', 'yearly', 'once_off'])),
  due_window           text,                            -- e.g. 'morning', 'anytime'
  requires_photo       boolean     NOT NULL DEFAULT false,
  requires_notes       boolean     NOT NULL DEFAULT false,
  -- Scope: which stores see this template
  applies_to           text        NOT NULL DEFAULT 'all'
    CHECK (applies_to = ANY (ARRAY['all', 'area', 'stores', 'one'])),
  area_ids             uuid[]      NOT NULL DEFAULT '{}',
  store_ids            uuid[]      NOT NULL DEFAULT '{}',
  -- Who should complete it
  assigned_to_role     text        NOT NULL DEFAULT 'all', -- legacy single-role field
  assigned_to_roles    text[]      NOT NULL DEFAULT '{}',  -- multi-role list (preferred)
  assigned_to_user_ids uuid[]      NOT NULL DEFAULT '{}',  -- explicit user assignments
  -- Optional active date window
  start_at             timestamptz,
  end_at               timestamptz,
  -- Admin
  priority             text,
  sort_order           integer     NOT NULL DEFAULT 0,
  is_active            boolean     NOT NULL DEFAULT true,
  blocks               jsonb       NOT NULL DEFAULT '[]', -- structured question blocks
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stt_active      ON store_task_templates (is_active);
CREATE INDEX IF NOT EXISTS idx_stt_frequency   ON store_task_templates (frequency);
CREATE INDEX IF NOT EXISTS idx_stt_applies_to  ON store_task_templates (applies_to);
CREATE INDEX IF NOT EXISTS idx_stt_created_by  ON store_task_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_stt_start_end   ON store_task_templates (start_at, end_at);

-- ── Store task instances ───────────────────────────────────────────────────
-- One row per (template, store, period).  Created lazily when a store first
-- opens their checklist for that period.
-- period_key formats: 'YYYY-MM-DD' (daily) · 'YYYY-Www' (weekly) ·
--                     'YYYY-MM' (monthly) · 'YYYY' (yearly) · 'once_<template_id>'
-- UNIQUE constraint on (template_id, store_id, period_key) makes creation idempotent.
CREATE TABLE IF NOT EXISTS store_task_instances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid        NOT NULL REFERENCES store_task_templates(id) ON DELETE CASCADE,
  store_id     uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_key   text        NOT NULL,
  due_date     date,
  status       text        NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending', 'completed', 'missed'])),
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  photo_url    text,                                    -- optional completion photo
  notes        text,
  answers      jsonb       NOT NULL DEFAULT '{}',       -- block-level answers keyed by block index
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, store_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_sti_store_status ON store_task_instances (store_id, status);
CREATE INDEX IF NOT EXISTS idx_sti_due_date     ON store_task_instances (due_date);
CREATE INDEX IF NOT EXISTS idx_sti_period       ON store_task_instances (period_key);
CREATE INDEX IF NOT EXISTS idx_sti_completed_by ON store_task_instances (completed_by);

-- ── Product questions ─────────────────────────────────────────────────────
-- Chain-wide product-query board.  Stores post a photo + notes asking other
-- stores (or HO) for help identifying an unknown product.
-- status 'closed' makes the question invisible to the UI; data is retained.
CREATE TABLE IF NOT EXISTS product_questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_url        text        NOT NULL,                -- required photo of the product
  notes            text,
  store_id         uuid REFERENCES stores(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  text        NOT NULL DEFAULT '',     -- snapshot
  status           text        NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open', 'closed'])),
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pq_status_created ON product_questions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pq_created_by     ON product_questions (created_by);

-- ── Product question answers ──────────────────────────────────────────────
-- Replies to product_questions.  Photo is optional; notes are required.
CREATE TABLE IF NOT EXISTS product_question_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid        NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
  photo_url    text,
  notes        text        NOT NULL,
  store_id     uuid REFERENCES stores(id) ON DELETE SET NULL,
  by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  by_user_name text        NOT NULL DEFAULT '',         -- snapshot
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pqa_question ON product_question_answers (question_id, at);

-- ════════════════════════════════════════════════════════════════════════════
-- RPC Functions
-- ════════════════════════════════════════════════════════════════════════════

-- ── verify_pin ─────────────────────────────────────────────────────────────
-- Checks a plain-text PIN against a bcrypt hash inside Postgres.
-- The PIN never leaves the database.
-- Called by: POST /users/verify-pin, POST /stores/verify-pin
-- Returns:   TABLE(result boolean)
CREATE OR REPLACE FUNCTION verify_pin(hash text, pin text)
RETURNS TABLE(result boolean)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (crypt(pin, hash) = hash) AS result;
$$;

-- ── hash_pin ───────────────────────────────────────────────────────────────
-- Generates a new bcrypt hash for a plain-text PIN.
-- Called by: POST /admin/users, POST /admin/users/:id/pin
-- Returns:   TABLE(hash text)
CREATE OR REPLACE FUNCTION hash_pin(pin text)
RETURNS TABLE(hash text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT crypt(pin, gen_salt('bf')) AS hash;
$$;

-- ── list_old_photos ────────────────────────────────────────────────────────
-- Returns storage object paths for photos older than `days` days.
-- Covers both HO task record photos and store task instance photos (M18).
-- Called by: POST /admin/cleanup/photos, runAutoCleanup()
-- Returns:   TABLE(name text)  — path after the bucket name, e.g. 'abc123/product.jpg'
CREATE OR REPLACE FUNCTION list_old_photos(days integer)
RETURNS TABLE(name text)
LANGUAGE sql SECURITY DEFINER AS $$
  -- HO task record: product photo
  SELECT regexp_replace(photo_product_url,
           '^.*/storage/v1/object/public/task-photos/', '') AS name
  FROM task_records
  WHERE photo_product_url IS NOT NULL
    AND created_at < now() - (days || ' days')::interval

  UNION ALL

  -- HO task record: barcode photo
  SELECT regexp_replace(photo_barcode_url,
           '^.*/storage/v1/object/public/task-photos/', '') AS name
  FROM task_records
  WHERE photo_barcode_url IS NOT NULL
    AND created_at < now() - (days || ' days')::interval

  -- Store task instance: completion photo (M18)
  UNION ALL

  SELECT regexp_replace(photo_url,
           '^.*/storage/v1/object/public/task-photos/', '') AS name
  FROM store_task_instances
  WHERE photo_url IS NOT NULL
    AND created_at < now() - (days || ' days')::interval;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Operational notes
-- ════════════════════════════════════════════════════════════════════════════

-- Set a user's PIN after INSERT:
--   UPDATE users SET pin_hash = crypt('1234', gen_salt('bf')) WHERE username = 'jane';
-- Or via the hash_pin() RPC (used by the admin UI):
--   SELECT hash FROM hash_pin('1234');

-- Set the back-office master PIN:
--   UPDATE app_settings
--   SET value = crypt('yourpin', gen_salt('bf')), updated_at = now()
--   WHERE key = 'backoffice_pin_hash';

-- Add a new store:
--   INSERT INTO stores (store_code, store_name, region, area_id)
--   VALUES ('HS056', 'Homesavers Galway', 'Connacht', '<area_uuid>');
-- Then assign store staff users to it via store_ids[].

-- Supabase Storage bucket required: task-photos (public read, authenticated write)
-- Photo paths:  {tempId}/product.jpg  ·  {tempId}/barcode.jpg  ·  store-tasks/{tempId}.jpg
