// Lightweight per-device activity log.
//
// WHY
// ---
// When a store says "we did the checks and now they're gone", there is no way to
// tell what actually happened on their device: whether saves were attempted,
// whether they queued offline, whether a sync failed, or whether the app was
// simply never used. The server only ever sees what arrived.
//
// This keeps a short local trail of app events on the device itself, viewable on
// the Sync page, so that question can be answered from the device rather than
// guessed at.
//
// DESIGN CONSTRAINTS (this is diagnostics, not a feature — it must never be felt)
//   - localStorage stays the source of truth. No IndexedDB transaction, no
//     blocking network call on the save path.
//   - Capped ring buffer, so it can never grow without bound.
//   - Writes are debounced into one flush per tick, so a fast scanning session
//     doesn't touch storage on every keystroke.
//   - Every operation is wrapped: if storage is unavailable (private window,
//     quota, disabled), logging silently does nothing rather than breaking a
//     scan. Nothing in the app may depend on this succeeding.
//
// SERVER MIRROR ("scan doctor")
// ------------------------------
// A local-only log is useless for a store with no one on site who can open
// the Sync page and read it. Each event is also best-effort uploaded to
// POST /api/device-log (see supabase-migration-device-log.sql), tagged with
// this browser's stable device_id (lib/deviceId.js) — so "which gun, which
// department, saved vs queued vs duplicate" becomes a query HQ can run
// remotely instead of a phone call asking someone to read a screen. The
// upload is opportunistic and coalesced (see scheduleUpload below), never
// awaited by the caller, and a failure here is silently swallowed exactly
// like a local storage failure — it costs a diagnostic data point, never a
// scan, which has already been saved/queued by the time this fires.
//
// getToken() is duplicated from api.js (3 lines) rather than imported: api.js
// imports THIS module to call logEvent(), so importing api.js back here would
// be a circular import between the two.
const TOKEN_KEY = 'hs_token'
const getToken  = () => {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) }
  catch { return null }
}

const KEY        = 'hs_device_log'
const SENT_KEY   = 'hs_device_log_sent_until'
const MAX        = 400            // ~400 lines is plenty to explain a shift
const MAX_AGE    = 14 * 86400000  // and drop anything older than a fortnight
const UPLOAD_DEBOUNCE_MS = 4000   // coalesce a scanning burst into one request

let buffer  = null   // in-memory copy; the source of truth while the tab is open
let flushId = null
let uploadTimer = null
let uploading   = false

function load() {
  if (buffer) return buffer
  try {
    const raw = localStorage.getItem(KEY)
    buffer = raw ? JSON.parse(raw) : []
    if (!Array.isArray(buffer)) buffer = []
  } catch { buffer = [] }
  return buffer
}

// One write per tick no matter how many events were logged in it.
function scheduleFlush() {
  if (flushId) return
  flushId = setTimeout(() => {
    flushId = null
    try {
      localStorage.setItem(KEY, JSON.stringify(buffer || []))
    } catch {
      // Quota or storage disabled — drop the oldest half and try once more, so
      // a full disk degrades to a shorter log instead of no log at all.
      try {
        buffer = (buffer || []).slice(-Math.floor(MAX / 2))
        localStorage.setItem(KEY, JSON.stringify(buffer))
      } catch { /* give up silently — diagnostics must never break the app */ }
    }
  }, 0)
}

// Record one event. `type` is a short tag ('scan-save', 'sync', 'error', …),
// `detail` any small JSON-safe extra.
export function logEvent(type, detail) {
  try {
    const b = load()
    b.push({
      t: Date.now(),
      type: String(type).slice(0, 40),
      d: detail === undefined ? null
        : typeof detail === 'object' ? detail
        : String(detail).slice(0, 200)
    })
    // Trim by count and age.
    const cutoff = Date.now() - MAX_AGE
    let start = b.length > MAX ? b.length - MAX : 0
    while (start < b.length && b[start].t < cutoff) start++
    if (start > 0) b.splice(0, start)
    scheduleFlush()
    scheduleUpload()
  } catch { /* never throw from logging */ }
}

// Coalesce a scanning burst (dozens of events/minute) into one request every
// few seconds, rather than one fetch per logEvent() call — this is
// diagnostics riding alongside real scans on the same shop wifi, so it must
// add negligible load of its own.
function scheduleUpload() {
  if (uploadTimer) return
  uploadTimer = setTimeout(() => { uploadTimer = null; uploadNow() }, UPLOAD_DEBOUNCE_MS)
}

// Push every event newer than the last successful upload. Best-effort in
// every sense: no retry loop, no backoff, no queue of its own — if this
// fails (offline, server hiccup, not logged in yet), the events stay in
// localStorage and the NEXT logEvent() or 'online' event tries again with
// whatever has piled up since. sentUntil only advances on a confirmed 2xx,
// so a failed attempt naturally retries the same events next time.
async function uploadNow() {
  if (uploading) return
  const token = getToken()
  if (!token) return   // not logged in (or logged out) — nothing to attribute this to yet
  uploading = true
  try {
    const b = load()
    if (!b.length) return
    let sentUntil = 0
    try { sentUntil = Number(localStorage.getItem(SENT_KEY)) || 0 } catch { /* ignore */ }
    const pending = b.filter(e => e.t > sentUntil)
    if (!pending.length) return

    const { getDeviceId } = await import('./deviceId.js')
    const res = await fetch('/api/device-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device_id: getDeviceId(), events: pending })
    })
    if (res.ok) {
      try { localStorage.setItem(SENT_KEY, String(pending[pending.length - 1].t)) } catch { /* ignore */ }
    }
  } catch { /* offline or unreachable — retried on the next event or reconnect */ }
  finally { uploading = false }
}

// Reconnecting is exactly when a backlog from a dead-wifi aisle most needs to
// go out, so it doesn't sit waiting for the next scan to trigger it.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => uploadNow())
}

// Newest first, for display.
export function getLog() {
  try { return [...load()].reverse() } catch { return [] }
}

export function clearLog() {
  buffer = []
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

// Plain-text dump, so a store can copy or send it when reporting a problem.
export function exportLog() {
  const fmt = t => {
    const d = new Date(t)
    return isNaN(d) ? String(t) : d.toLocaleString('en-IE')
  }
  return getLog()
    .map(e => `${fmt(e.t)}  ${e.type}${e.d ? '  ' + (typeof e.d === 'object' ? JSON.stringify(e.d) : e.d) : ''}`)
    .join('\n')
}
