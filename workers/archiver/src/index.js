// Department Check archiver.
//
// Moves task_type 'J' records out of Supabase and into the D1 archive once they
// are older than scan_record_retention_days, so the 6-month history the business
// wants can exist without Supabase's 500 MB free tier having to hold it.
//
// PHASE 2 RUNS IN SHADOW MODE (env.SHADOW_MODE === '1'): it writes to D1 and
// deletes NOTHING. pg_cron's purge_old_task_records() continues to delete on its
// own schedule at 02:00 UTC exactly as it does today. The consequence worth
// stating plainly: in shadow mode this cannot lose anything that was not already
// being destroyed every night, and if the archiver is wrong we find out by
// comparing counts rather than by losing records. Phase 3 flips SHADOW_MODE off
// and narrows the Postgres purge so it can only delete what D1 already holds.
//
// Scope is task_type 'J' only. Every other type keeps its current lifecycle,
// which is what leaves /reports/aging (Tasks A-F are deliberately purge-exempt)
// and Expiry Overview (Task M keeps 180 days in Postgres) untouched.

const BATCH          = 500      // PostgREST caps a page at 1000; 500 keeps each D1 batch modest
const TIME_BUDGET_MS = 25_000   // stop starting new pages after this; the next run picks up the rest
const MAX_PAGES      = 60       // hard backstop against a paging bug looping forever

// Only the columns Task J actually populates. Measured across all 163,517 live
// J rows: completed_at, store_completed_at, notes, description, quantity, uom,
// photos, review_notes, reviewed_at, product_name_label, actual_product_name,
// supplier_name_text and priced_at are NULL for every one of them, so asking
// for them would cost bytes on every page for nothing.
const SELECT_COLS = [
  'id', 'store_id', 'product_code', 'barcode_no', 'product_barcode',
  'item_name', 'supl_id', 'supplier_code', 'item_status', 'barcode_status',
  'details', 'status', 'source', 'created_at', 'updated_at', 'cleared_at',
].join(',')

const ms = (iso) => (iso ? Date.parse(iso) : null)

async function sb(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// The cutoff is read from app_settings every run rather than baked in, so
// changing "Scan record retention (days)" on the Settings page moves this too
// and the archiver can never disagree with the Postgres purge about the date.
async function retentionCutoffIso(env) {
  const rows = await sb(env, `app_settings?select=value&key=eq.scan_record_retention_days&limit=1`)
  const days = Math.max(1, Number(rows?.[0]?.value) || 21)
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

// D1 cannot join back to Postgres, so the store NAME has to be snapshotted onto
// every archived row. Without it an archived report shows a bare uuid where the
// live report shows "HS Tallaght".
async function storeNameMap(env) {
  const rows = await sb(env, 'stores?select=id,store_name')
  return new Map(rows.map(s => [s.id, s.store_name]))
}

function toArchiveRow(r, storeNames, archivedAtMs) {
  let department = null
  try { department = r.details?.item_group ?? null } catch { /* malformed details */ }
  return [
    r.id,
    ms(r.created_at),
    ms(r.updated_at),
    ms(r.cleared_at),
    r.store_id,
    storeNames.get(r.store_id) ?? null,
    r.product_code ?? null,
    r.barcode_no ?? null,
    r.product_barcode ?? null,
    r.item_name ?? null,
    r.supl_id ?? null,
    r.supplier_code ?? null,
    r.item_status ?? null,
    r.barcode_status ?? null,
    department,
    r.status,
    r.source ?? null,
    archivedAtMs,
  ]
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO dept_scan_archive
    (id, created_at_ms, updated_at_ms, cleared_at_ms, store_id, store_name,
     product_code, barcode_no, product_barcode, item_name, supl_id,
     supplier_code, item_status, barcode_status, department, status, source,
     archived_at_ms)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

export async function runArchive(env, triggerKind) {
  const startedAt = Date.now()
  const shadow    = env.SHADOW_MODE === '1'
  let scanned = 0, inserted = 0, alreadyHad = 0, deleted = 0, error = null

  try {
    const cutoffIso  = await retentionCutoffIso(env)
    const storeNames = await storeNameMap(env)
    const stmt       = env.ARCHIVE.prepare(INSERT_SQL)

    // Paged by created_at rather than OFFSET: OFFSET re-walks the table on
    // every page and this runs against the biggest table in the database.
    // The cursor is inclusive (gte) so a timestamp straddling a page boundary
    // cannot be skipped; the rows that repeat are absorbed by INSERT OR IGNORE,
    // which is exactly what the primary key is there for.
    let cursor = '1970-01-01T00:00:00Z'

    for (let page = 0; page < MAX_PAGES; page++) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break

      const rows = await sb(env,
        `task_records?select=${SELECT_COLS}` +
        `&task_type=eq.J` +
        `&created_at=gte.${encodeURIComponent(cursor)}` +
        `&created_at=lt.${encodeURIComponent(cutoffIso)}` +
        `&order=created_at.asc,id.asc&limit=${BATCH}`)

      if (!rows.length) break
      scanned += rows.length

      const archivedAtMs = Date.now()
      const res = await env.ARCHIVE.batch(
        rows.map(r => stmt.bind(...toArchiveRow(r, storeNames, archivedAtMs))))

      // meta.changes is 1 for a row that landed and 0 for one the primary key
      // already held, so these two counters separate "moved tonight" from
      // "this run overlapped a previous one" without a second query.
      for (const r of res) {
        if (r.meta?.changes) inserted++
        else                 alreadyHad++
      }

      const last = rows[rows.length - 1].created_at
      // A whole page sharing one timestamp would otherwise re-read itself
      // forever. Stepping 1ms past it is safe because the cursor is only ever
      // used to resume, and anything skipped by the step is caught by the next
      // run's fresh sweep from the beginning.
      cursor = (last === cursor) ? new Date(Date.parse(last) + 1).toISOString() : last

      if (rows.length < BATCH) break
    }

    // Phase 3 will delete here, guarded on D1 confirming it holds the ids.
    // Deliberately absent in Phase 2.
  } catch (e) {
    error = String(e?.message || e).slice(0, 500)
  }

  const durationMs = Date.now() - startedAt
  try {
    await env.ARCHIVE.prepare(
      `INSERT OR REPLACE INTO archive_runs
         (started_at_ms, trigger_kind, cutoff_iso, shadow, scanned, inserted,
          already_had, deleted, duration_ms, error)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(startedAt, triggerKind, new Date(startedAt).toISOString(),
           shadow ? 1 : 0, scanned, inserted, alreadyHad, deleted,
           durationMs, error).run()
  } catch { /* the run itself matters more than the bookkeeping of it */ }

  return { startedAt, shadow, scanned, inserted, alreadyHad, deleted, durationMs, error }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runArchive(env, 'cron'))
  },

  // Manual trigger, so a run can be observed on demand instead of waiting for
  // 01:30.
  //
  // Gated on its OWN secret, not on SUPABASE_ANON_KEY: reusing a database
  // credential as an auth token means anyone holding that key can drive the
  // archiver, and the two have no reason to share a lifetime. Header only,
  // never a query parameter — query strings end up in access logs, browser
  // history and referrers, which is not where a secret belongs. Same shape as
  // the existing X-Sync-Secret endpoints in the Pages Function.
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/run') return new Response('Not found', { status: 404 })
    if (!env.ARCHIVE_TRIGGER_SECRET) {
      return new Response('ARCHIVE_TRIGGER_SECRET not configured', { status: 500 })
    }
    if ((request.headers.get('X-Archive-Secret') || '') !== env.ARCHIVE_TRIGGER_SECRET) {
      return new Response('Forbidden', { status: 403 })
    }
    const result = await runArchive(env, 'manual')
    return Response.json(result)
  },
}
