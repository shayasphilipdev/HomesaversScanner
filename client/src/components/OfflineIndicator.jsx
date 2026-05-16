import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { count as outboxCount, failedCount, drain } from '../lib/outbox.js'
import { useToast } from './Toast.jsx'

// Top-nav pill.
//
// Visible only when something needs surfacing:
//   - offline (any state)
//   - online with queued items
//   - online with failed items (always — even if total queue is small)
//
// Tap → opens the /sync page so the user can see exactly what's queued,
// retry, or remove items. Auto-sync still runs in the background on:
//   - `online` event
//   - `visibilitychange→visible`
//   - first mount when online
export default function OfflineIndicator() {
  const toast = useToast()
  const nav   = useNavigate()
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState(0)
  const [failed, setFailed] = useState(0)

  useEffect(() => {
    let alive = true

    const refresh = async () => {
      if (!alive) return
      try {
        setQueued(await outboxCount())
        setFailed(await failedCount())
      } catch {}
    }

    const sync = async () => {
      if (!navigator.onLine) { await refresh(); return }
      try {
        const res = await drain()
        if (res?.synced) toast.success(`Synced ${res.synced} queued record${res.synced === 1 ? '' : 's'}.`)
      } catch {} finally {
        refresh()
      }
    }

    const onOnline     = () => { setOnline(true);  sync() }
    const onOffline    = () => { setOnline(false); refresh() }
    const onVisibility = () => { if (document.visibilityState === 'visible') sync() }
    const onChange     = () => refresh()

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('hs:outbox-changed', onChange)

    refresh()
    if (navigator.onLine) sync()

    return () => {
      alive = false
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('hs:outbox-changed', onChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (online && queued === 0 && failed === 0) return null

  let label, cls, title
  if (!online) {
    label = `Offline · ${queued} queued${failed ? ` · ${failed} failed` : ''}`
    cls   = 'offline-pill offline-pill-off'
    title = 'Tap to view the queue. Entries will sync when you reconnect.'
  } else if (failed) {
    label = `${failed} need attention${queued - failed > 0 ? ` · ${queued - failed} pending` : ''}`
    cls   = 'offline-pill offline-pill-warn'
    title = 'Tap to view and retry.'
  } else {
    label = `${queued} queued`
    cls   = 'offline-pill offline-pill-on'
    title = 'Tap to view the queue.'
  }

  return (
    <button type="button" className={cls} onClick={() => nav('/sync')} title={title}>
      {label}
    </button>
  )
}
