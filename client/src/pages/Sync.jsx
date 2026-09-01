import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { useToast } from '../components/Toast.jsx'
import { getAll, drain, remove, markRetry, resetFailed } from '../lib/outbox.js'
import { getLog, clearLog, exportLog } from '../lib/deviceLog.js'
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
      if (!navigator.onLine) { toast.error("You're offline — sync will run when you reconnect."); return }
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
      } else toast.info("Will retry when you're back online.")
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
              Any task you save while offline will appear here until it's synced.
            </p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap table-dense">
            <table>
              <thead>
                <tr>
                  <th style={{ minWidth: 100 }}>Task</th>
                  <th>Summary</th>
                  <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>Saved</th>
                  <th style={{ minWidth: 140 }}>Status</th>
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
                      <td style={{ whiteSpace: 'nowrap' }}><strong>{meta.name || it.body?.task_type || '?'}</strong></td>
                      <td>{summary}</td>
                      <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{when}</td>
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
          Tip — sync runs automatically when you're online and when this app comes back to the foreground.
          Use “Sync now” if you want to push immediately.
        </p>
      )}

      <DeviceLogPanel />
    </div>
  )
}

// Recent activity on THIS device. Answers "what actually happened here?" when a
// store reports missing work — whether saves reached the server, queued offline,
// or were never attempted. Local only: never uploaded anywhere.
function DeviceLogPanel() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])

  const refresh = () => setRows(getLog())
  useEffect(() => { if (open) refresh() }, [open])

  const LABEL = {
    'save-ok':             ['Saved to server',     'var(--green)'],
    'save-queued-offline': ['Saved on device only', 'var(--amber)'],
    'save-failed':         ['Save failed',          'var(--red)'],
    'sync':                ['Sync run',             'var(--text-muted)'],
    'sync-failed':         ['Sync failed',          'var(--red)'],
    online:                ['Came online',          'var(--text-muted)'],
    offline:               ['Went offline',         'var(--amber)'],
  }

  return (
    <div className="card mt-20">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="card-header"
        style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 0,
                 cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        aria-expanded={open}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        <span><strong>Activity on this device</strong></span>
        <span className="note" style={{ marginLeft: 'auto', fontSize: 12 }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p className="note" style={{ fontSize: 12, marginTop: 0 }}>
            The last few hundred actions taken on this device. Useful if work seems to have gone
            missing — “Saved on device only” means it never reached the server. Stored on this
            device only and never uploaded.
          </p>

          <div className="flex-row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-outline" onClick={refresh}>↻ Refresh</button>
            <button className="btn btn-sm btn-outline" disabled={!rows.length}
              onClick={async () => {
                try { await navigator.clipboard.writeText(exportLog()); toast.success('Activity copied — you can paste it into an email.') }
                catch { toast.error('Could not copy on this device.') }
              }}>Copy</button>
            <button className="btn btn-sm btn-outline" disabled={!rows.length}
              onClick={() => { if (confirm('Clear the activity log on this device?')) { clearLog(); refresh() } }}>Clear</button>
          </div>

          {!rows.length ? (
            <p className="note" style={{ fontSize: 12.5 }}>Nothing recorded yet on this device.</p>
          ) : (
            <div className="table-wrap table-dense" style={{ maxHeight: 320, overflow: 'auto' }}>
              <table style={{ fontSize: 12 }}>
                <thead><tr>
                  <th style={{ whiteSpace: 'nowrap', minWidth: 130 }}>When</th>
                  <th style={{ minWidth: 130 }}>What</th>
                  <th>Detail</th>
                </tr></thead>
                <tbody>
                  {rows.map((e, i) => {
                    const [label, colour] = LABEL[e.type] || [e.type, 'var(--text-muted)']
                    return (
                      <tr key={i}>
                        <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>
                          {new Date(e.t).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td style={{ color: colour, fontWeight: 600 }}>{label}</td>
                        <td className="td-muted" style={{ wordBreak: 'break-word' }}>
                          {e.d == null ? '' : typeof e.d === 'object'
                            ? Object.entries(e.d).map(([k, v]) => `${k}: ${v}`).join(' · ')
                            : String(e.d)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
