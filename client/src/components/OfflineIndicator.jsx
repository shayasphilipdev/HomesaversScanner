import { useEffect, useState } from 'react'
import { count as outboxCount, drain } from '../lib/outbox.js'
import { useToast } from './Toast.jsx'

// Sits in the top nav. Hidden while online with an empty outbox.
// Shows:  "Offline · N queued"  when offline (any queue size)
//         "Syncing N…"          while a drain is in progress (best-effort)
//         "N queued"            while online with stuff still pending
export default function OfflineIndicator() {
  const toast = useToast()
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(0)
  const [busy,   setBusy]   = useState(false)

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      if (!alive) return
      try { setQueued(await outboxCount()) } catch {}
    }

    const syncNow = async () => {
      if (!navigator.onLine) return
      setBusy(true)
      try {
        const res = await drain()
        if (res?.synced) toast.success(`Synced ${res.synced} queued record${res.synced === 1 ? '' : 's'}.`)
        if (res?.failed) toast.error(`${res.failed} record${res.failed === 1 ? '' : 's'} could not sync yet.`)
      } catch {} finally {
        setBusy(false)
        refresh()
      }
    }

    const onOnline  = () => { setOnline(true);  syncNow() }
    const onOffline = () => { setOnline(false) }
    const onChange  = () => refresh()

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('hs:outbox-changed', onChange)

    refresh()
    // Try once on mount in case we already have queued items
    if (navigator.onLine) syncNow()

    // Light periodic refresh (covers cases where the browser lies about
    // online state for a moment after waking)
    const i = setInterval(refresh, 15000)

    return () => {
      alive = false
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('hs:outbox-changed', onChange)
      clearInterval(i)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (online && queued === 0) return null

  const label = !online
    ? `Offline · ${queued} queued`
    : busy
      ? `Syncing ${queued}…`
      : `${queued} queued`

  const cls = !online ? 'offline-pill offline-pill-off' : 'offline-pill offline-pill-on'

  return <span className={cls} title={online ? 'Will sync automatically' : 'You’re offline — entries will be saved locally'}>{label}</span>
}
