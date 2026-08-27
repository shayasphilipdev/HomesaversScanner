// Local drafts for in-progress store-task answers.
//
// Store-task answers live in React state and are only persisted by the single
// PATCH /store-tasks/:id/complete. That is fine for a tick-box checklist, but an
// expiry sweep is 20–40 scans over many minutes on a shop-floor tablet — a
// reload, a locked screen or a stray navigation loses the lot.
//
// This keeps a per-user, per-instance copy in localStorage as the operator
// works, and drops it once the task is submitted.
//
// Deliberately NOT lib/outbox.js: that is a *send queue* whose drain() fires the
// queued request as soon as you are online, so parking a half-finished sweep
// there would auto-submit the task. It also only speaks /api/task-records, would
// inflate the Sync page's "queued" counts, and its IndexedDB API is async so it
// cannot seed a useState initializer.

const PREFIX   = 'hs_stdraft:'
// Drafts self-expire. 14 days sits inside the default photo retention window, so
// a restored draft can never point at a photo the cleanup job has already
// deleted.
const TTL_MS   = 14 * 86400000

// The client session stores the id as `userId` — NOT `user_id`, which is
// undefined on the client (see ProductQuery.jsx, which has that bug). Namespacing
// by user stops two people sharing a tablet from inheriting each other's scans.
const keyFor = (userId, instanceId) => `${PREFIX}${userId || 'anon'}:${instanceId}`

// Remove expired drafts. Cheap, and keeps a shared tablet from accumulating
// months of abandoned sweeps.
export function pruneDrafts(now = Date.now()) {
  try {
    const doomed = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      try {
        const saved = JSON.parse(localStorage.getItem(k))?.savedAt
        if (!saved || now - saved > TTL_MS) doomed.push(k)
      } catch { doomed.push(k) }   // unparseable — drop it
    }
    doomed.forEach(k => localStorage.removeItem(k))
  } catch { /* storage unavailable — nothing to prune */ }
}

// The saved answers for an instance, or null when there is no usable draft.
export function readDraft(userId, instanceId) {
  try {
    const raw = localStorage.getItem(keyFor(userId, instanceId))
    if (!raw) return null
    const env = JSON.parse(raw)
    if (!env || typeof env.answers !== 'object' || env.answers === null) return null
    if (!env.savedAt || Date.now() - env.savedAt > TTL_MS) return null
    return env.answers
  } catch { return null }
}

// Returns false when the write failed (private browsing, storage disabled, quota
// exceeded) so the caller can warn instead of pretending the work is safe.
export function writeDraft(userId, instanceId, answers) {
  try {
    localStorage.setItem(
      keyFor(userId, instanceId),
      JSON.stringify({ answers, savedAt: Date.now() })
    )
    return true
  } catch { return false }
}

export function clearDraft(userId, instanceId) {
  try { localStorage.removeItem(keyFor(userId, instanceId)) } catch { /* ignore */ }
}
