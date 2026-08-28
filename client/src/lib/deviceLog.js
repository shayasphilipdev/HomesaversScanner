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
//   - localStorage only. No network, no IndexedDB transaction, no server load.
//   - Capped ring buffer, so it can never grow without bound.
//   - Writes are debounced into one flush per tick, so a fast scanning session
//     doesn't touch storage on every keystroke.
//   - Every operation is wrapped: if storage is unavailable (private window,
//     quota, disabled), logging silently does nothing rather than breaking a
//     scan. Nothing in the app may depend on this succeeding.

const KEY      = 'hs_device_log'
const MAX      = 400            // ~400 lines is plenty to explain a shift
const MAX_AGE  = 14 * 86400000  // and drop anything older than a fortnight

let buffer  = null   // in-memory copy; the source of truth while the tab is open
let flushId = null

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
  } catch { /* never throw from logging */ }
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
