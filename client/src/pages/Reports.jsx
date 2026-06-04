import { Fragment, useState, useEffect, useMemo } from 'react'
import { useStore } from '../App.jsx'
import {
  getStores, getTaskTypes, getToken, getTaskRecords,
  updateTaskRecord, bulkReviewTaskRecords,
  adminListTemplates, getStoreTaskReportRows,
  getTaskRecordEvents, clearToken, getProductMaster, getProductMasterFilters
} from '../lib/api.js'
import { TASK_FORMS } from '../lib/taskTypes.js'
import { downloadExcel } from '../lib/excel.js'
import { useToast } from '../components/Toast.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import AdminReports from './AdminReports.jsx'
import { canAccessMasterReports } from '../lib/roles.js'

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
  store_completed:  { label: 'Store confirmed',  cls: 'badge-store-done' },
  cleared:          { label: 'Clear',            cls: 'badge-store-done' }
}

const SUBTITLES = {
  hq:      'HO task records — error reports from stores',
  store:   'Store tasks — operational checklist completions',
  product: 'Product Master — look up any product',
  master:  'Master reports — back-office data tables'
}

export default function Reports() {
  const { session } = useStore()
  const [tab, setTab] = useState('hq')
  const showMaster = canAccessMasterReports(session)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">{SUBTITLES[tab] || ''}</div>
        </div>
        <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'hq' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('hq')}>HO records</button>
          <button className={`btn btn-sm ${tab === 'store' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('store')}>Store tasks</button>
          <button className={`btn btn-sm ${tab === 'product' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('product')}>Product Master</button>
          {showMaster && (
            <button className={`btn btn-sm ${tab === 'master' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('master')}>Master Reports</button>
          )}
        </div>
      </div>
      {tab === 'hq'      && <HQReports />}
      {tab === 'store'   && <StoreTaskReports />}
      {tab === 'product' && <ProductMasterReport />}
      {tab === 'master'  && showMaster && <AdminReports embedded />}
    </div>
  )
}

// Product Master — searchable product lookup for every user. Backed by the
// product_master materialized view (alt_barcodes + prices). View-only: search
// by code / barcode / description / category / subcategory. No export.
const PM_COLUMNS = [
  { key: 'product_code',        label: 'Product Code' },
  { key: 'product_description', label: 'Product Description' },
  { key: 'selling_price',       label: 'Selling Price', get: r => r.selling_price != null && r.selling_price !== '' ? `€${Number(r.selling_price).toFixed(2)}` : '' },
  { key: 'category',            label: 'Category' },
  { key: 'subcategory',         label: 'Subcategory' },
  { key: 'product_barcode',     label: 'Product Barcode' },
  { key: 'product_status',      label: 'Product Status' },
  { key: 'barcode_status',      label: 'Barcode Status' },
  { key: 'product_type',        label: 'Product Type' },
  { key: 'supplier',            label: 'Supplier' }
]

const EMPTY_FILTERS = { category: '', subcategory: '', product_type: '', supplier: '', product_status: '' }

function ProductMasterReport() {
  const [draftQ, setDraftQ] = useState('')
  const [q, setQ]           = useState('')
  const [page, setPage]     = useState(1)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [options, setOptions] = useState(null)
  const [data, setData]     = useState({ rows: [], total: 0, pages: 1, limit: 100 })
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  // Dropdown option lists — loaded once.
  useEffect(() => { getProductMasterFilters().then(setOptions).catch(() => setOptions({})) }, [])

  const filterKey = JSON.stringify(filters)
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    getProductMaster({ q, page, filters })
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) { setError(e.message); setData({ rows: [], total: 0, pages: 1, limit: 100 }) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, page, filterKey])

  const runSearch    = () => { setQ(draftQ.trim()); setPage(1) }
  const clearSearch  = () => { setDraftQ(''); setQ(''); setPage(1) }
  const setFilter    = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1) }
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1) }
  const anyFilter    = Object.values(filters).some(Boolean)

  const { rows, total, pages, limit } = data
  const fromRow = total === 0 ? 0 : (page - 1) * limit + 1
  const toRow   = Math.min(page * limit, total)

  return (
    <div className="card">
      <div className="card-body">
        <div className="flex-row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={draftQ}
            onChange={e => setDraftQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
            placeholder="Search by description, or exact barcode / product code…"
            style={{ flex: 1, minWidth: 240 }}
          />
          <button className="btn btn-sm btn-primary" onClick={runSearch} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Search'}
          </button>
          {q && <button className="btn btn-sm btn-outline" onClick={clearSearch} disabled={loading}>✕ Clear</button>}
        </div>

        {options && (
          <div className="flex-row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <FilterSelect label="Category"       value={filters.category}       opts={options.categories}       onChange={v => setFilter('category', v)} />
            <FilterSelect label="Subcategory"    value={filters.subcategory}    opts={options.subcategories}    onChange={v => setFilter('subcategory', v)} />
            <FilterSelect label="Product Type"   value={filters.product_type}   opts={options.product_types}    onChange={v => setFilter('product_type', v)} />
            <FilterSelect label="Supplier"       value={filters.supplier}       opts={options.suppliers}        onChange={v => setFilter('supplier', v)} />
            <FilterSelect label="Product Status" value={filters.product_status} opts={options.product_statuses} onChange={v => setFilter('product_status', v)} />
            {anyFilter && <button className="btn btn-sm btn-outline" onClick={clearFilters} disabled={loading}>✕ Clear filters</button>}
          </div>
        )}

        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}

        <p className="note" style={{ fontSize: 12, marginTop: 0 }}>
          {total > 0
            ? `Showing ${fromRow.toLocaleString('en-IE')}–${toRow.toLocaleString('en-IE')} of ${total.toLocaleString('en-IE')}${q ? ` for “${q}”` : ''}`
            : (loading ? 'Loading…' : (q ? `No products match “${q}”.` : 'No products.'))}
        </p>

        {!!rows.length && (
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead><tr>{PM_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {PM_COLUMNS.map(c => <td key={c.key}>{c.get ? c.get(r) : (r[c.key] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && <Pager page={page} pages={pages} disabled={loading} onGo={setPage} />}
      </div>
    </div>
  )
}

// One dropdown filter. Empty value = "All".
function FilterSelect({ label, value, opts, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ fontSize: 13, minWidth: 130, maxWidth: 220 }}>
      <option value="">{label}: All</option>
      {(opts || []).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// Compact pager: First/Prev, a window of page numbers around the current page,
// Next/Last, plus a "go to page" box — so any of the pages can be opened.
function Pager({ page, pages, onGo, disabled }) {
  const [jump, setJump] = useState('')
  const go = (p) => { if (p >= 1 && p <= pages && p !== page) onGo(p) }

  const win = []
  const add = n => { if (n >= 1 && n <= pages && !win.includes(n)) win.push(n) }
  add(1); add(2)
  for (let p = page - 2; p <= page + 2; p++) add(p)
  add(pages - 1); add(pages)
  win.sort((a, b) => a - b)

  const items = []
  let prev = 0
  for (const n of win) {
    if (n - prev > 1) items.push(<span key={'e' + n} style={{ padding: '0 2px', color: 'var(--text-muted)' }}>…</span>)
    items.push(
      <button key={n} className={`btn btn-sm ${n === page ? 'btn-primary' : 'btn-outline'}`} onClick={() => go(n)} disabled={disabled}>{n}</button>
    )
    prev = n
  }

  const doJump = () => {
    const n = parseInt(jump, 10)
    if (n >= 1 && n <= pages) { onGo(n); setJump('') }
  }

  return (
    <div className="flex-row" style={{ gap: 6, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="btn btn-sm btn-outline" onClick={() => go(page - 1)} disabled={disabled || page <= 1}>‹ Prev</button>
      {items}
      <button className="btn btn-sm btn-outline" onClick={() => go(page + 1)} disabled={disabled || page >= pages}>Next ›</button>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>Page {page} of {pages}</span>
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 6 }}>
        <input type="number" min="1" max={pages} value={jump}
          onChange={e => setJump(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doJump()}
          placeholder="Go to" style={{ width: 72, fontSize: 13 }} />
        <button className="btn btn-sm btn-outline" onClick={doJump} disabled={disabled}>Go</button>
      </span>
    </div>
  )
}

// Authenticated fetch for report downloads. Handles 401 the same way api.js
// does — clears the session and reloads so the user lands on the login screen
// instead of seeing a confusing "Server returned 401" error message.
async function authedFetch(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (res.status === 401) {
    clearToken()
    sessionStorage.removeItem('hs_session')
    localStorage.removeItem('hs_session')
    window.location.reload()
    throw new Error('Session expired — please sign in again.')
  }
  if (!res.ok) throw new Error(`Server returned ${res.status}`)
  return res
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
  // All three filters are now arrays of selected ids. Empty array == "all".
  const [storeIds, setStoreIds]       = useState(isBO ? [] : (session.storeId ? [session.storeId] : []))
  const [taskTypeIds, setTaskTypeIds] = useState([])
  const [statusIds, setStatusIds]     = useState([])
  const [stores, setStores]           = useState([])
  const [taskTypes, setTaskTypes]     = useState([])

  const [records, setRecords]         = useState([])
  const [total, setTotal]             = useState(0)
  const [hasMore, setHasMore]         = useState(false)
  const PAGE_SIZE = 200
  const [storesById, setStoresById]   = useState({})
  const [selected, setSelected]       = useState(new Set())
  const [loading, setLoading]         = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState('')
  const [reviewRowId, setReviewRowId] = useState(null)
  const [reviewNote, setReviewNote]   = useState('')
  // Per-row audit-history state: { [recordId]: { loading, events, err } }
  const [history, setHistory]         = useState({})

  const toggleHistory = async (recordId) => {
    setHistory(h => {
      if (h[recordId]) {
        const { [recordId]: _, ...rest } = h
        return rest
      }
      return { ...h, [recordId]: { loading: true, events: [], err: '' } }
    })
    if (history[recordId]) return  // was open -> we just closed it
    try {
      const events = await getTaskRecordEvents(recordId)
      setHistory(h => ({ ...h, [recordId]: { loading: false, events, err: '' } }))
    } catch (e) {
      setHistory(h => ({ ...h, [recordId]: { loading: false, events: [], err: e.message } }))
    }
  }

  useEffect(() => {
    getTaskTypes().then(setTaskTypes).catch(() => setTaskTypes([]))
    // Always load stores so the Store column can show names for all users (N12).
    // The store filter UI is only shown for back-office users below.
    getStores().then(rows => {
      setStores(rows)
      setStoresById(Object.fromEntries(rows.map(s => [s.id, s])))
    }).catch(e => { if (isBO) setError('Could not load stores: ' + e.message) })
  }, [isBO])

  const fetchPage = async (offset) => {
    return await getTaskRecords({
      storeId:  storeIds.length    ? storeIds.join(',')    : undefined,
      taskType: taskTypeIds.length ? taskTypeIds.join(',') : undefined,
      status:   statusIds.length   ? statusIds.join(',')   : undefined,
      limit:    PAGE_SIZE,
      offset,
      filters:  { from, to }
    })
  }

  const runReport = async () => {
    setLoading(true); setError(''); setSelected(new Set()); setReviewRowId(null)
    try {
      const data = await fetchPage(0)
      // Tolerate bare-array (legacy) and paginated ({records,total,has_more}).
      const rows  = Array.isArray(data) ? data           : (data?.records || [])
      const tot   = Array.isArray(data) ? rows.length    : (data?.total ?? rows.length)
      const more  = Array.isArray(data) ? false          : !!data?.has_more
      setRecords(rows); setTotal(tot); setHasMore(more)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    setLoading(true)
    try {
      const data = await fetchPage(records.length)
      const rows = Array.isArray(data) ? data : (data?.records || [])
      const tot  = Array.isArray(data) ? rows.length : (data?.total ?? rows.length + records.length)
      const more = Array.isArray(data) ? false : !!data?.has_more
      setRecords(prev => [...prev, ...rows]); setTotal(tot); setHasMore(more)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const downloadXLSX = async () => {
    setDownloading(true); setError('')
    try {
      const params = new URLSearchParams({ from, to, format: 'json' })
      if (storeIds.length)    params.set('storeId',    storeIds.join(','))
      if (taskTypeIds.length) params.set('task_type',  taskTypeIds.join(','))
      if (statusIds.length)   params.set('status',     statusIds.join(','))
      if (statusIds.includes('cleared')) params.set('includeCleared', '1')
      const res = await authedFetch(`/api/reports/task-records?${params}`)
      const { cols, headers, rows } = await res.json()
      const n = new Date()
      const p = x => String(x).padStart(2, '0')
      const stamp = `${p(n.getDate())}${p(n.getMonth() + 1)}${n.getFullYear()}${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`
      await downloadExcel(
        `Task Reports - ${stamp}.xlsx`, rows, cols, headers,
        new Set(['photo_product_url', 'photo_barcode_url'])
      )
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
              <div className="filter-field filter-field--wide"><label>Stores</label>
                <MultiSelectDropdown
                  value={storeIds}
                  onChange={setStoreIds}
                  options={stores.filter(s => s.is_active).map(s => ({ id: s.id, label: s.store_name, subLabel: s.store_code }))}
                  placeholder="All stores"
                />
              </div>
            )}

            <div className="filter-field filter-field--wide"><label>Task types</label>
              <MultiSelectDropdown
                value={taskTypeIds}
                onChange={setTaskTypeIds}
                options={taskTypes.map(t => ({ id: t.code, label: `${t.code} — ${t.name}` }))}
                placeholder="All task types"
              />
            </div>

            <div className="filter-field filter-field--wide"><label>Status</label>
              <MultiSelectDropdown
                value={statusIds}
                onChange={setStatusIds}
                options={[
                  { id: 'pending',          label: 'Pending' },
                  { id: 'completed',        label: 'Completed by HO' },
                  { id: 'no_change_needed', label: 'No change needed' },
                  { id: 'store_completed',  label: 'Store confirmed' },
                  { id: 'cleared',          label: 'Clear (archived)' }
                ]}
                placeholder="Any status (excl. cleared)"
              />
            </div>

            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={runReport} disabled={loading}>
                {loading ? <><span className="spinner" /> Loading…</> : 'Run report'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={downloadXLSX} disabled={downloading}>
                {downloading ? <><span className="spinner spinner-dark" /> Preparing…</> : '↓ Excel'}
              </button>
            </div>
          </div>

          {error && <div className="login-error mt-12">{error}</div>}
        </div>
      </div>

      {records.length > 0 && (
        <div className="card mt-20">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              Showing {records.length.toLocaleString('en-IE')}
              {total > records.length && <> of {total.toLocaleString('en-IE')}</>}
              {' '}record{records.length !== 1 ? 's' : ''}
            </span>
            {pendingIds.length > 0 && isBO && (
              <span className="note" style={{ fontSize: 12 }}>· {pendingIds.length} pending</span>
            )}
            {hasMore && (
              <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={loadMore} disabled={loading}>
                {loading ? <><span className="spinner" /> Loading…</> : `Load more (${(total - records.length).toLocaleString('en-IE')} left)`}
              </button>
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
                  <th>Product Id</th>
                  <th>Product Description</th>
                  <th>Department</th>
                  <th>Product Barcode</th>
                  <th>Photos</th>
                  <th>Status</th>
                  <th>Date</th>
                  {isBO && <th></th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const status   = STATUS_LABEL[r.status] || STATUS_LABEL.pending
                  const isPending = r.status === 'pending'
                  const desc = r.item_name || r.description || r.product_name_label || ''
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
                        <td><strong>{TASK_FORMS[r.task_type]?.name || r.task_type}</strong></td>
                        <td>{storesById[r.store_id]?.store_name || <span className="td-muted">—</span>}</td>
                        <td className="td-code">{r.product_barcode || r.product_code || <span className="td-muted">—</span>}</td>
                        <td>{desc || <span className="td-muted">—</span>}</td>
                        <td>{r.details?.item_group || <span className="td-muted">—</span>}</td>
                        <td className="td-code">{r.barcode_no || r.product_code || ''}</td>
                        <td>
                          <div className="flex-row" style={{ gap: 6 }}>
                            {r.photo_product_url && <a href={r.photo_product_url} target="_blank" rel="noopener noreferrer">📷 product</a>}
                            {r.photo_barcode_url && <a href={r.photo_barcode_url} target="_blank" rel="noopener noreferrer">📷 barcode</a>}
                            {!r.photo_product_url && !r.photo_barcode_url && <span className="td-muted">—</span>}
                          </div>
                        </td>
                        <td><span className={`badge ${status.cls}`}>{status.label}</span></td>
                        <td className="td-muted">{formatDT(r.created_at)}</td>
                        {isBO && (
                          <td>
                            <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                              {isPending && (
                                <>
                                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => reviewOne(r.id, 'completed')}>
                                    Complete
                                  </button>
                                  <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => { setReviewRowId(r.id); setReviewNote('') }}>
                                    No change
                                  </button>
                                </>
                              )}
                              <button className="btn btn-sm btn-outline" onClick={() => toggleHistory(r.id)} title="Audit history">
                                {history[r.id] ? '▴' : '▾'} History
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {/* Audit-trail panel (BO only) */}
                      {isBO && history[r.id] && (
                        <tr>
                          <td colSpan={isBO ? 11 : 10} style={{ background: 'var(--surface-warm)' }}>
                            <HistoryPanel state={history[r.id]} />
                          </td>
                        </tr>
                      )}
                      {/* Inline note input for per-row "No change needed" */}
                      {isBO && reviewRowId === r.id && (
                        <tr>
                          <td colSpan={isBO ? 11 : 10} style={{ background: 'var(--surface-warm)' }}>
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
                      {/* Review-notes echo — skip for J/K since dept info is already in the row */}
                      {r.review_notes && !(isBO && reviewRowId === r.id) && r.task_type !== 'J' && r.task_type !== 'K' && (
                        <tr>
                          <td colSpan={isBO ? 11 : 10} style={{ background: 'var(--surface-warm)', fontStyle: 'italic', fontSize: 13, color: 'var(--text-muted)' }}>
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
  const [storeIds, setStoreIds]   = useState(isBO ? [] : (session.storeId ? [session.storeId] : []))
  const [tplIds, setTplIds]       = useState([])
  const [stores, setStores]       = useState([])
  const [templates, setTemplates] = useState([])

  const [rows, setRows]           = useState([])
  const [selected, setSelected]   = useState(new Set())
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
        storeId:     storeIds.length ? storeIds.join(',') : undefined,
        template_id: tplIds.length   ? tplIds.join(',')   : undefined
      })
      setRows(data); setSelected(new Set())
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setLoading(false) }
  }

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allSelected = rows.length > 0 && selected.size === rows.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))

  const downloadXLSX = async () => {
    setDownloading(true); setError('')
    try {
      const params = new URLSearchParams({ from, to, format: 'json' })
      if (storeIds.length) params.set('storeId', storeIds.join(','))
      if (tplIds.length)   params.set('template_id', tplIds.join(','))
      const res = await authedFetch('/api/reports/store-tasks?' + params)
      const { cols, headers, rows } = await res.json()
      await downloadExcel(
        `store-tasks-${from}-to-${to}.xlsx`, rows, cols, headers,
        new Set(['photo_url'])
      )
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
              <div className="filter-field filter-field--wide"><label>Stores</label>
                <MultiSelectDropdown
                  value={storeIds}
                  onChange={setStoreIds}
                  options={stores.filter(s => s.is_active).map(s => ({ id: s.id, label: s.store_name }))}
                  placeholder="All stores"
                />
              </div>
            )}
            <div className="filter-field filter-field--wide"><label>Templates</label>
              <MultiSelectDropdown
                value={tplIds}
                onChange={setTplIds}
                options={templates.filter(t => t.is_active).map(t => ({ id: t.id, label: t.title }))}
                placeholder="All templates"
              />
            </div>
            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={run} disabled={loading}>
                {loading ? (<><span className="spinner" /> Loading…</>) : 'Run report'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={downloadXLSX} disabled={downloading}>
                {downloading ? (<><span className="spinner spinner-dark" /> Preparing…</>) : '↓ Excel'}
              </button>
            </div>
          </div>
          {error && <div className="login-error mt-12">{error}</div>}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card mt-20">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{rows.length} result{rows.length === 1 ? '' : 's'}</span>
            {selected.size > 0 && <span className="note" style={{ fontSize: 12 }}>· {selected.size} selected</span>}
            <span style={{ marginLeft: 'auto' }} />
            <button className="btn btn-sm btn-outline" onClick={() => setSelected(new Set(rows.map(r => r.id)))}>✓ Select all</button>
            <button className="btn btn-sm btn-outline" onClick={() => setSelected(new Set())} disabled={!selected.size}>✕ Clear all</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all rows" />
                </th>
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
                    const display = Array.isArray(v)
                      ? v.join(', ')
                      : (typeof v === 'string' && v.startsWith('http')
                          ? <a href={v} target="_blank" rel="noopener noreferrer">📎 view</a>
                          : String(v))
                    return { label: b.label, display }
                  }).filter(Boolean)
                  return (
                    <tr key={r.id}>
                      <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                      <td><strong>{t.title || '—'}</strong>{t.category && <span className="chip" style={{ marginLeft: 6 }}>{t.category}</span>}</td>
                      <td>{storeName(r.store_id) || '—'}</td>
                      <td>{r.due_date || '—'}</td>
                      <td><span className={'badge ' + (r.status === 'completed' ? 'badge-completed' : r.status === 'missed' ? 'badge-deleted' : 'badge-pending')}>{r.status}</span></td>
                      <td className="td-muted">{r.completed_at ? new Date(r.completed_at).toLocaleString('en-IE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}</td>
                      <td>{lines.length ? lines.map((l, i) => <div key={i} style={{ fontSize: 13 }}>{l.label}: {l.display}</div>) : (r.notes ? <span className="note" style={{ fontSize: 12 }}>{r.notes}</span> : <span className="td-muted">—</span>)}</td>
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

// Audit-ledger panel shown under a record row when History is expanded.
function HistoryPanel({ state }) {
  if (state.loading) return <div style={{ padding: 10, fontSize: 13 }}><span className="spinner spinner-dark" /> Loading history…</div>
  if (state.err)     return <div className="login-error" style={{ margin: 8 }}>{state.err}</div>
  if (!state.events?.length) return <div className="note" style={{ padding: 10, fontSize: 12 }}>No history yet.</div>
  return (
    <div style={{ padding: '10px 14px' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Audit history</div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {state.events.map(ev => (
          <li key={ev.id} style={{ marginBottom: 4 }}>
            <strong>{ev.from_status || '—'} → {ev.to_status}</strong>
            <span className="td-muted" style={{ marginLeft: 6 }}>
              by {ev.by_user_name} · {new Date(ev.at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            {ev.note && <div className="note" style={{ fontSize: 12.5, marginLeft: 0 }}>“{ev.note}”</div>}
          </li>
        ))}
      </ol>
    </div>
  )
}
