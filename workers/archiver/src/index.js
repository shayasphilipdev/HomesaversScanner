// Department Check archiver.
//
// Moves task_type 'J' records out of Supabase and into the D1 archive once they
// are older than scan_record_retention_days, so the 6-month history the business
// wants can exist without Supabase's 500 MB free tier having to hold it.
//
// THE ARCHIVER NEVER DELETES. Deletion stays with pg_cron's
// purge_old_task_records(); this only says, by stamping task_records.archived_at,
// what D1 is confirmed to be holding. One deleter, one claimer.
//
// env.SHADOW_MODE === '1'  — archive only. Nothing is stamped, so the purge
//   guard has nothing to act on and the pre-archive behaviour continues
//   unchanged. This cannot lose anything that was not already being destroyed
//   nightly, which is what made it safe to point at production first.
//
// env.SHADOW_MODE === '0'  — archive, then stamp archived_at on what landed.
//   Paired with the guarded purge, which refuses to delete a Task J record while
//   archived_at is NULL, this is what turns "the archiver runs at 01:30 and the
//   purge at 02:00" from a convention about clock times into something Postgres
//   enforces. If the archiver stops running, J records accumulate in Supabase --
//   visible, and recoverable -- instead of being silently deleted unarchived.
//
// Scope is EVERY task type as of Phase 2 of the 7-week retention change. It was
// task_type 'J' only until then, which was safe exactly as long as the purge
// also singled J out. Once the purge deletes every type at the same age, a
// J-only archiver would mean every other type is destroyed unarchived -- so the
// two scopes have to move together, and Phase 3 is the commit that moves them.

const BATCH          = 500       // PostgREST caps a page at 1000; 500 keeps each D1 batch modest
const TIME_BUDGET_MS = 180_000   // stop starting new pages after this; the next run picks up the rest
const MAX_PAGES      = 400       // hard backstop against a paging bug looping forever

// The budget was 25s / 60 pages, which was right for a J-only archive in steady
// state (~8,000 records a night, done in under 20 seconds). It is not enough for
// a CATCH-UP: narrowing the Postgres window from 21 days to 14 exposes ~48,000
// records at once, and at ~4,000 per 25-second run that would take a fortnight
// of nights to absorb.
//
// Raising it is safe in every direction that matters:
//   - The work is almost entirely network I/O, not CPU, so a longer wall clock
//     does not approach the Worker CPU limit.
//   - The run is idempotent (INSERT OR IGNORE on the primary key), so being cut
//     off part-way costs nothing -- the next run resumes from the same sweep.
//   - It finishes 30 minutes before the 02:00 purge either way.
//   - Nothing is deleted that this has not archived, so falling behind delays
//     deletion rather than causing loss.
// The real ceiling during catch-up is D1's 100,000 rows/day write limit: each
// record costs 2 writes (table + index), so ~30,000 records is a night's worth
// and the backlog clears in two.

// EVERY column of task_records, for every task type.
//
// This deliberately reverses the original J-only decision. That version selected
// 16 columns because all 163,517 live J rows had the rest NULL, which was true
// and is now the wrong basis: Task B carries description and two photo URLs, A
// carries uom and quantity, D and I carry product_name_label, and completed_at /
// store_completed_at / reviewed_at / review_notes apply to every type -- they
// are empty for J only because nothing ever reviews a Department Check.
//
// Omitted on purpose: messages_resolved_at and messages_resolved_by_name, which
// describe a message thread that is not archived and would mean nothing without
// it.
const SELECT_COLS = [
  'id', 'task_type', 'store_id', 'product_code', 'barcode_no', 'product_barcode',
  'item_name', 'supl_id', 'supplier_code', 'item_status', 'barcode_status',
  'details', 'status', 'source', 'created_at', 'updated_at', 'cleared_at',
  'description', 'uom', 'quantity', 'notes', 'product_name_label',
  'actual_product_name', 'supplier_name_text', 'photo_product_url',
  'photo_barcode_url', 'review_notes', 'reviewed_at', 'completed_at',
  'store_completed_at', 'priced_at', 'pricing_removed_at', 'marked_for_deletion',
].join(',')

const ms = (iso) => (iso ? Date.parse(iso) : null)

// Stamp archived_at on records D1 has confirmed it holds. This is the whole
// point of Phase 3: purge_old_task_records() refuses to delete a Task J record
// while archived_at is NULL, so the archiver running before the purge stops
// being a convention about clock times and becomes something Postgres enforces.
//
// Chunked because PostgREST takes the id list in the URL and a uuid is 36
// characters — 500 of them would be an 18 KB URL. 100 keeps it near 4 KB.
//
// Safe against the stats triggers: trg_task_stats_capture_update early-returns
// unless status or the photo columns change, so stamping this on a three-week-old
// row does not rewrite that day's task_stats_daily counts.
async function markArchived(env, ids, nowIso) {
  const CHUNK = 100
  let marked = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/task_records?id=in.(${slice.join(',')})`, {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ archived_at: nowIso }),
      })
    if (!res.ok) {
      throw new Error(`Supabase PATCH ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    marked += slice.length
  }
  return marked
}

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

// Settings are read from app_settings every run rather than baked in, so
// changing them on the Settings page moves this too and the archiver can never
// disagree with the Postgres purge about a date.
//
// Falls back for anything absent, blank or non-numeric. The Settings endpoint
// range-checks these on write now, but this Worker must not assume it is the
// only writer -- a row edited directly in Postgres bypasses that entirely.
async function settingInt(env, key, fallback) {
  const rows = await sb(env, `app_settings?select=value&key=eq.${key}&limit=1`)
  const n = Number(String(rows?.[0]?.value ?? '').trim())
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

// Stage 1 of the retention chain: how long a record stays in Postgres. The
// archiver and purge_old_task_records() read the SAME key deliberately, so they
// cannot disagree about which records are due to move.
async function retentionCutoffIso(env) {
  const days = await settingInt(env, 'scan_record_retention_days', 21)
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

// Stage 2: how long a record then stays in D1 before being deleted for good.
// Read here in Phase 1 purely so the plumbing is proven before Phase 4 makes it
// delete anything -- runArchive reports it, so a manual run shows whether the
// setting is reaching this Worker at all.
async function archiveRetentionDays(env) {
  return settingInt(env, 'archive_retention_days', 35)
}

// D1 cannot join back to Postgres, so the store NAME has to be snapshotted onto
// every archived row. Without it an archived report shows a bare uuid where the
// live report shows "HS Tallaght".
async function storeNameMap(env) {
  const rows = await sb(env, 'stores?select=id,store_name')
  return new Map(rows.map(s => [s.id, s.store_name]))
}

function toArchiveRow(r, storeNames, archivedAtMs) {
  // `details` is kept WHOLE as JSON text, not flattened. Only J and K put
  // item_group in there; C stores {reason_code, current_price}, E the
  // price_marked_* pair, F {drs_size, units_per_package}, G the promotion_*
  // pair, H {shop_floor_count} and M the five expiry fields the Expiry Overview
  // report reads. The J-only archiver extracted one key and discarded the rest,
  // which for any other type would silently empty those report columns.
  //
  // `department` stays as a cheap pre-extracted copy so Department Check reads
  // -- 97.5% of the archive -- never have to parse JSON.
  let department  = null
  let detailsJson = null
  try {
    department = r.details?.item_group ?? null
    if (r.details != null && Object.keys(r.details).length) {
      detailsJson = JSON.stringify(r.details)
    }
  } catch { /* malformed details must not abort the run */ }

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
    r.task_type,
    r.description ?? null,
    r.uom ?? null,
    r.quantity ?? null,
    r.notes ?? null,
    r.product_name_label ?? null,
    r.actual_product_name ?? null,
    r.supplier_name_text ?? null,
    r.photo_product_url ?? null,
    r.photo_barcode_url ?? null,
    r.review_notes ?? null,
    ms(r.reviewed_at),
    ms(r.completed_at),
    ms(r.store_completed_at),
    ms(r.priced_at),
    ms(r.pricing_removed_at),
    detailsJson,
    r.marked_for_deletion ? 1 : 0,
  ]
}

const INSERT_SQL = `
  INSERT OR IGNORE INTO task_record_archive
    (id, created_at_ms, updated_at_ms, cleared_at_ms, store_id, store_name,
     product_code, barcode_no, product_barcode, item_name, supl_id,
     supplier_code, item_status, barcode_status, department, status, source,
     archived_at_ms, task_type, description, uom, quantity, notes,
     product_name_label, actual_product_name, supplier_name_text,
     photo_product_url, photo_barcode_url, review_notes, reviewed_at_ms,
     completed_at_ms, store_completed_at_ms, priced_at_ms, pricing_removed_at_ms,
     details_json, marked_for_deletion)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

export async function runArchive(env, triggerKind) {
  const startedAt = Date.now()
  const shadow    = env.SHADOW_MODE === '1'
  let scanned = 0, inserted = 0, alreadyHad = 0, deleted = 0, marked = 0, error = null
  let archiveDays = null, cutoffSeen = null

  try {
    const cutoffIso  = await retentionCutoffIso(env)
    cutoffSeen  = cutoffIso
    archiveDays = await archiveRetentionDays(env)
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

      // No task_type filter: the archive now covers EVERY type. Scoping this to
      // 'J' while the purge deletes all types is precisely the failure this
      // phase exists to prevent -- a non-J record would be destroyed having
      // never been archived.
      const rows = await sb(env,
        `task_records?select=${SELECT_COLS}` +
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

      // Only after D1 has committed the batch. D1 batches are atomic, so a
      // resolved batch() means every row in it is durably in the archive --
      // which is the claim archived_at is about to make to Postgres. In shadow
      // mode nothing is marked, so the purge guard has nothing to act on and
      // the old behaviour continues unchanged.
      if (!shadow) {
        marked += await markArchived(env, rows.map(r => r.id), new Date(archivedAtMs).toISOString())
      }

      const last = rows[rows.length - 1].created_at
      // A whole page sharing one timestamp would otherwise re-read itself
      // forever. Stepping 1ms past it is safe because the cursor is only ever
      // used to resume, and anything skipped by the step is caught by the next
      // run's fresh sweep from the beginning.
      cursor = (last === cursor) ? new Date(Date.parse(last) + 1).toISOString() : last

      if (rows.length < BATCH) break
    }

    // Deletion stays with pg_cron's purge_old_task_records(); the archiver
    // never deletes. It only states, via archived_at, what D1 is holding --
    // and the purge decides what to do about that. One deleter, one claimer.
  } catch (e) {
    error = String(e?.message || e).slice(0, 500)
  }

  const durationMs = Date.now() - startedAt
  try {
    await env.ARCHIVE.prepare(
      `INSERT OR REPLACE INTO archive_runs
         (started_at_ms, trigger_kind, cutoff_iso, shadow, scanned, inserted,
          already_had, deleted, marked, duration_ms, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(startedAt, triggerKind, new Date(startedAt).toISOString(),
           shadow ? 1 : 0, scanned, inserted, alreadyHad, deleted, marked,
           durationMs, error).run()
  } catch { /* the run itself matters more than the bookkeeping of it */ }

  // cutoffIso and archiveDays are echoed so a manual run answers "which settings
  // is this Worker actually seeing?" without a second query. They are the two
  // numbers that decide what moves and what is destroyed, and both come from a
  // table something else can edit.
  return {
    startedAt, shadow, scanned, inserted, alreadyHad, deleted, marked,
    durationMs, error,
    cutoffIso:   cutoffSeen,
    archiveDays,
  }
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
    const expected = (env.ARCHIVE_TRIGGER_SECRET || '').trim()
    if (!expected) {
      return new Response('ARCHIVE_TRIGGER_SECRET not configured', { status: 500 })
    }
    // Both sides trimmed. Piping a value into `wrangler secret put` — the
    // obvious way to set one without it passing through a prompt — stores the
    // shell's trailing newline with it, and on Windows that is CRLF. The
    // request header cannot carry that, so the two never match and the only
    // symptom is a 403 that looks exactly like a wrong secret. Whitespace
    // around a secret carries no meaning, so refusing on it is a trap with no
    // upside.
    if ((request.headers.get('X-Archive-Secret') || '').trim() !== expected) {
      return new Response('Forbidden', { status: 403 })
    }
    const result = await runArchive(env, 'manual')
    return Response.json(result)
  },
}
