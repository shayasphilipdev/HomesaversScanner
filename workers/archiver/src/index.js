// Department Check archiver.
//
// Moves task_type 'J' records out of Supabase and into the D1 archive once they
// are older than scan_record_retention_days, so the 6-month history the business
// wants can exist without Supabase's 500 MB free tier having to hold it.
//
// THE ARCHIVER NEVER DELETES. Deletion stays with pg_cron's
// purge_old_task_records(); this only says, by stamping task_records.d1_copied_at,
// what D1 is confirmed to be holding. One deleter, one claimer.
//
// env.SHADOW_MODE === '1'  — archive only. Nothing is stamped, so the purge
//   guard has nothing to act on and the pre-archive behaviour continues
//   unchanged. This cannot lose anything that was not already being destroyed
//   nightly, which is what made it safe to point at production first.
//
// env.SHADOW_MODE === '0'  — archive, then stamp d1_copied_at on what landed.
//   Paired with the guarded purge, which refuses to delete a Task J record while
//   d1_copied_at is NULL, this is what turns "the archiver runs at 01:30 and the
//   purge at 02:00" from a convention about clock times into something Postgres
//   enforces. If the archiver stops running, J records accumulate in Supabase --
//   visible, and recoverable -- instead of being silently deleted unarchived.
//
// Scope is EVERY task type as of Phase 2 of the 7-week retention change. It was
// task_type 'J' only until then, which was safe exactly as long as the purge
// also singled J out. Once the purge deletes every type at the same age, a
// J-only archiver would mean every other type is destroyed unarchived -- so the
// two scopes have to move together, and Phase 3 is the commit that moves them.

const BATCH          = 1000      // PostgREST's own page cap
const D1_CHUNK       = 500       // statements per D1 batch() call
const TIME_BUDGET_MS = 180_000   // stop starting new pages after this; the next run picks up the rest
const MAX_PAGES      = 400       // hard backstop against a paging bug looping forever

// THE REAL CEILING IS SUBREQUESTS, NOT TIME.
//
// A Cloudflare Worker on the free plan may make 50 subrequests per invocation.
// Every Supabase fetch and every env.ARCHIVE call is one. The 2026-09-25 01:30
// run died on exactly that: 8 pages x (1 GET + 1 D1 batch) + 35 mark PATCHes =
// 51, and it stopped having marked 3,500 of ~50,000 due records -- below the
// 8,000-10,000 a day the chain produces, so it could never have caught up.
// Nothing was ever at risk of deletion (the purge only removes what is marked),
// which is precisely why this could have gone unnoticed for weeks.
//
// Now budgeted explicitly. Per page: 1 Supabase GET + 2 D1 batches = 3, and
// marking is one RPC per FLUSH rather than one PATCH per 100 records.
const SUBREQUEST_BUDGET = 44     // of 50, leaving headroom for retries
const MARK_FLUSH_PAGES  = 4      // pages to accumulate before one mark call

// The budget was 25s / 60 pages, which was right for a J-only archive in steady
// state (~8,000 records a night, done in under 20 seconds). It is not enough for
// a CATCH-UP: narrowing the Postgres window from 21 days to 14 exposes ~48,000
// records at once, and at ~4,000 per 25-second run that would take a fortnight
// of nights to absorb.
//
// Raising it is safe in every direction that matters:
//   - The work is almost entirely network I/O, not CPU, so a longer wall clock
//     does not approach the Worker CPU limit.
//   - The run is idempotent (INSERT OR REPLACE on the primary key), so being cut
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

// Stamp d1_copied_at on records D1 has confirmed it holds. This is the whole
// point of Phase 3: purge_old_task_records() refuses to delete a Task J record
// while d1_copied_at is NULL, so the archiver running before the purge stops
// being a convention about clock times and becomes something Postgres enforces.
//
// Chunked because PostgREST takes the id list in the URL and a uuid is 36
// characters — 500 of them would be an 18 KB URL. 100 keeps it near 4 KB.
//
// Safe against the stats triggers: trg_task_stats_capture_update early-returns
// unless status or the photo columns change, so stamping this on a three-week-old
// row does not rewrite that day's task_stats_daily counts.
async function markArchived(env, ids, nowIso) {
  if (!ids.length) return 0
  // ONE subrequest regardless of how many ids. The previous version PATCHed
  // PostgREST in chunks of 100 because a uuid is 36 characters and 500 of them
  // is an 18 KB URL -- correct about the URL, but it made marking cost one
  // subrequest per hundred records, which is what exhausted the Worker's
  // 50-subrequest budget. An RPC takes the array in the BODY, so the URL length
  // problem disappears along with the chunking.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mark_archived_ids`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      ...sbBearer(env.SUPABASE_ANON_KEY),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_ids: ids, p_at: nowIso }),
  })
  if (!res.ok) {
    throw new Error(`Supabase mark_archived_ids ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  // The function only stamps rows still NULL, so a re-run reports 0 rather than
  // double-counting. Claim what we asked to mark, not what it changed.
  await res.json().catch(() => null)
  return ids.length
}

// Stage 3: delete from D1 what has outlived the whole chain.
//
// The cutoff is measured from created_at and spans BOTH stages -- a record's
// total life is scan_record_retention_days + archive_retention_days, which is
// the "7 weeks" the business asked for and what the Archive button promises the
// user. Measuring the D1 window from the copy time instead would make total life
// depend on when the archiver happened to get to a row, so a night the Worker
// missed would silently extend that record's life.
//
// Chunked, and capped per run. A plain `DELETE WHERE created_at_ms < ?` is
// correct and would normally touch ~8,000 rows a night, but if the deleter were
// ever off for a long stretch the catch-up could blow through D1's 100,000
// rows/day write limit in a single statement -- and past that limit the free
// plan FAILS queries rather than warning, which would take the archiver's
// inserts down with it.
//
// Fewer, BIGGER chunks than the first version (was 20 x 1,000). Each chunk is a
// SUBREQUEST, and reserving 20 of a 50-subrequest budget for a purge that
// usually has nothing to do starved the archiving loop -- the half that cannot
// afford to fall behind. 4 x 5,000 keeps the same 20,000-row ceiling for a
// quarter of the budget.
//
// Row-value IN is used because the table is WITHOUT ROWID, so there is no rowid
// to limit on; (created_at_ms, id) is the primary key and the physical order, so
// each chunk is a contiguous read.
const PURGE_CHUNK      = 5000
const PURGE_MAX_CHUNKS = 4       // 20,000 rows/run ceiling = 40,000 D1 writes

async function purgeArchive(env, cutoffMs) {
  let purged = 0
  for (let i = 0; i < PURGE_MAX_CHUNKS; i++) {
    const res = await env.ARCHIVE.prepare(
      `DELETE FROM task_record_archive
        WHERE (created_at_ms, id) IN (
          SELECT created_at_ms, id FROM task_record_archive
           WHERE created_at_ms < ?
           ORDER BY created_at_ms ASC, id ASC
           LIMIT ?)`).bind(cutoffMs, PURGE_CHUNK).run()
    const n = res?.meta?.changes ?? 0
    purged += n
    if (n < PURGE_CHUNK) break
  }
  return purged
}

// Device-log retention. The diagnostic log (device_log_events) has no business
// value past a few weeks and, unlike the archive, nothing else ever deletes from
// it -- so without this it grows forever. Delete rows older than the cutoff,
// chunked, same shape as purgeArchive but keyed on id (this table has a rowid).
//
// No ORDER BY: the oldest rows have the lowest rowids (AUTOINCREMENT, inserted
// first), so `received_at_ms < ? LIMIT n` finds them at the front of the table
// and stops -- it reads ~CHUNK rows per pass, not the whole table, even without
// an index on received_at_ms (there are deliberately no indexes here anymore).
const DEVICE_LOG_PURGE_CHUNK      = 5000
const DEVICE_LOG_PURGE_MAX_CHUNKS = 4   // 20,000 rows/run ceiling

async function purgeDeviceLog(env, cutoffMs) {
  let purged = 0
  for (let i = 0; i < DEVICE_LOG_PURGE_MAX_CHUNKS; i++) {
    const res = await env.ARCHIVE.prepare(
      `DELETE FROM device_log_events
        WHERE id IN (
          SELECT id FROM device_log_events
           WHERE received_at_ms < ?
           LIMIT ?)`).bind(cutoffMs, DEVICE_LOG_PURGE_CHUNK).run()
    const n = res?.meta?.changes ?? 0
    purged += n
    if (n < DEVICE_LOG_PURGE_CHUNK) break
  }
  return purged
}

async function sb(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      ...sbBearer(env.SUPABASE_ANON_KEY),
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

// The two stages of the retention chain, read together so one run can never
// apply a stale value of one against a fresh value of the other.
//
//   created ──[ retentionDays ]──► D1 ──[ archiveDays ]──► deleted
//
// retentionDays is the SAME key purge_old_task_records() reads, deliberately, so
// the archiver and the Postgres purge cannot disagree about which records are
// due to move.
async function retentionSettings(env) {
  const retentionDays = await settingInt(env, 'scan_record_retention_days', 21)
  const archiveDays   = await settingInt(env, 'archive_retention_days', 35)
  // Department Check (task_type 'J') moves to D1 on its OWN, shorter window.
  // Absent/invalid falls back to the shared window, matching purge_old_task_records()
  // exactly -- the archiver and the Postgres purge must never disagree about
  // which records are due, or the purge would delete something the archiver has
  // not yet copied (guarded against by d1_copied_at either way, but they should
  // agree on principle).
  const deptDays = await settingInt(env, 'dept_check_retention_days', retentionDays)
  // Device-log retention is independent of the record-archive windows -- it is a
  // diagnostic log, not business data. Default 21 days.
  const deviceLogDays = await settingInt(env, 'device_log_retention_days', 21)
  return {
    retentionDays,
    archiveDays,
    deptDays,
    deviceLogDays,
    // Non-J records older than this move from Postgres to D1.
    cutoffIso:     new Date(Date.now() - retentionDays * 86_400_000).toISOString(),
    // Department Check records older than this move -- typically sooner.
    deptCutoffIso: new Date(Date.now() - deptDays * 86_400_000).toISOString(),
    // Records older than this leave D1 for good. created_at-based and the SAME
    // for every type (retention+archive), so total life stays 49 days across the
    // board -- only the Postgres->D1 split day differs by type.
    purgeMs:       Date.now() - (retentionDays + archiveDays) * 86_400_000,
    // device_log_events received before this are deleted from D1.
    deviceLogPurgeMs: Date.now() - deviceLogDays * 86_400_000,
  }
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
  INSERT OR REPLACE INTO task_record_archive
    (id, created_at_ms, updated_at_ms, cleared_at_ms, store_id, store_name,
     product_code, barcode_no, product_barcode, item_name, supl_id,
     supplier_code, item_status, barcode_status, department, status, source,
     d1_copied_at_ms, task_type, description, uom, quantity, notes,
     product_name_label, actual_product_name, supplier_name_text,
     photo_product_url, photo_barcode_url, review_notes, reviewed_at_ms,
     completed_at_ms, store_completed_at_ms, priced_at_ms, pricing_removed_at_ms,
     details_json, marked_for_deletion)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

// opts.maxRecords caps how many records this run may move (the allowance-
// limited extra run); opts.skipPurge leaves both D1 purges to the 01:30 runs.

// ── One-off (2026-11-10): bring PENDING HO-review records back from D1 ──────
//
// Until 2026-11-10 every record left Postgres after 14 days, pending or not.
// From now on a pending HO-review record (not J/K/M/H) stays in Postgres until
// its total life is up, where it can still be reviewed, assigned and messaged.
// The ones moved BEFORE that change are copied back here once (same id, not
// marked as copied) and then removed from D1, so each record lives in exactly
// one place. Guarded by a row in maintenance_flags so it runs once.
const RESTORE_FLAG = 'restore_pending_ho_v1'

async function restorePendingHO(env, purgeMs) {
  const done = await env.ARCHIVE.prepare('SELECT 1 FROM maintenance_flags WHERE key = ?')
    .bind(RESTORE_FLAG).first().catch(() => null)
  if (done) return { restored: 0, calls: 1 }
  const res = await env.ARCHIVE.prepare(
    `SELECT * FROM task_record_archive
      WHERE created_at_ms >= ? AND status = 'pending'
        AND task_type NOT IN ('J','K','M','H')
      ORDER BY created_at_ms LIMIT 500`).bind(purgeMs).all()
  const rows = res?.results || []
  const iso = ms => (ms == null ? null : new Date(Number(ms)).toISOString())
  if (rows.length) {
    const body = rows.map(r => {
      let details = {}
      try { details = r.details_json ? JSON.parse(r.details_json) : {} } catch { details = {} }
      if ((!details || !Object.keys(details).length) && r.department) details = { item_group: r.department }
      return {
        id: r.id, store_id: r.store_id, product_code: r.product_code, description: r.description,
        uom: r.uom, quantity: r.quantity, status: r.status, marked_for_deletion: !!r.marked_for_deletion,
        completed_at: iso(r.completed_at_ms), store_completed_at: iso(r.store_completed_at_ms),
        created_at: iso(r.created_at_ms), updated_at: iso(r.updated_at_ms || r.created_at_ms),
        task_type: r.task_type, supplier_name_text: r.supplier_name_text, notes: r.notes,
        product_barcode: r.product_barcode, product_name_label: r.product_name_label,
        photo_product_url: r.photo_product_url, photo_barcode_url: r.photo_barcode_url,
        details: details || {}, review_notes: r.review_notes, reviewed_at: iso(r.reviewed_at_ms),
        cleared_at: iso(r.cleared_at_ms), barcode_no: r.barcode_no, item_name: r.item_name,
        supl_id: r.supl_id, supplier_code: r.supplier_code, item_status: r.item_status,
        barcode_status: r.barcode_status, actual_product_name: r.actual_product_name,
        priced_at: iso(r.priced_at_ms), pricing_removed_at: iso(r.pricing_removed_at_ms),
        source: r.source, d1_copied_at: null,
      }
    })
    const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/task_records?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY, ...sbBearer(env.SUPABASE_ANON_KEY),
        'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify(body),
    })
    if (!ins.ok) throw new Error(`restore insert ${ins.status}: ${(await ins.text()).slice(0, 300)}`)
    // Only after Postgres has them: remove the D1 copies.
    const ids = rows.map(r => r.id)
    await env.ARCHIVE.prepare(
      `DELETE FROM task_record_archive WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run()
  }
  if (rows.length < 500) {
    await env.ARCHIVE.prepare('INSERT OR REPLACE INTO maintenance_flags (key, done_at_ms, note) VALUES (?,?,?)')
      .bind(RESTORE_FLAG, Date.now(), `restored ${rows.length} pending HO records`).run()
  }
  return { restored: rows.length, calls: 5 }
}

export async function runArchive(env, triggerKind, opts = {}) {
  const maxRecords = Number.isFinite(opts.maxRecords) ? opts.maxRecords : Infinity
  const skipPurge  = !!opts.skipPurge
  const startedAt = Date.now()
  const shadow    = env.SHADOW_MODE === '1'
  let scanned = 0, inserted = 0, alreadyHad = 0, deleted = 0, marked = 0, error = null
  let purged = 0, deviceLogPurged = 0
  let archiveDays = null, retentionDays = null, cutoffSeen = null

  try {
    const cfg = await retentionSettings(env)
    retentionDays = cfg.retentionDays
    archiveDays   = cfg.archiveDays
    cutoffSeen    = cfg.cutoffIso
    const cutoffIso     = cfg.cutoffIso      // non-J move cutoff (e.g. 14 days)
    const deptCutoffIso = cfg.deptCutoffIso  // Department Check move cutoff (e.g. 7 days)
    // One-off restore (see restorePendingHO). Never blocks the archive run.
    let restored = 0, restoreCalls = 0
    if (!shadow) {
      try { ({ restored, calls: restoreCalls } = await restorePendingHO(env, cfg.purgeMs)) }
      catch (e) { restoreCalls = 5; error = `restore: ${String(e?.message || e).slice(0, 300)}` }
    }
    if (restored) console.log(`restored ${restored} pending HO records from D1`)
    const storeNames = await storeNameMap(env)
    const stmt       = env.ARCHIVE.prepare(INSERT_SQL)

    // Paged by created_at rather than OFFSET: OFFSET re-walks the table on
    // every page and this runs against the biggest table in the database.
    // The cursor is inclusive (gte) so a timestamp straddling a page boundary
    // cannot be skipped; the rows that repeat are absorbed by INSERT OR IGNORE,
    // which is exactly what the primary key is there for.
    let cursor = '1970-01-01T00:00:00Z'

    // Subrequests already spent: 3 settings reads (scan/archive/dept) + 1 stores read.
    let subreq = 4 + (opts.subrequestsUsed || 0) + restoreCalls   // + analytics call, + one-off restore
    // Ids archived but not yet stamped. Flushed every MARK_FLUSH_PAGES so one
    // mark call covers several pages. Unflushed ids are simply re-archived next
    // run (INSERT OR IGNORE), so losing them costs nothing but a repeat.
    let pending = []
    const flushMarks = async () => {
      if (shadow || !pending.length) return
      const ids = pending; pending = []
      marked += await markArchived(env, ids, new Date().toISOString())
      subreq += 1
    }

    for (let page = 0; page < MAX_PAGES; page++) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break
      // Stop BEFORE a page that cannot be paid for. One page costs 1 GET plus
      // ceil(BATCH/D1_CHUNK) D1 calls, and we must still afford a final mark,
      // the D1 purge and the run-log write. Running out mid-page is what killed
      // the 2026-09-25 run.
      const pageCost = 1 + Math.ceil(BATCH / D1_CHUNK)
      const purgeCost = skipPurge ? 0 : PURGE_MAX_CHUNKS + DEVICE_LOG_PURGE_MAX_CHUNKS
      if (subreq + pageCost + 1 + purgeCost + 1 > SUBREQUEST_BUDGET) break
      const want = Math.min(BATCH, maxRecords - scanned)
      if (want <= 0) break

      // EVERY type is archived, but Department Check (J) moves on a shorter
      // window than the rest -- so "due to move" is per-type and must match
      // purge_old_task_records() exactly: J older than deptCutoffIso, or any
      // other type older than cutoffIso. Scoping this to one type while the
      // purge deletes another is precisely the failure the archive guard exists
      // to prevent -- a record would be destroyed having never been archived.
      // store_id must be present. D1's task_record_archive.store_id is NOT NULL,
      // so a row whose store_id is NULL (only possible if a store is hard-DELETEd
      // in Postgres -- ON DELETE SET NULL; no app route does this) is silently
      // skipped by INSERT OR IGNORE with meta.changes=0. Because ids are queued
      // for marking per page rather than per confirmed insert, such a row would
      // be marked d1_copied_at and then purged -- deleted from Postgres having
      // never reached D1. Excluding it here keeps it in Postgres (unarchived,
      // unmarked, never purged): visible and recoverable, the safe direction.
      const rows = await sb(env,
        `task_records?select=${SELECT_COLS}` +
        `&created_at=gte.${encodeURIComponent(cursor)}` +
        `&store_id=not.is.null` +
        // Only records not yet copied (or changed since: a trigger clears
        // d1_copied_at on any edit). Without this the 01:30 run re-read
        // everything the 22:30 run had copied but the purge had not removed yet.
        `&d1_copied_at=is.null` +
        `&or=(and(task_type.eq.J,created_at.lt.${encodeURIComponent(deptCutoffIso)}),` +
        `and(task_type.neq.J,created_at.lt.${encodeURIComponent(cutoffIso)},` +
        // 2026-11-10: a PENDING HO-review record (not the stores' own K/M/H)
        // stays in Postgres -- where it can still be reviewed, assigned and
        // messaged -- until its total life is up. Must match
        // purge_old_task_records(), which keeps it for the same reason.
        `or(status.neq.pending,task_type.in.(K,M,H),created_at.lt.${encodeURIComponent(new Date(cfg.purgeMs).toISOString())})))` +
        `&order=created_at.asc,id.asc&limit=${want}`)

      subreq += 1
      if (!rows.length) break
      scanned += rows.length

      const archivedAtMs = Date.now()
      const bound = rows.map(r => stmt.bind(...toArchiveRow(r, storeNames, archivedAtMs)))
      for (let i = 0; i < bound.length; i += D1_CHUNK) {
        const res = await env.ARCHIVE.batch(bound.slice(i, i + D1_CHUNK))
        subreq += 1
        // meta.changes is 1 for a row that landed and 0 for one the primary key
        // already held, so these two counters separate "moved tonight" from
        // "this run overlapped a previous one" without a second query.
        for (const r of res) {
          if (r.meta?.changes) inserted++
          else                 alreadyHad++
        }
      }

      // Queued only after D1 has committed. D1 batches are atomic, so a resolved
      // batch() means every row in it is durably in the archive -- which is the
      // claim d1_copied_at is about to make to Postgres. In shadow mode nothing
      // is marked, so the purge guard has nothing to act on and the old
      // behaviour continues unchanged.
      pending.push(...rows.map(r => r.id))
      if (pending.length >= MARK_FLUSH_PAGES * BATCH) await flushMarks()

      const last = rows[rows.length - 1].created_at
      // A whole page sharing one timestamp would otherwise re-read itself
      // forever. Stepping 1ms past it is safe because the cursor is only ever
      // used to resume, and anything skipped by the step is caught by the next
      // run's fresh sweep from the beginning.
      cursor = (last === cursor) ? new Date(Date.parse(last) + 1).toISOString() : last

      if (rows.length < want) break
    }
    await flushMarks()

    // Deletion from POSTGRES stays with pg_cron's purge_old_task_records(); the
    // archiver never deletes there. It only states, via d1_copied_at, what D1 is
    // holding -- and the purge decides what to do about that. One deleter, one
    // claimer.
    //
    // D1 is the other half, and it is this Worker's alone: nothing else can
    // reach the archive, so without the call below the archive grew forever.
    // That was the gap that made "keep 6 months and purge after that" only half
    // implemented.
    //
    // Deliberately AFTER the sweep and inside the same try: if archiving failed
    // this run, skip the deletion too. A broken archiver is a reason to stop
    // destroying things, not to carry on.
    if (!shadow && !skipPurge) {
      purged = await purgeArchive(env, cfg.purgeMs)
      // Device-log retention. Independent of the archive window and cheap (the
      // oldest rows sit at the front of the table), but still inside !shadow:
      // shadow mode means "destroy nothing", and this destroys diagnostic rows.
      deviceLogPurged = await purgeDeviceLog(env, cfg.deviceLogPurgeMs)
    }
  } catch (e) {
    error = String(e?.message || e).slice(0, 500)
  }

  const durationMs = Date.now() - startedAt
  try {
    await env.ARCHIVE.prepare(
      `INSERT OR REPLACE INTO archive_runs
         (started_at_ms, trigger_kind, cutoff_iso, shadow, scanned, inserted,
          already_had, deleted, marked, purged, duration_ms, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(startedAt, triggerKind, new Date(startedAt).toISOString(),
           shadow ? 1 : 0, scanned, inserted, alreadyHad, deleted, marked,
           purged, durationMs, error).run()
  } catch { /* the run itself matters more than the bookkeeping of it */ }

  // The settings are echoed so a manual run answers "which values is this Worker
  // actually seeing?" without a second query. They are the numbers that decide
  // what moves and what is destroyed, and both come from a table something else
  // can edit.
  //
  // `deleted` is rows removed from POSTGRES and is always 0 -- the archiver does
  // not delete there. `purged` is rows removed from D1, which it does.
  return {
    startedAt, shadow, scanned, inserted, alreadyHad, deleted, marked, purged,
    deviceLogPurged,
    durationMs, error,
    cutoffIso:    cutoffSeen,
    retentionDays,
    archiveDays,
    totalLifeDays: (retentionDays != null && archiveDays != null)
      ? retentionDays + archiveDays
      : null,
  }
}

// SUPABASE_ANON_KEY may be the legacy JWT anon key (eyJ...) or a new non-JWT
// key (sb_secret_...). New keys go on `apikey` only; Supabase rejects them in
// `Authorization: Bearer`. So Bearer is sent for JWTs only.
function sbBearer(key) {
  return typeof key === 'string' && key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}
}


// ── Third, allowance-limited run (22:30 UTC) ────────────────────────────────
//
// The two 01:30/01:45 runs move ~18,000 records a night, which fell behind the
// Department Check volume of early Nov 2026. A third run at the END of the UTC
// day can use whatever is left of the day's D1 write allowance (100,000 rows
// written per UTC day on the free plan): it asks Cloudflare's analytics how
// many rows have been written today, keeps a reserve for the rest of the day,
// and moves only as many records as the remainder pays for. It never purges
// (those writes stay with the 01:30 run, on the next day's allowance). If the
// usage cannot be read, it does nothing -- the safe direction.
const EXTRA_CRON          = '30 22 * * *'
const D1_DAILY_WRITE_CAP  = 100_000
const WRITE_RESERVE       = 10_000   // late-evening device logs etc. + analytics lag
const WRITES_PER_RECORD   = 3        // row + index, rounded UP from the ~2 observed

async function d1RowsWrittenToday(env) {
  // Trimmed: a secret pasted on Windows can carry a trailing CR/LF, which makes
  // the Authorization header invalid and Cloudflare answers a bare 400
  // (what the first 22:30 run on 2026-11-10 got).
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!token || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not configured')
  }
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const query = `query ($a: string, $db: string, $since: string, $until: string) {
    viewer { accounts(filter: { accountTag: $a }) {
      d1AnalyticsAdaptiveGroups(limit: 1000,
        filter: { databaseId: $db, datetime_geq: $since, datetime_leq: $until }) {
        dimensions { date } sum { rowsWritten } } } } }`
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: {
      a: env.CLOUDFLARE_ACCOUNT_ID, db: env.D1_ARCHIVE_DATABASE_ID,
      since: since.toISOString(), until: now.toISOString() } }),
  })
  const text = await res.text().catch(() => '')
  let j = null
  try { j = JSON.parse(text) } catch { j = null }
  if (!res.ok || !j || j.errors || !j.data) {
    throw new Error(`D1 analytics failed: ${res.status} ${JSON.stringify(j?.errors || text).slice(0, 300)}`)
  }
  const groups = j.data.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups || []
  return groups.reduce((t, g) => t + (g.sum?.rowsWritten || 0), 0)
}

export async function runExtra(env, triggerKind = 'extra') {
  let written
  try {
    written = await d1RowsWrittenToday(env)
  } catch (e) {
    const error = `extra run skipped: ${String(e?.message || e).slice(0, 400)}`
    try {
      await env.ARCHIVE.prepare(
        `INSERT OR REPLACE INTO archive_runs
           (started_at_ms, trigger_kind, cutoff_iso, shadow, scanned, inserted,
            already_had, deleted, marked, purged, duration_ms, error)
         VALUES (?,?,?,?,0,0,0,0,0,0,0,?)`
      ).bind(Date.now(), triggerKind, new Date().toISOString(), env.SHADOW_MODE === '1' ? 1 : 0, error).run()
    } catch { /* bookkeeping only */ }
    return { skipped: true, error }
  }
  const left = D1_DAILY_WRITE_CAP - WRITE_RESERVE - written
  const maxRecords = Math.floor(left / WRITES_PER_RECORD)
  if (maxRecords < 500) {
    return { skipped: true, rowsWrittenToday: written, reason: 'not enough of today\'s allowance left' }
  }
  const result = await runArchive(env, triggerKind, { maxRecords, skipPurge: true, subrequestsUsed: 1 })
  return { ...result, rowsWrittenToday: written, maxRecords }
}

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron === EXTRA_CRON) ctx.waitUntil(runExtra(env, 'extra'))
    else                                ctx.waitUntil(runArchive(env, 'cron'))
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
    const result = (request.headers.get('X-Archive-Mode') || '').trim() === 'extra'
      ? await runExtra(env, 'manual-extra')
      : await runArchive(env, 'manual')
    return Response.json(result)
  },
}
