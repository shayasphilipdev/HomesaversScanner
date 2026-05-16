import { useEffect, useState } from 'react'
import { count as outboxCount, failedCount, drain, resetFailed } from '../lib/outbox.js'
import { useToast } from './Toast.jsx'

// Top-nav pill.
//
// Visible only when something needs surfacing:
//   - offline (any state)
//   - online with queued items
//   - online with failed items (always — even if total queue is small)
//
// Sync triggers (event-driven only, no polling):
//   - `online` event           — auto drain
//   - `visibilitychange→visible` — auto drain (catches "tab was in background")
//   - tap the pill              — manual drain (resets any failed items first)
export default function OfflineIndicator() {
  const toast = useToast()
  const [online, setOnline]   = useState(navigator.onLine)
  const [queued, setQueued]   = useState(0)
  const [failed, setFailed]   = useState(0)
  const [busy,   setBusy]     = useState(false)

  useEffect(() => {
    let alive = true

    const refresh = async () => {
      if (!alive) return
      try {
        setQueued(await outboxCount())
        setFailed(await failedCount())
      } catch {}
    }

    const sync = async (opts = {}) => {
      if (!navigator.onLine) { await refresh(); return }
      setBusy(true)
      try {
        if (opts.resetFailedFirst) {
          const n = await resetFailed()
          if (n) toast.info(`Retrying ${n} previously failed record${n === 1 ? '' : 's'}…`)
        }
        const res = await drain()
        if (res?.synced) toast.success(`Synced ${res.synced} queued record${res.synced === 1 ? '' : 's'}.`)
        if (res?.failed && !res.skipped) toast.error(`${res.failed} record${res.failed === 1 ? '' : 's'} could not sync — will retry.`)
      } catch {} finally {
        setBusy(false)
        await refresh()
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
    if (navigator.onLine) sync()   // first-load drain

    return () => {
      alive = false
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('hs:outbox-changed', onChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = queued
  if (online && total === 0 && failed === 0) return null

  const onClick = async () => {
    if (busy) return
    // Manual sync: reset any failed items first so the user can recover from
    // a transient server hiccup without having to open dev tools.
    setBusy(true)
    try {
      if (failed) {
        const n = await resetFailed()
        if (n) toast.info(`Retrying ${n} previously failed record${n === 1 ? '' : 's'}…`)
      }
      if (navigator.onLine) {
        const res = await drain()
        if (res?.synced) toast.success(`Synced ${res.synced} record${res.synced === 1 ? '' : 's'}.`)
        if (res?.failed && !res.skipped) toast.error(`${res.failed} still failed — try again later.`)
      } else {
        toast.info('You’re offline — will sync when reconnected.')
      }
    } finally {
      setBusy(false)
      setQueued(await outboxCount())
      setFailed(await failedCount())
    }
  }

  let label, cls, title
  if (!online) {
    label = `Offline · ${total} queued${failed ? ` · ${failed} failed` : ''}`
    cls   = 'offline-pill offline-pill-off'
    title = 'You’re offline — entries are saved locally. Tap when back online to retry.'
  } else if (failed) {
    label = `${failed} need attention${queued - failed > 0 ? ` · ${queued - failed} pending` : ''}`
    cls   = 'offline-pill offline-pill-warn'
    title = 'Tap to retry failed records.'
  } else {
    label = busy ? `Syncing ${total}…` : `${total} queued`
    cls   = 'offline-pill offline-pill-on'
    title = 'Tap to sync now.'
  }

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={busy}
      title={title}
    >
      {label}
    </button>
  )
}
