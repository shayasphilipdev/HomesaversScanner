import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminGetCapacity } from '../lib/api.js'
import { useStore } from '../App.jsx'

// Pulsing warning chip shown in the top Nav for admin accounts only.
// Polls /admin/capacity on a long interval and lights up once either the
// database or storage bucket crosses the WARN threshold. Clicking it
// jumps to Admin → Settings where the meters + cleanup actions live.

const WARN_PCT = 70           // amber
const CRIT_PCT = 85           // red + flashing
const POLL_MS  = 10 * 60_000  // 10 minutes — capacity moves slowly

export default function CapacityAlert() {
  const { session } = useStore()
  const isOnlyAdmin = session?.role === 'admin'
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!isOnlyAdmin) return
    let alive = true
    const tick = async () => {
      try {
        const r = await adminGetCapacity()
        if (alive) setStats(r)
      } catch { /* silent — the meter on Settings is the source of truth */ }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [isOnlyAdmin])

  if (!isOnlyAdmin || !stats) return null

  const dbPct      = stats.db.limit_bytes      ? (stats.db.used_bytes      / stats.db.limit_bytes)      * 100 : 0
  const storagePct = stats.storage.limit_bytes ? (stats.storage.used_bytes / stats.storage.limit_bytes) * 100 : 0
  const worst = Math.max(dbPct, storagePct)

  if (worst < WARN_PCT) return null            // quiet state — no chip at all

  const critical = worst >= CRIT_PCT
  const which = dbPct >= storagePct ? 'DB' : 'Storage'

  return (
    <Link
      to="/admin/settings"
      className={`capacity-alert${critical ? ' capacity-alert--crit' : ''}`}
      title={`${which} ${worst.toFixed(1)}% used — click to open Settings`}
    >
      <span aria-hidden style={{ fontSize: 14 }}>⚠️</span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {which} {Math.round(worst)}%
      </span>
    </Link>
  )
}
