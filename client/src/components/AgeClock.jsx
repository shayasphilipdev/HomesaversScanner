// A small "how long has this been waiting" chip for open/pending items.
// Cheap by design: the timestamp is already in the row payload, everything
// else is client-side arithmetic — no new API calls, no new columns beyond
// making sure `created_at` is actually selected server-side.
//
// Renders nothing if `at` is missing/invalid, so it is always safe to drop
// into a row without an extra guard at the call site.

export function ageLabel(at) {
  if (!at) return null
  const ms = Date.now() - new Date(at).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

// 'fresh' (quiet) → 'warn' (amber) → 'stale' (red), by hours elapsed.
// Defaults suit a same/next-day retail cadence; pass tighter thresholds for
// same-day work queues (e.g. store tasks due today).
export function ageSeverity(at, { warnHours = 24, staleHours = 72 } = {}) {
  if (!at) return null
  const hrs = (Date.now() - new Date(at).getTime()) / 3600000
  if (!Number.isFinite(hrs) || hrs < 0) return null
  if (hrs >= staleHours) return 'stale'
  if (hrs >= warnHours) return 'warn'
  return 'fresh'
}

export default function AgeClock({ at, warnHours, staleHours, style, title }) {
  const label = ageLabel(at)
  if (!label) return null
  const sev = ageSeverity(at, { warnHours, staleHours })
  return (
    <span
      className={`age-chip age-${sev}`}
      style={style}
      title={title || `Waiting ${label}`}
    >
      ⏱ {label}
    </span>
  )
}
