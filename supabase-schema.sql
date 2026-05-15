-- ============================================================
-- Homesavers Scanner App — Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Enable pgcrypto for bcrypt PIN hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Stores ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code  text UNIQUE NOT NULL,
  store_name  text NOT NULL,
  region      text,
  pin_hash    text,          -- bcrypt hash, set via back office
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Products master ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  text UNIQUE NOT NULL,   -- barcode / product code as text
  description text,
  uom         text,
  category    text,
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── App settings (global key-value) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Default settings
INSERT INTO app_settings (key, value) VALUES
  ('backoffice_pin_hash',         ''),      -- set via: SELECT crypt('yourpin', gen_salt('bf'))
  ('list_auto_close_hours',       '24'),
  ('scan_record_retention_days',  '90'),
  ('photo_retention_days',        '7')
ON CONFLICT (key) DO NOTHING;

-- ── Product records ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             uuid REFERENCES stores(id) ON DELETE SET NULL,
  product_code         text NOT NULL,        -- always text, leading zeros safe
  description          text,
  uom                  text NOT NULL,
  quantity             numeric NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'pending',
    -- pending | completed | store_completed
  marked_for_deletion  boolean NOT NULL DEFAULT false,
  completed_at         timestamptz,          -- set when back office marks completed
  store_completed_at   timestamptz,          -- set when store confirms completion
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Indexes for filtered queries and reports
CREATE INDEX IF NOT EXISTS idx_pr_store_id   ON product_records (store_id);
CREATE INDEX IF NOT EXISTS idx_pr_status     ON product_records (status);
CREATE INDEX IF NOT EXISTS idx_pr_created_at ON product_records (created_at);
CREATE INDEX IF NOT EXISTS idx_pr_store_date ON product_records (store_id, created_at);

-- ── PIN verification RPC ─────────────────────────────────────────────────────
-- Called by the Pages Function to verify store/back-office PINs.
-- Bcrypt runs inside Postgres — PIN never leaves the database in plain text.
CREATE OR REPLACE FUNCTION verify_pin(hash text, pin text)
RETURNS TABLE(result boolean)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT (crypt(pin, hash) = hash) AS result;
$$;

-- ── Set store PINs ────────────────────────────────────────────────────────────
-- After inserting stores, set each store's PIN with:
--   UPDATE stores SET pin_hash = crypt('1234', gen_salt('bf')) WHERE store_code = 'HS001';

-- ── Set back office PIN ───────────────────────────────────────────────────────
-- UPDATE app_settings SET value = crypt('yourpin', gen_salt('bf')) WHERE key = 'backoffice_pin_hash';

-- ── Sample store (remove or adapt) ───────────────────────────────────────────
-- INSERT INTO stores (store_code, store_name, region)
-- VALUES ('HS001', 'Homesavers Dublin', 'Leinster');
-- UPDATE stores SET pin_hash = crypt('1234', gen_salt('bf')) WHERE store_code = 'HS001';
