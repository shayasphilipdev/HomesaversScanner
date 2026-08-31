-- ============================================================================
--  Fix three live bugs found in the 2026-08-28 CRM/opportunity review:
--
--  1. /manager/overview and /store-tasks/stats compute KPIs in JavaScript
--     over a `limit: 5000` fetch with NO ORDER BY. Verified live: 7-day
--     task_records volume is 56,235 rows — any multi-store user (area manager,
--     admin) is seeing numbers computed from under 9% of the real data, sorted
--     by whatever the database happened to return first. Store managers never
--     noticed because a single store's volume fits under 5,000.
--
--  2. /reports/aging pages pending A-F records at 1,000/page (PostgREST's
--     db-max-rows cap) up to 50 pages — exactly the Cloudflare Free-plan
--     50-subrequest-per-request ceiling. Currently only 40 rows (harmless
--     today) but those records are purge-exempt, so this grows without bound
--     and will eventually 502 the weekly email with no warning.
--
--  3. GET /product-master runs two unbounded db.select() calls against
--     alt_barcodes (96,971 distinct products) on every single page load, to
--     resolve which supl_ids belong to an active supplier. db.select has no
--     default row limit.
--
--  Run once in the Supabase SQL Editor.
-- ============================================================================


-- ── 1. manager_overview() — replaces the JS aggregation in /manager/overview ─
-- Same output shape the Worker already returns, computed as SQL aggregates so
-- there is no row cap to silently truncate. p_store_ids = NULL means
-- unrestricted (all active stores) — same semantics as scopedStoreIds().
CREATE OR REPLACE FUNCTION public.manager_overview(p_store_ids uuid[] DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  result json;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_seven_ago date := v_today - 6;
BEGIN
  WITH scoped_stores AS (
    SELECT id, store_name, store_code
    FROM stores
    WHERE is_active
      AND (p_store_ids IS NULL OR id = ANY(p_store_ids))
  ),
  tr AS (
    SELECT t.store_id, t.status, t.created_at,
           (t.photo_product_url IS NOT NULL OR t.photo_barcode_url IS NOT NULL) AS has_photo
    FROM task_records t
    JOIN scoped_stores s ON s.id = t.store_id
    WHERE t.created_at >= v_seven_ago
      AND t.status <> 'cleared'
  ),
  tr_agg AS (
    SELECT
      store_id,
      count(*) FILTER (WHERE created_at::date = v_today)                                   AS ho_today,
      count(*) FILTER (WHERE status = 'pending')                                            AS ho_pending,
      count(*) FILTER (WHERE status IN ('completed','no_change_needed'))                    AS ho_to_clear,
      count(*) FILTER (WHERE created_at::date = v_today AND has_photo)                      AS photos_today
    FROM tr
    GROUP BY store_id
  ),
  sti AS (
    SELECT i.store_id, i.status, i.due_date, i.photo_url
    FROM store_task_instances i
    JOIN scoped_stores s ON s.id = i.store_id
    WHERE i.due_date >= v_seven_ago
  ),
  sti_today AS (
    SELECT
      store_id,
      count(*)                                            AS tasks_today_total,
      count(*) FILTER (WHERE status = 'completed')         AS tasks_today_done,
      count(*) FILTER (WHERE photo_url IS NOT NULL)        AS photos_today_sti
    FROM sti
    WHERE due_date = v_today
    GROUP BY store_id
  ),
  heatmap AS (
    SELECT
      store_id, due_date,
      count(*) AS total,
      count(*) FILTER (WHERE status = 'completed') AS done
    FROM sti
    GROUP BY store_id, due_date
  ),
  per_store_rows AS (
    SELECT
      s.id AS store_id, s.store_name, s.store_code,
      COALESCE(tr_agg.ho_today, 0)       AS ho_today,
      COALESCE(tr_agg.ho_pending, 0)     AS ho_pending,
      COALESCE(tr_agg.ho_to_clear, 0)    AS ho_to_clear,
      COALESCE(sti_today.tasks_today_total, 0) AS tasks_today_total,
      COALESCE(sti_today.tasks_today_done, 0)  AS tasks_today_done,
      CASE WHEN COALESCE(sti_today.tasks_today_total,0) > 0
           THEN round((sti_today.tasks_today_done::numeric / sti_today.tasks_today_total) * 100)
           ELSE NULL END AS completion_pct,
      COALESCE(tr_agg.photos_today, 0) + COALESCE(sti_today.photos_today_sti, 0) AS photos_today
    FROM scoped_stores s
    LEFT JOIN tr_agg   ON tr_agg.store_id = s.id
    LEFT JOIN sti_today ON sti_today.store_id = s.id
  ),
  totals_row AS (
    SELECT
      COALESCE(sum(ho_today),0)::int AS ho_today,
      COALESCE(sum(ho_pending),0)::int AS ho_pending,
      COALESCE(sum(ho_to_clear),0)::int AS ho_to_clear,
      COALESCE(sum(photos_today),0)::int AS photos_today,
      COALESCE(sum(tasks_today_total),0)::int AS tasks_today_total,
      COALESCE(sum(tasks_today_done),0)::int AS tasks_today_done
    FROM per_store_rows
  ),
  day_series AS (
    SELECT generate_series(v_seven_ago, v_today, interval '1 day')::date AS d
  ),
  by_day_7_rows AS (
    SELECT
      s.id AS store_id, s.store_name,
      json_agg(
        json_build_object(
          'date', to_char(ds.d, 'YYYY-MM-DD'),
          'pct', CASE WHEN COALESCE(h.total,0) > 0 THEN round((h.done::numeric / h.total) * 100) ELSE NULL END
        ) ORDER BY ds.d
      ) AS days
    FROM scoped_stores s
    CROSS JOIN day_series ds
    LEFT JOIN heatmap h ON h.store_id = s.id AND h.due_date = ds.d
    GROUP BY s.id, s.store_name
  )
  SELECT json_build_object(
    'totals', (
      SELECT json_build_object(
        'ho_today', ho_today, 'ho_pending', ho_pending, 'ho_to_clear', ho_to_clear,
        'photos_today', photos_today,
        'tasks_today_total', tasks_today_total, 'tasks_today_done', tasks_today_done,
        'store_completion_pct', CASE WHEN tasks_today_total > 0
          THEN round((tasks_today_done::numeric / tasks_today_total) * 100) ELSE NULL END
      ) FROM totals_row
    ),
    'per_store', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'store_id', store_id, 'store_name', store_name, 'store_code', store_code,
          'ho_today', ho_today, 'ho_pending', ho_pending, 'ho_to_clear', ho_to_clear,
          'tasks_today_total', tasks_today_total, 'tasks_today_done', tasks_today_done,
          'completion_pct', completion_pct, 'photos_today', photos_today
        )
        -- Worst first: lowest completion % (NULLs last), then most pending HO.
        ORDER BY completion_pct ASC NULLS LAST, ho_pending DESC
      ), '[]'::json)
      FROM per_store_rows
    ),
    'by_day_7', (
      SELECT COALESCE(json_agg(json_build_object('store_id', store_id, 'store_name', store_name, 'days', days)), '[]'::json)
      FROM by_day_7_rows
    ),
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) INTO result;

  RETURN result;
END;
$function$;


-- ── 2. store_task_stats_agg() — replaces the JS aggregation in /store-tasks/stats ─
CREATE OR REPLACE FUNCTION public.store_task_stats_agg(
  p_store_ids uuid[] DEFAULT NULL,   -- NULL = unrestricted; empty array = nothing
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  result json;
BEGIN
  WITH scoped AS (
    SELECT i.store_id, i.status
    FROM store_task_instances i
    WHERE (p_store_ids IS NULL OR i.store_id = ANY(p_store_ids))
      AND (p_from IS NULL OR i.due_date >= p_from)
      AND (p_to   IS NULL OR i.due_date <= p_to)
  ),
  per_store AS (
    SELECT
      store_id,
      count(*)                                    AS total,
      count(*) FILTER (WHERE status='completed')  AS completed,
      count(*) FILTER (WHERE status='missed')      AS missed,
      count(*) FILTER (WHERE status NOT IN ('completed','missed')) AS pending
    FROM scoped
    GROUP BY store_id
  )
  SELECT json_build_object(
    'per_store', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'store_id', ps.store_id, 'store_name', st.store_name,
          'total', ps.total, 'completed', ps.completed, 'pending', ps.pending, 'missed', ps.missed,
          'completion_pct', CASE WHEN ps.total > 0 THEN round((ps.completed::numeric / ps.total) * 100) ELSE 0 END
        ) ORDER BY ps.total DESC
      ), '[]'::json)
      FROM per_store ps LEFT JOIN stores st ON st.id = ps.store_id
    ),
    'overall', (
      SELECT json_build_object(
        'total', COALESCE(sum(total),0), 'completed', COALESCE(sum(completed),0),
        'pending', COALESCE(sum(pending),0), 'missed', COALESCE(sum(missed),0),
        'completion_pct', CASE WHEN COALESCE(sum(total),0) > 0
          THEN round((sum(completed)::numeric / sum(total)) * 100) ELSE 0 END
      ) FROM per_store
    )
  ) INTO result;
  RETURN result;
END;
$function$;


-- ── 3. aging_report_records() — one call instead of up to 50 paged requests ──
-- Same filter as the Worker's OFFSET loop (status='pending', task_type IN (...),
-- not marked for deletion), returned as one JSON array. An RPC's return value
-- is not subject to PostgREST's db-max-rows REST cap the way a table SELECT
-- is, so this needs exactly one HTTP call regardless of backlog size.
CREATE OR REPLACE FUNCTION public.aging_report_records(p_task_types text[])
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT COALESCE(json_agg(
    json_build_object(
      'task_type',    tr.task_type,
      'store_code',   COALESCE(s.store_code, ''),
      'store_name',   COALESCE(s.store_name, '(unknown store)'),
      'product_code', COALESCE(NULLIF(tr.product_code,''), tr.product_barcode, ''),
      'description',  COALESCE(NULLIF(tr.product_name_label,''), tr.description, ''),
      'quantity',     tr.quantity,
      'created_at',   tr.created_at
    ) ORDER BY tr.created_at ASC
  ), '[]'::json)
  FROM task_records tr
  LEFT JOIN stores s ON s.id = tr.store_id
  WHERE tr.status = 'pending'
    AND tr.task_type = ANY(p_task_types)
    AND tr.marked_for_deletion IS DISTINCT FROM true
$function$;


-- ── 4. product_master view — filter active suppliers in SQL, not the Worker ──
-- Was: two unbounded db.select() round trips against alt_barcodes (96,971
-- distinct products) on every page load, to build an IN-list of supl_ids.
-- Behaviour preserved exactly: when the suppliers table is empty, no filter
-- is applied (NOT EXISTS branch); otherwise only products whose
-- alt_barcodes.supplier_code matches an active suppliers row are shown. The
-- /suppliers endpoint already only lists is_active suppliers for the dropdown,
-- so no previously-selectable option becomes unreachable.
CREATE OR REPLACE VIEW public.product_master AS
SELECT
  ab.ean_barcode   AS product_code,
  ab.item_name     AS product_description,
  p.sale_rate      AS selling_price,
  p.item_group     AS category,
  p.item_subgrp_id AS subcategory,
  ab.barcode_no    AS product_barcode,
  ab.item_status   AS product_status,
  ab.barcode_status,
  p.product_type,
  ab.supl_id       AS supplier
FROM alt_barcodes ab
LEFT JOIN prices p ON p.ean_barcode = ab.ean_barcode
WHERE ab.is_primary
  AND (
    NOT EXISTS (SELECT 1 FROM suppliers)
    OR EXISTS (
      SELECT 1 FROM suppliers s
      WHERE s.supplier_code = ab.supplier_code AND s.is_active
    )
  );


-- ── Verify ────────────────────────────────────────────────────────────────
SELECT 'manager_overview'      AS fn, manager_overview() IS NOT NULL AS ok
UNION ALL
SELECT 'store_task_stats_agg', store_task_stats_agg() IS NOT NULL
UNION ALL
SELECT 'aging_report_records', aging_report_records(ARRAY['A','B','C','D','E','F']) IS NOT NULL;
