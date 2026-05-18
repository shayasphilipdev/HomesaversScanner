import { Fragment, useState, useEffect, useMemo } from 'react'
import { useStore } from '../App.jsx'
import {
  getStores, getTaskTypes, getToken, getTaskRecords,
  updateTaskRecord, bulkReviewTaskRecords,
  adminListTemplates, getStoreTaskReportRows
} from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'

function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABEL = {
  pending:          { label: 'Pending',          cls: 'badge-pending' },
  completed:        { label: 'Completed by HO',  cls: 'badge-completed' },
  no_change_needed: { label: 'No change needed', cls: 'badge-pending' },
  store_completed:  { label: 'Store confirmed',  cls: 'badge-store-done' }
}

export default function Reports() {
  const [tab, setTab] = useState('hq')
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">{tab === 'hq' ? 'HO task records — error reports from stores' : 'Store tasks — operational checklist completions'}</div>
        </div>
        <div className="flex-row" style={{ gap: 6 }}>
          <button className={`btn btn-sm ${tab === 'hq' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('hq')}>HO records</button>
          <button className={`btn btn-sm ${tab === 'store' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('store')}>Store tasks</button>
        </div>
      </div>
      {tab === 'hq' ? <HQReports /> : <StoreTaskReports />}
    </div>
  )
}

function HQReports() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const now      = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 86400000)
  monthAgo.setHours(0, 0, 0, 0)

  const [from, setFrom]               = useState(toLocalInput(monthAgo))
  const [to, setTo]                   = useState(toLocalInput(now))
  const [storeFilter, setStoreFilter] = useState(isBO ? 'all' : session.storeId)
  const [taskFilter, setTaskFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stores, setStores]           = useState([])
  const [taskTypes, setTaskTypes]     = useState([])

  const [records, setRecords]         = useState([])
  const [storesById, setStoresById]   = useState({})
  const [selected, setSelected]       = useState(new Set())
  const [loading, setLoading]         = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState('')
  const [reviewRowId, setReviewRowId] = useState(null)
  const [reviewNote, setReviewNote]   = useState('')

  useEffect(() => {
    getTaskTypes().then(setTaskTypes).catch(() => setTaskTypes([]))
    if (isBO) {
      getStores().then(rows => {
        setStores(rows)
        setStoresById(Object.fromEntries(rows.map(s => [s.id, s])))
      }).catch(e => setError('Could not load stores: ' + e.message))
    }
  }, [isBO])

  const runReport = async () => {
    setLoading(true); setError(''); setSelected(new Set()); setReviewRowId(null)
    try {
      const data = await getTaskRecords({
        storeId:  storeFilter === 'all' ? undefined : storeFilter,
        taskType: taskFilter === 'all'  ? undefined : taskFilter,
        status:   statusFilter === 'all' ? undefined : statusFilter,
        filters:  { from, to }
      })
      setRecords(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadCSV = async () => {
    setDownloading(true); setError('')
    try {
      const params = new URLSearchParams({ from, to, storeId: storeFilter, task_type: taskFilter })
      const res = await fetch(`/api/reports/task-records?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const blob = await res.blob()
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = `task-records-${taskFilter}-${from.slice(0,10)}-to-${to.slice(0,10)}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  // Selection — only allow selecting pending records (only those need review).
  const pendingIds = useMemo(() => records.filter(r => r.status === 'pending').map(r => r.id), [records])
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every(id => selected.has(id))

  const toggleAllPending = () => {
    if (allPendingSelected) setSelected(new Set())
    else setSelected(new Set(pendingIds))
  }

  const toggleOne = (id) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  // Apply a status change locally and remember how to undo it.
  // Returns a snapshot of the previous record state for the affected ids
  // so the caller can revert on server failure.
  const applyOptimisticReview = (ids, status, note) => {
    const idSet = new Set(ids)
    const now   = new Date().toISOString()
    const prev  = records.map(r => idSet.has(r.id) ? { id: r.id, status: r.status, review_notes: r.review_notes, reviewed_at: r.reviewed_at } : null).filter(Boolean)
    setRecords(rs => rs.map(r => idSet.has(r.id)
      ? { ...r, status, review_notes: note ?? r.review_notes, reviewed_at: now, ...(status === 'completed' ? { completed_at: now } : {}) }
      : r
    ))
    return prev
  }

  const revertOptimistic = (snapshot) => {
    if (!snapshot?.length) return
    const map = new Map(snapshot.map(s => [s.id, s]))
    setRecords(rs => rs.map(r => map.has(r.id) ? { ...r, ...map.get(r.id) } : r))
  }

  const bulkReview = async (status) => {
    if (!selected.size) return
    let note = null
    if (status === 'no_change_needed') {
      note = window.prompt(`Optional note for ${selected.size} record(s) (shown to store):`, '')
      if (note === null) return  // cancel
    }
    const ids = [...selected]
    const n   = ids.length
    const label = status === 'completed' ? 'completed' : 'marked “no change needed”'

    // Update the table instantly, clear selection, show feedback.
    const snapshot = applyOptimisticReview(ids, status, note?.trim() || null)
    setSelected(new Set())
    toast.success(`${n} record${n === 1 ? '' : 's'} ${label}.`)

    // Then sync to server in the background.
    setBusy(true); setError('')
    try {
      await bulkReviewTaskRecords({ ids, status, review_notes: note || null })
    } catch (e) {
      revertOptimistic(snapshot)
      setError(e.message); toast.error(`Reverted — ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const reviewOne = async (id, status) => {
    const note = reviewRowId === id && reviewNote.trim() ? reviewNote.trim() : null
    const snapshot = applyOptimisticReview([id], status, note)
    setReviewRowId(null); setReviewNote('')
    toast.success(status === 'completed' ? 'Marked complete.' : 'Marked “no change needed”.')

    setBusy(true); setError('')
    try {
      await updateTaskRecord(id, {
        status,
        review_notes: note,
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {})
      })
    } catch (e) {
      revertOptimistic(snapshot)
      setError(e.message); toast.error(`Reverted — ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="card">
        <div className="card-body">
          <div className="filter-row">
            <div className="filter-field"><label>From</label>
              <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="filter-field"><label>To</label>
              <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></div>

            {isBO && (
              <div className="filter-field"><label>Store</label>
                <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
                  <option value="all">All stores</option>
                  {stores.filter(s => s.is_active).map(s => (
                    <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                  ))}
                </select></div>
            )}

            <div className="filter-field filter-field--wide"><label>Task Type</label>
              <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}>
                <option value="all">All task types</option>
                {taskTypes.map(t => <option key={t.code} value={t.code}>{t.code} — {t.name}</option>)}
              </select></div>

            <div className="filter-field"><label>Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">Any status</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed by HO</option>
                <option value="no_change_needed">No change needed</option>
                <option value="store_completed">Store confirmed</option>
              </select></div>

            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={runReport} disabled={loading}>
                {loading ? <><span className="spinner" /> Loading…</> : 'Run report'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={downloadCSV} disabled={downloading}>
                {downloading ? <><span className="spinner spinner-dark" /> Preparing…</> : '↓ CSV'}
              </button>
            </div>
          </div>

          {error && <div className="login-error mt-12">{error}</div>}
        </div>
      </div>

      {records.length > 0 && (
        <div className="card mt-20">
          <div className="card-header">
            Results · {records.length} record{records.length !== 1 ? 's' : ''}
            {pendingIds.length > 0 && isBO && (
              <span style={{ marginLeft: 10, fontWeight: 'normal', fontSize: 13, color: 'var(--text-muted)' }}>
                ({pendingIds.length} pending)
              </span>
            )}
          </div>

          {/* Bulk action bar — back office only */}
          {isBO && selected.size > 0 && (
            <div className="flex-row" style={{ padding: '12px 18px', background: 'var(--surface-warm)', borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
              <strong>{selected.size} selected</strong>
              <span style={{ marginLeft: 'auto' }} />
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => bulkReview('completed')}>
                ✓ Mark complete
              </button>
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => bulkReview('no_change_needed')}>
                ⊘ No change needed
              </button>
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isBO && (
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        disabled={!pendingIds.length}
                        onChange={toggleAllPending}
                        title={pendingIds.length ? 'Select all pending' : 'No pending records to select'}
                      />
                    </th>
                  )}
                  <th>Task</th>
                  <th>Store</th>
                  <th>Product</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Date</th>
                  {isBO && <th></th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const status   = STATUS_LABEL[r.status] || STATUS_LABEL.pending
                  const isPending = r.status === 'pending'
                  const desc = r.description || r.product_name_label || ''
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        {isBO && (
                          <td>
                            {isPending && (
                              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                            )}
                          </td>
                        )}
                        <td><strong>{r.task_type}</strong></td>
                        <td>{storesById[r.store_id]?.store_name || <span className="td-muted">—</span>}</td>
                        <td className="td-code">{r.product_code || r.product_barcode || ''}</td>
                        <td>{desc || <span className="td-muted">—</span>}</td>
                        <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                        <td className="td-muted">{formatDT(r.created_at)}</td>
                        {isBO && (
                          <td>
                            {isPending && (
                              <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => reviewOne(r.id, 'completed')}>
                                  Complete
                                </button>
                                <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => { setReviewRowId(r.id); setReviewNote('') }}>
                                  No change
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                      {/* Inline note input for per-row "No change needed" */}
                      {isBO && reviewRowId === r.id && (
                        <tr>
                          <td colSpan={isBO ? 8 : 7} style={{ background: 'var(--surface-warm)' }}>
                            <div className="flex-row" style={{ gap: 6, padding: '6px 0' }}>
                              <input
                                type="text"
                                value={reviewNote}
                                onChange={e => setReviewNote(e.target.value)}
                                placeholder="Note for the store (optional)"
                                style={{ flex: 1 }}
                                autoFocus
                              />
                              <button className="btn btn-sm btn-outline" onClick={() => { setReviewRowId(null); setReviewNote('') }} disabled={busy}>Cancel</button>
                              <button className="btn btn-sm btn-primary" onClick={() => reviewOne(r.id, 'no_change_needed')} disabled={busy}>
                                Save as "No change needed"
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Review-notes echo for records that already have one */}
                      {r.review_notes && !(isBO && reviewRowId === r.id) && (
                        <tr>
                          <td colSpan={isBO ? 8 : 7} style={{ background: 'var(--surface-warm)', fontStyle: 'italic', fontSize: 13, color: 'var(--text-muted)' }}>
                            HO note: {r.review_notes}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Store-task reports (Phase 9F) ───────────────────────────────────────
function StoreTaskReports() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const now      = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 86400000)
  const iso      = d => d.toISOString().slice(0, 10)

  const [from, setFrom]           = useState(iso(monthAgo))
  const [to, setTo]               = useState(iso(now))
  const [storeFilter, setStoreFilter] = useState(isBO ? 'all' : session.storeId)
  const [tplFilter, setTplFilter] = useState('all')
  const [stores, setStores]       = useState([])
  const [templates, setTemplates] = useState([])

  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    if (isBO) getStores().then(setStores).catch(e => setError(e.message))
    adminListTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [isBO])

  const run = async () => {
    setLoading(true); setError('')
    try {
      const data = await getStoreTaskReportRows({
        from, to,
        storeId: storeFilter === 'all' ? undefined : storeFilter,
        template_id: tplFilter === 'all' ? undefined : tplFilter
      })
      setRows(data)
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setLoading(false) }
  }

  const downloadCSV = async () => {
    setDownloading(true); setError('')
    try {
      const params = new URLSearchParams({ from, to, storeId: storeFilter })
      if (tplFilter && tplFilter !== 'all') params.set('template_id', tplFilter)
      const res = await fetch('/api/reports/store-tasks?' + params, { headers: { Authorization: 'Bearer ' + getToken() } })
      if (!res.ok) throw new Error('Server returned ' + res.status)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'store-tasks-' + from + '-to-' + to + '.csv'
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setDownloading(false) }
  }

  const storeName = id => stores.find(s => s.id === id)?.store_name || ''

  return (
    <div>
      <div className="card">
        <div className="card-body">
          <div className="filter-row">
            <div className="filter-field"><label>From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="filter-field"><label>To</label>
              <input type="date" value={to}   onChange={e => setTo(e.target.value)} /></div>
            {isBO && (
              <div className="filter-field"><label>Store</label>
                <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
                  <option value="all">All stores</option>
                  {stores.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                </select></div>
            )}
            <div className="filter-field filter-field--wide"><label>Template</label>
              <select value={tplFilter} onChange={e => setTplFilter(e.target.value)}>
                <option value="all">All templates</option>
                {templates.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select></div>
            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={run} disabled={loading}>
                {loading ? (<><span className="spinner" /> Loading…</>) : 'Run report'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={downloadCSV} disabled={downloading}>
                {downloading ? (<><span className="spinner spinner-dark" /> Preparing…</>) : '↓ CSV'}
              </button>
            </div>
          </div>
          {error && <div className="login-error mt-12">{error}</div>}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card mt-20">
          <div className="card-header">{rows.length} result{rows.length === 1 ? '' : 's'}</div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Template</th><th>Store</th><th>Due</th><th>Status</th>
                <th>Completed at</th><th>Block answers</th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const t = r.store_task_templates || {}
                  const blocks = Array.isArray(t.blocks) ? t.blocks : []
                  const ans = r.answers && typeof r.answers === 'object' ? r.answers : {}
                  const lines = blocks.map(b => {
                    const v = ans[b.id]
                    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null
                    const display = Array.isArray(v) ? v.join(', ') : (typeof v === 'string' && v.startsWith('http') ? '[photo]' : String(v))
                    return b.label + ': ' + display
                  }).filter(Boolean)
                  return (
                    <tr key={r.id}>
                      <td><strong>{t.title || '—'}</strong>{t.category && <span className="chip" style={{ marginLeft: 6 }}>{t.category}</span>}</td>
                      <td>{storeName(r.store_id) || '—'}</td>
                      <td>{r.due_date || '—'}</td>
                      <td><span className={'badge ' + (r.status === 'completed' ? 'badge-completed' : r.status === 'missed' ? 'badge-deleted' : 'badge-pending')}>{r.status}</span></td>
                      <td className="td-muted">{r.completed_at ? new Date(r.completed_at).toLocaleString('en-IE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}</td>
                      <td>{lines.length ? lines.map((l, i) => <div key={i} style={{ fontSize: 13 }}>{l}</div>) : (r.notes ? <span className="note" style={{ fontSize: 12 }}>{r.notes}</span> : <span className="td-muted">—</span>)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
