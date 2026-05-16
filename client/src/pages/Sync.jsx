import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { useToast } from '../components/Toast.jsx'
import { getAll, drain, remove, markRetry, resetFailed } from '../lib/outbox.js'
import { TASK_FORMS } from '../lib/taskTypes.js'

// Sync inspector. Lists everything currently queued in IndexedDB so the
// user can see, retry, or delete stuck records — the safety valve for
// the "nothing held forever" promise.
//
// Accessible to all signed-in users (store + back office) because the
// queue is per-device, not per-store.
export default function Sync() {
  const { session } = useStore()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  const load = async () => {
    setLoading(true)
    try { setItems(await getAll()) } catch {}
    setLoading(false)
  }

  useEffect(() => {
    load()
    const onChange  = () => load()
    const onOnline  = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('hs:outbox-changed', onChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('hs:outbox-changed', onChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const syncAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      const n = await resetFailed()
      if (n) toast.info(`Retrying ${n} previously failed record${n === 1 ? '' : 's'}…`)
      if (!navigator.onLine) { toast.error('You’re offline — sync will run when you reconnect.'); return }
      const res = await drain()
      if (res?.synced) toast.success(`Synced ${res.synced} record${res.synced === 1 ? '' : 's'}.`)
      if (res?.failed) toast.error(`${res.failed} record${res.failed === 1 ? '' : 's'} still need attention.`)
    } finally {
      setBusy(false)
      load()
    }
  }

  const retryOne = async (id) => {
    setBusy(true)
    try {
      await markRetry(id)
      if (navigator.onLine) {
        const res = await drain()
        if (res?.synced) toast.success('Synced.')
        else if (res?.failed) toast.error('Still failing — server returned an error.')
      } else toast.info('Will retry when you’re back online.')
    } finally {
      setBusy(false)
      load()
    }
  }

  const removeOne = async (id, summary) => {
    if (!confirm(`Remove "${summary}" from the queue? Any photos that were captured will be lost.`)) return
    setBusy(true)
    try { await remove(id); toast.success('Removed from queue.') } finally {
      setBusy(false); load()
    }
  }

  const totalPending = items.filter(i => i.status !== 'failed').length
  const totalFailed  = items.filter(i => i.status === 'failed').length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sync</div>
          <div className="page-subtitle">
            {items.length === 0
              ? 'Everything is synced — nothing waiting on this device.'
              : `${items.length} record${items.length === 1 ? '' : 's'} on this device · ${totalPending} pending${totalFailed ? ` · ${totalFailed} need attention` : ''}`}
          </div>
        </div>
        <div className="flex-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`offline-pill ${online ? 'offline-pill-on' : 'offline-pill-off'}`} style={{ cursor: 'default' }}>
            {online ? '● Online' : '● Offline'}
          </span>
          <button className="btn btn-primary" onClick={syncAll} disabled={busy || items.length === 0}>
            {busy ? <><span className="spinner" /> Working…</> : 'Sync now'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : items.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <p>Nothing queued.</p>
            <p className="note" style={{ marginTop: 6 }}>
              Any task you save while offline will appear here until it’s synced.
            </p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Summary</th>
                  <th>Saved</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const meta = TASK_FORMS[it.body?.task_type] || {}
                  const summary = describe(it)
                  const when = new Date(it.createdAt).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                  const isFailed = it.status === 'failed'
                  return (
                    <tr key={it.id}>
                      <td><strong>{it.body?.task_type || '?'}</strong> <span className="td-muted" style={{ fontSize: 12 }}>{meta.name || ''}</span></td>
                      <td>{summary}</td>
                      <td className="td-muted">{when}</td>
                      <td>
                        {isFailed
                          ? <span className="badge badge-deleted">Needs attention · {it.attempts || 0}/5</span>
                          : it.attempts > 0
                            ? <span className="badge badge-pending">Retrying · {it.attempts}/5</span>
                            : <span className="badge badge-pending">Pending</span>}
                        {it.kind === 'with_photos' && <span className="chip" style={{ marginLeft: 8 }}>📷 2 photos</span>}
                      </td>
                      <td>
                        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => retryOne(it.id)}>Retry</button>
                          <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => removeOne(it.id, summary)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!!items.length && (
        <p className="note mt-20" style={{ fontSize: 12 }}>
          Tip — sync runs automatically when you’re online and when this app comes back to the foreground.
          Use “Sync now” if you want to push immediately.
        </p>
      )}
    </div>
  )
}

// One-liner describing what's in a queued record so the user knows what
// they're looking at without opening it up.
function describe(item) {
  const b = item.body || {}
  const code = b.product_code || b.product_barcode || ''
  const desc = b.description || b.product_name_label || ''
  if (code && desc) return `${code} · ${desc}`
  if (code) return code
  if (desc) return desc
  return '(no product code)'
}
