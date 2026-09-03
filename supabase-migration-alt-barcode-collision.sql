-- ============================================================================
--  alt_barcodes — stop losing products to the barcode_no UNIQUE collision
--
--  Affects the LIVE database. RUN THE STEPS IN ORDER — see SEQUENCING below.
-- ============================================================================
--
--  THE BUG
--  -------
--  alt_barcodes.barcode_no was declared UNIQUE, but a barcode in the ALT
--  Barcode Master can legitimately belong to two different products. Measured
--  on the 2026-09-02 file: 273 barcodes carry 2+ distinct EANs (547 rows).
--
--      EAN 01-01-351-00  KETTLE CHIPS S&VIN 130G   barcode 5017764128128
--      EAN 01-01-070-00  KETTLE 130G S/S BALSAMIC  barcode 5017764128128
--
--  Only one row per barcode could exist, so one product was silently
--  overwritten by the other and vanished from every ean_barcode lookup.
--
--  Worse, WHICH one survived was arbitrary. functions/api/[[route]].js has a
--  deliberate "prefer the Active barcode" rule, but it only applies inside one
--  2,000-row chunk; across chunks it is a plain PostgREST merge-duplicates
--  upsert where the later chunk wins. The sync sorts its payload by
--  ean_barcode, so two products sharing a barcode almost always land in
--  different chunks and the winner is decided by ALPHABETICAL EAN ORDER.
--  Sometimes the discontinued product won and the live one disappeared.
--
--  MEASURED (2026-09-02, live, by replaying the real sync against the real
--  file — the replay reproduced production exactly: 212,109 prepared ->
--  211,957 written -> 211,834 rows -> 97,106 distinct EANs, all four matching):
--
--      89 EANs lost to the collision.  Predicted 89, actually missing 89,
--      zero false positives when checked against the live table.
--
--  For context, the full gap between prices (100,427 EANs) and alt_barcodes
--  (97,106) is 3,321, and it is NOT all this bug:
--      89     this collision                              <- fixed here
--      664    every row in the file has a blank Barcode_No  (dropped by the
--             sync by design — it needs a barcode; raise with the file owner)
--      2,568  simply not in the ALT Barcode Master at all   (legitimate)
--
--  THE FIX
--  -------
--  Key on (barcode_no, ean_barcode), not barcode_no alone. Replaying the sync
--  with that key: 212,108 rows, 97,195 distinct EANs, ZERO products lost.
--  Cost is +274 rows on a 211,834-row table.
--
--  WHY "NULLS NOT DISTINCT" (Postgres 15+; this DB is 17.6)
--  --------------------------------------------------------
--  ean_barcode is nullable, and in a plain UNIQUE two NULLs never conflict.
--  Without this clause, a row with a NULL ean would fail to match ON CONFLICT
--  and the nightly sync would insert a fresh duplicate EVERY NIGHT, for ever.
--  Live currently has 0 null/empty eans so nothing would break today, which is
--  exactly what makes it a good trap. Say NULLS NOT DISTINCT and it cannot
--  arise. (Same failure mode as the all-zeros sentinel in
--  supabase-migration-stats-rollup.sql — a NULL in a unique key never
--  conflicts and silently duplicates on every upsert.)
--
--  SEQUENCING — the two ALTERs must straddle the Worker deploy
--  ------------------------------------------------------------
--  ON CONFLICT needs a matching unique index or it errors outright, so there
--  is no single moment where old code and new schema (or new code and old
--  schema) are both valid. Adding the new index BEFORE the deploy and dropping
--  the old one AFTER means both the old and the new Worker work at every point:
--
--      STEP 1  (this file)      add UNIQUE (barcode_no, ean_barcode)
--                               -> old Worker still fine, old constraint intact
--      then    deploy the Worker with on_conflict=barcode_no,ean_barcode
--      STEP 2  (this file)      drop UNIQUE (barcode_no)
--      then    STEP 3 backfill, or just let the 07:30 sync rebuild
--
--  Do NOT run STEP 2 before the Worker is live: the deployed code would ask for
--  ON CONFLICT (barcode_no) against an index that no longer exists and every
--  sync chunk would 400.
-- ============================================================================


-- ── STEP 1 — add the new key (run BEFORE deploying the Worker) ──────────────
-- Additive and safe: the old constraint stays, so nothing in flight breaks.
-- Not CONCURRENTLY: 212k narrow rows builds in well under a second, and doing
-- it in-band keeps this a single ordinary statement.
ALTER TABLE public.alt_barcodes
  ADD CONSTRAINT alt_barcodes_barcode_ean_key
  UNIQUE NULLS NOT DISTINCT (barcode_no, ean_barcode);

COMMENT ON CONSTRAINT alt_barcodes_barcode_ean_key ON public.alt_barcodes IS
  'One row per (barcode, product). A barcode may belong to 2+ products; keying on barcode alone silently dropped one of them.';


-- ── STEP 2 — drop the old key (run AFTER the Worker is deployed) ────────────
-- ALTER TABLE public.alt_barcodes DROP CONSTRAINT alt_barcodes_barcode_no_key;


-- ── STEP 3 — verify ─────────────────────────────────────────────────────────
-- Expected AFTER the next sync (or the one-off backfill):
--   rows          211834 -> 212108
--   distinct ean   97106 -> 97195
--   missing_vs_prices 3321 -> 3232   (the 89 gone; 664 + 2568 remain, and are
--                                     not this bug — see the header)
--
-- SELECT (SELECT count(*) FROM alt_barcodes)                       AS rows,
--        (SELECT count(DISTINCT ean_barcode) FROM alt_barcodes)    AS distinct_ean,
--        (SELECT count(*) FROM (SELECT DISTINCT btrim(ean_barcode) e FROM prices) p
--          WHERE NOT EXISTS (SELECT 1 FROM alt_barcodes a
--                            WHERE btrim(a.ean_barcode) = p.e))    AS missing_vs_prices;
--
-- Nothing may ever share a (barcode, ean) pair — must return 0 rows:
-- SELECT barcode_no, ean_barcode, count(*) FROM alt_barcodes
--  GROUP BY 1,2 HAVING count(*) > 1;
--
-- The barcodes that now legitimately carry more than one product (~273), and
-- proof that each still resolves to exactly one Active barcode — which is what
-- /alt-barcodes/lookup?barcode= relies on when it orders by barcode_status:
-- SELECT count(*) AS shared_barcodes,
--        count(*) FILTER (WHERE actives <> 1) AS ambiguous_must_be_zero
--   FROM (SELECT barcode_no,
--                count(*) FILTER (WHERE barcode_status = 'Active') AS actives
--           FROM alt_barcodes GROUP BY barcode_no HAVING count(*) > 1) x;
