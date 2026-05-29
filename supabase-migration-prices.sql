-- ============================================================
-- Homesavers Scanner — Prices (ItemMaster) migration
-- Run once in Supabase SQL Editor.
-- Safe to re-run — all statements are idempotent.
-- ============================================================

-- ── prices table ─────────────────────────────────────────────────────────────
-- Stores the subset of ItemMaster columns needed by the Price Check task.
-- Primary key is ean_barcode (the product's EAN / article number).
-- Populated by the sync-prices.ps1 PowerShell job via /api/prices/sync.

CREATE TABLE IF NOT EXISTS prices (
  ean_barcode    text        PRIMARY KEY,     -- EAN_Barcode from ItemMaster
  item_group     text,                        -- ItemGroup  (department)
  item_subgrp_id text,                        -- ItemSubGrp_Id
  product_type   text,                        -- ProductType
  sale_rate      numeric(12,4),               -- SaleRate (selling price, e.g. 4.99)
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prices_item_group ON prices (item_group);
CREATE INDEX IF NOT EXISTS idx_prices_updated_at ON prices (updated_at);

-- ── app_settings defaults for prices sync ────────────────────────────────────
-- The PowerShell service reads these at startup (and every 30 min) to know
-- which folder / file / sheet to watch.  Edit in Admin → Settings.

INSERT INTO app_settings (key, value, updated_at)
VALUES
  ('prices_sync_folder',      '\\192.168.1.205\Supply Chain & Buying - Shared\Data\VRSDAILYDATADUMP\ProductMaster\2026', now()),
  ('prices_sync_pattern',     '*.xlsx',       now()),
  ('prices_sync_name_prefix', 'ItemMaster',   now()),
  ('prices_sync_sheet',       'ItemMaster',   now()),
  ('prices_sync_schedule',    'daily',        now()),
  ('prices_sync_time',        '07:00',        now())
ON CONFLICT (key) DO NOTHING;

-- ── task_types: add display_order column and Price Check task ─────────────────
-- display_order controls the left-to-right order of task tabs in the UI.
-- Existing codes keep their letter; Price Check gets code K.

ALTER TABLE task_types ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 99;

-- Set display order to match the new desired sequence.
-- Existing codes: A=UOM, B=NonScans, C=WrongPrices, D=WrongDesc,
--                 E=PriceMarked, F=DRS, G=Promo, H=StockCount, J=DeptCheck
UPDATE task_types SET display_order = CASE code
  WHEN 'K' THEN 1   -- Price Check      (new A)
  WHEN 'J' THEN 2   -- Department Check (new B)
  WHEN 'B' THEN 3   -- Non-Scans        (new C)
  WHEN 'C' THEN 4   -- Wrong Prices     (new D)
  WHEN 'D' THEN 5   -- Wrong Description(new E)
  WHEN 'A' THEN 6   -- UOM Errors       (new F)
  WHEN 'E' THEN 7   -- Price Marked     (new G)
  WHEN 'F' THEN 8   -- DRS Errors       (new H)
  WHEN 'G' THEN 9   -- Promotion Error  (new I)
  WHEN 'H' THEN 10  -- Stock Count      (new J)
  ELSE 99
END;

-- Add Price Check task type (code K) if it doesn't already exist.
INSERT INTO task_types (code, name, frequency, is_active, display_order)
VALUES ('K', 'Price Check', 'daily', true, 1)
ON CONFLICT (code) DO UPDATE SET
  name          = EXCLUDED.name,
  display_order = EXCLUDED.display_order,
  is_active     = true;
