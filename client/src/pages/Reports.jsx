import { Fragment, useState, useEffect, useMemo } from 'react'
import { useStore } from '../App.jsx'
import {
  getStores, getTaskTypes, getToken, getTaskRecords,
  updateTaskRecord, bulkReviewTaskRecords, bulkClearTaskRecords,
  deleteTaskRecord, bulkDeleteTaskRecords, deleteJkMatching,
  adminListTemplates, getStoreTaskReportRows,
  clearToken, getProductMaster, getProductMasterFilters,
  getSpacePlanReport, getCompetitorReport, sendToPricing, getBmReductions
} from '../lib/api.js'
import { COMPETITION_REPORT_COLS, COMPETITION_REPORT_HEADERS, COMPETITION_REPORT_MIN_WIDTHS } from '../lib/competitionOptions.js'
import { TASK_FORMS, STORE_CLEARABLE } from '../lib/taskTypes.js'
import { downloadExcel } from '../lib/excel.js'
import { useToast } from '../components/Toast.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal.jsx'
import AdminReports from './AdminReports.jsx'
import ExpiryReport from './ExpiryReport.jsx'
import { canAccessMasterReports } from '../lib/roles.js'
import RecordMessages from '../components/RecordMessages.jsx'
import RecordDetailModal from '../components/RecordDetailModal.jsx'
import AgeClock from '../components/AgeClock.jsx'

function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Compact date for the report grid — the full timestamp is in the Details popup.
function formatDMY(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`
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
  hq:         'HO task records — error reports from stores',
  bmreductions:'Dead Stock — one-off / clearance B&M products from Department Check',
  store:      'Store tasks — operational checklist completions',
  expiry:     'Expiry Overview — Reduce-to-Clear activity across sweeps',
  product:    'Product Master — look up any product',
  master:     'Master reports — back-office data tables',
  spaceplan:  'Space Plan — equipment counts by store and department',
  competition:'Competition — competitors recorded around each store'
}

export default function Reports() {
  const { session, appConfig } = useStore()
  const [tab, setTab] = useState('hq')
  const isBO = session?.mode === 'backoffice'
  const showMaster = canAccessMasterReports(session)
  const showCompetition = appConfig?.competition_enabled !== false

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">{SUBTITLES[tab] || ''}</div>
        </div>
        <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'hq' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('hq')}>HO records</button>
          {isBO && (
            <button className={`btn btn-sm ${tab === 'bmreductions' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('bmreductions')}>Dead Stock</button>
          )}
          <button className={`btn btn-sm ${tab === 'store' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('store')}>Store tasks</button>
          {isBO && (
            <button className={`btn btn-sm ${tab === 'expiry' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('expiry')}>Expiry</button>
          )}
          <button className={`btn btn-sm ${tab === 'product' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('product')}>Product Master</button>
          <button className={`btn btn-sm ${tab === 'spaceplan' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('spaceplan')}>Space Plan</button>
          {showCompetition && (
            <button className={`btn btn-sm ${tab === 'competition' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('competition')}>Competition</button>
          )}
          {showMaster && (
            <button className={`btn btn-sm ${tab === 'master' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('master')}>Master Reports</button>
          )}
        </div>
      </div>
      {tab === 'hq'        && <HQReports />}
      {tab === 'bmreductions' && isBO && <BMReductionsReport />}
      {tab === 'store'     && <StoreTaskReports />}
      {tab === 'expiry'    && isBO && <ExpiryReport />}
      {tab === 'product'   && <ProductMasterReport />}
      {tab === 'spaceplan' && <SpacePlanReport />}
      {tab === 'competition' && showCompetition && <CompetitionReport />}
      {tab === 'master'    && showMaster && <AdminReports embedded />}
    </div>
  )
}

// Product Master — searchable product lookup for every user. Backed by the
// product_master materialized view (alt_barcodes + prices). View-only: search
// by code / barcode / description / category / subcategory. No export.
// minWidth, not width/maxWidth — a floor so short values (most rows) don't
// stretch the column, but never a cap that could cut off a longer one
// (a code or a name that happens to run long stays fully visible).
const PM_COLUMNS = [
  { key: 'product_code',        label: 'Product Code',        minWidth: 110 },
  { key: 'product_description', label: 'Product Description' },  // flexible — absorbs leftover width
  { key: 'selling_price',       label: 'Selling Price',       minWidth: 90,  get: r => r.selling_price != null && r.selling_price !== '' ? `€${Number(r.selling_price).toFixed(2)}` : '' },
  { key: 'category',            label: 'Category',            minWidth: 110 },
  { key: 'subcategory',         label: 'Subcategory',         minWidth: 110 },
  { key: 'product_barcode',     label: 'Product Barcode',     minWidth: 110 },
  { key: 'product_status',      label: 'Product Status',      minWidth: 90 },
  { key: 'barcode_status',      label: 'Barcode Status',      minWidth: 90 },
  { key: 'product_type',        label: 'Product Type',        minWidth: 100 },
  { key: 'supplier',            label: 'Supplier',            minWidth: 110 }
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
          <div className="table-wrap table-wrap--tall">
            <table>
              <thead><tr>{PM_COLUMNS.map(c => <th key={c.key} style={c.minWidth ? { minWidth: c.minWidth } : undefined}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {PM_COLUMNS.map(c => (
                      <td key={c.key} style={c.minWidth ? { whiteSpace: 'nowrap' } : undefined}>
                        {c.get ? c.get(r) : (r[c.key] ?? '')}
                      </td>
                    ))}
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
          placeholder="Go to" style={{ width: 72, fontSize: 13, minHeight: 32, padding: '4px 8px' }} />
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

// ── Dead Stock ────────────────────────────────────────────────────────────────
// Back office only. Department Check scans of supplier 510001 (B&M), limited to
// the 4 clearance/dropped product types and present in Item_Master, minus any
// product in (B&M Daily File − CN Code Master). One row per store per product;
// the last two columns (QTY in Store, Auth Reduced Price) are blank for stores
// to fill in. See report_bm_reductions() / GET /reports/bm-reductions.
const BM_KEYS    = ['store_code','product_id','description','category','status','retail_price','qty_in_store','auth_reduced_price']
const BM_HEADERS = ['Store Code','Product ID','Description','Category','Status','Retail Price','QTY in Store','Auth Reduced Price']
// minWidth per column, parallel to BM_HEADERS — a floor so short/blank columns
// don't stretch, never a cap (Description has none: it's free text and should
// absorb whatever's left).
const BM_MIN_WIDTHS = [100, 110, undefined, 110, 90, 100, 100, 140]
const BM_MAX_SHOWN = 1000   // the grid is a preview; Excel export carries everything
const BM_EMPTY_FILTERS = { store_code: [], category: [], status: [] }
const bmDate = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const bmToday = () => bmDate(new Date())
const bmDefaultFrom = () => bmDate(new Date(Date.now() - 30 * 86400000))

function BMReductionsReport() {
  const toast = useToast()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(false)
  const [hasRun, setHasRun]   = useState(false)
  const [error, setError]     = useState('')
  const [downloading, setDownloading] = useState(false)
  const [filters, setFilters] = useState(BM_EMPTY_FILTERS)
  const [from, setFrom]       = useState(bmDefaultFrom())
  const [to, setTo]           = useState(bmToday())

  // No auto-load — the report only runs when the user clicks Run Report.
  const runReport = () => {
    setLoading(true); setError(''); setHasRun(true)
    getBmReductions({ from: from ? `${from}T00:00:00` : '', to: to ? `${to}T23:59:59` : '' })
      .then(d => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(e => { setError(e.message); setRows([]) })
      .finally(() => setLoading(false))
  }

  // Multi-select dropdown options — distinct values present in the loaded result.
  const options = useMemo(() => {
    const uniq = key => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort()
    return { store_code: uniq('store_code'), category: uniq('category'), status: uniq('status') }
  }, [rows])

  const filtered = useMemo(() => rows.filter(r =>
    (!filters.store_code.length || filters.store_code.includes(r.store_code)) &&
    (!filters.category.length   || filters.category.includes(r.category)) &&
    (!filters.status.length     || filters.status.includes(r.status))
  ), [rows, filters])

  const setFilter    = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters(BM_EMPTY_FILTERS)
  const anyFilter    = Object.values(filters).some(a => a.length)

  const distinctProducts = useMemo(() => new Set(filtered.map(r => r.product_id)).size, [filtered])
  const shown = filtered.slice(0, BM_MAX_SHOWN)

  const exportExcel = async () => {
    if (!filtered.length) { toast.error('Nothing to export.'); return }
    setDownloading(true)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadExcel(`Dead Stock - ${stamp}.xlsx`, filtered, BM_KEYS, BM_HEADERS)
    } catch (e) { toast.error(e.message) } finally { setDownloading(false) }
  }

  return (
    <div className="card">
      <div className="card-body">
        <div className="filter-row">
          <div className="filter-field"><label>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="filter-field"><label>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>

          <div className="filter-field filter-field--wide"><label>Store</label>
            <MultiSelectDropdown value={filters.store_code} onChange={v => setFilter('store_code', v)}
              options={options.store_code.map(x => ({ id: x, label: x }))} placeholder="All stores" />
          </div>
          <div className="filter-field filter-field--wide"><label>Category</label>
            <MultiSelectDropdown value={filters.category} onChange={v => setFilter('category', v)}
              options={options.category.map(x => ({ id: x, label: x }))} placeholder="All categories" />
          </div>
          <div className="filter-field filter-field--wide"><label>Product Status</label>
            <MultiSelectDropdown value={filters.status} onChange={v => setFilter('status', v)}
              options={options.status.map(x => ({ id: x, label: x }))} placeholder="All statuses" />
          </div>

          <div className="filter-field">
            <button className="btn btn-primary" onClick={runReport} disabled={loading} style={{ whiteSpace: 'nowrap' }}>
              {loading ? <span className="spinner" /> : '▶ Run Report'}
            </button>
          </div>
        </div>

        <div className="flex-row" style={{ gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="note" style={{ fontSize: 12 }}>
            {!hasRun ? 'Set a date range and click Run Report.'
              : loading ? 'Loading…'
              : `${filtered.length.toLocaleString('en-IE')} row${filtered.length !== 1 ? 's' : ''} · ${distinctProducts.toLocaleString('en-IE')} distinct product${distinctProducts !== 1 ? 's' : ''}`}
          </span>
          {anyFilter && <button className="btn btn-sm btn-outline" onClick={clearFilters}>✕ Clear filters</button>}
          <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={exportExcel} disabled={downloading || !filtered.length}>
            {downloading ? <span className="spinner" /> : '↓ Excel'}
          </button>
        </div>

        <p className="note" style={{ fontSize: 12, marginTop: 0 }}>
          Dead stock — B&amp;M (supplier 510001) one-off / clearance products from Department Check, excluding items in the B&amp;M Daily File that are not in the CN Code Master. Fill in <strong>QTY in Store</strong> and <strong>Auth Reduced Price</strong> per store.
        </p>

        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        {hasRun && !loading && !filtered.length && !error && <p className="note">No products match{anyFilter ? ' these filters' : ' the criteria'}.</p>}

        {!!shown.length && (
          <>
            <div className="table-wrap table-wrap--tall">
              <table>
                <thead><tr>{BM_HEADERS.map((h, i) => <th key={h} style={{ whiteSpace: 'nowrap', minWidth: BM_MIN_WIDTHS[i] }}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.store_code}</td>
                      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{r.product_id}</td>
                      <td>{r.description}</td>
                      <td>{r.category}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.status}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.retail_price != null && r.retail_price !== '' ? Number(r.retail_price).toFixed(2) : ''}</td>
                      <td></td>
                      <td></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > shown.length && (
              <p className="note" style={{ fontSize: 12, marginTop: 8 }}>
                Showing the first {BM_MAX_SHOWN.toLocaleString('en-IE')} of {filtered.length.toLocaleString('en-IE')} rows — use <strong>↓ Excel</strong> for the full list.
              </p>
            )}
          </>
        )}
      </div>
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
  // All three filters are now arrays of selected ids. Empty array == "all".
  const [storeIds, setStoreIds]       = useState(isBO ? [] : (session.storeId ? [session.storeId] : []))
  const [taskTypeIds, setTaskTypeIds] = useState([])
  // Back-office logins default to the "live" statuses only — Completed by HO and
  // Clear are hidden unless the user deliberately selects them. Store users keep
  // the default (everything except Clear) so they can see + clear HO-completed items.
  // Buying Manager, Admin and Store Support Administrator default to Pending only —
  // their workflow is reviewing the unactioned queue, so the other live statuses
  // just add noise they'd otherwise have to deselect each time.
  const PENDING_ONLY_ROLES = ['buying_manager', 'admin', 'support_admin']
  const defaultStatusIds = !isBO
    ? []
    : (PENDING_ONLY_ROLES.includes(session.role)
        ? ['pending']
        : ['pending', 'no_change_needed', 'store_completed'])
  const [statusIds, setStatusIds]     = useState(defaultStatusIds)
  // Alt-barcode snapshot status, captured when the product was scanned.
  const [itemStatusIds, setItemStatusIds]       = useState([])
  const [barcodeStatusIds, setBarcodeStatusIds] = useState([])
  const [stores, setStores]           = useState([])
  const [taskTypes, setTaskTypes]     = useState([])

  const [records, setRecords]         = useState([])
  const [total, setTotal]             = useState(0)
  const [hasMore, setHasMore]         = useState(false)
  const PAGE_SIZE = 200
  const [storesById, setStoresById]   = useState({})
  const [selected, setSelected]       = useState(new Set())
  // Permanent-delete confirmation (J/K only). deleteTarget = { ids:[...] } or null.
  const [deleteTarget, setDeleteTarget] = useState(null)
  // Row whose full detail popup is open (null = closed).
  const [detailRecord, setDetailRecord] = useState(null)
  const [deleting, setDeleting]       = useState(false)
  // "Delete ALL matching J/K" (filter-based, batched) confirmation + progress.
  const [matchDelete, setMatchDelete]   = useState(false)
  const [matchDeleting, setMatchDeleting] = useState(false)
  const [matchDeleted, setMatchDeleted] = useState(0)
  const [loading, setLoading]         = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState('')
  const [expandedMessages, setExpandedMessages] = useState(new Set())
  const toggleMessages = (id) => setExpandedMessages(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })


  useEffect(() => {
    getTaskTypes().then(tt => {
      setTaskTypes(tt)
      // Back office defaults to all task types EXCEPT the operations checks —
      // Department Check (J), Price Check (K), Stock Count (H), Routine Expiry
      // Sweep (M) — the user can add those manually. A sweep logs one record
      // per product, so leaving M in the default selection floods this report.
      if (isBO) setTaskTypeIds(tt.map(t => t.code).filter(c => !['J', 'K', 'H', 'M'].includes(c)))
    }).catch(() => setTaskTypes([]))
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
      // getTaskRecords only forwards recognised top-level keys; anything else
      // has to go through `filters` to reach the query string.
      filters:  {
        from, to,
        ...(itemStatusIds.length    ? { item_status:    itemStatusIds.join(',') }    : {}),
        ...(barcodeStatusIds.length ? { barcode_status: barcodeStatusIds.join(',') } : {})
      }
    })
  }

  const runReport = async () => {
    setLoading(true); setError(''); setSelected(new Set())
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
      const baseParams = { from, to, format: 'json' }
      if (storeIds.length)    baseParams.storeId   = storeIds.join(',')
      if (taskTypeIds.length) baseParams.task_type = taskTypeIds.join(',')
      if (statusIds.length)   baseParams.status    = statusIds.join(',')
      if (statusIds.includes('cleared')) baseParams.includeCleared = '1'
      if (itemStatusIds.length)    baseParams.item_status    = itemStatusIds.join(',')
      if (barcodeStatusIds.length) baseParams.barcode_status = barcodeStatusIds.join(',')

      // The server used to assemble the whole export inside one long-lived
      // streamed response. On a large export (200k+ rows, 20-40+ internal
      // Supabase round trips) that request ran long enough for Cloudflare
      // to kill the Worker mid-stream -- outside any server-side try/catch,
      // so it just came back as truncated, unparseable JSON. Driving the
      // pagination from here instead means every request is one short page,
      // so no single request can run long enough to hit that ceiling.
      //
      // Firing ~25-30 requests back-to-back with no pacing looks like a
      // burst to rate-limiting, and hit a 503 on this project (already under
      // heavy load today). Space page requests out and retry a single failed
      // page a couple of times before giving up on the whole export.
      const sleep = ms => new Promise(res => setTimeout(res, ms))
      const fetchPage = async (params) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await authedFetch(`/api/reports/task-records?${params}`)
            return await res.json()
          } catch (e) {
            if (attempt === 2) throw e
            await sleep(800 * (attempt + 1))
          }
        }
      }
      let cols = null, headers = null
      const rows = []
      let cursor = null
      for (let i = 0; i < 1000; i++) {
        const params = new URLSearchParams(baseParams)
        if (cursor) {
          params.set('after_created_at', cursor.created_at)
          params.set('after_id',         cursor.id)
        }
        if (i > 0) await sleep(150)
        const page = await fetchPage(params)
        cols    = cols    || page.cols
        headers = headers || page.headers
        rows.push(...page.rows)
        if (!page.next_cursor) break
        cursor = page.next_cursor
      }

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

  // Selection.
  //  · Back office: select pending records to review.
  //  · Store users: select records they're allowed to clear — J/K/M still
  //    pending, plus anything HO has already reviewed (completed /
  //    no_change_needed). Kept in step with STORE_CLEARABLE in lib/taskTypes.js
  //    and with the backend bulk-clear filter.
  const pendingIds = useMemo(() => records.filter(r => r.status === 'pending').map(r => r.id), [records])
  const storeClearableIds = useMemo(() => records.filter(r =>
    r.status === 'completed' || r.status === 'no_change_needed' ||
    (STORE_CLEARABLE.has(r.task_type) && r.status === 'pending')
  ).map(r => r.id), [records])

  const selectableIds  = isBO ? pendingIds : storeClearableIds
  const selectableSet  = useMemo(() => new Set(selectableIds), [selectableIds])
  const showCheckCol   = isBO || storeClearableIds.length > 0
  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))

  // J/K (Department/Price Check) records — permanently deletable by every user.
  const jkIdSet = useMemo(
    () => new Set(records.filter(r => r.task_type === 'J' || r.task_type === 'K').map(r => r.id)),
    [records]
  )
  const selectedJkIds = [...selected].filter(id => jkIdSet.has(id))

  const confirmDelete = async () => {
    const ids = deleteTarget?.ids || []
    if (!ids.length) { setDeleteTarget(null); return }
    setDeleting(true)
    try {
      if (ids.length === 1) await deleteTaskRecord(ids[0])
      else                  await bulkDeleteTaskRecords(ids)
      const idSet = new Set(ids)
      setRecords(rs => rs.filter(r => !idSet.has(r.id)))
      setTotal(t => Math.max(0, t - ids.length))
      setSelected(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
      toast.success(`${ids.length} record${ids.length === 1 ? '' : 's'} permanently deleted.`)
    } catch (e) {
      setError(e.message); toast.error(`Delete failed — ${e.message}`)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  // Delete EVERY J/K record matching the current report filters, batch by batch
  // (server-side), until the server reports it's done. This is what deletes all
  // pages, not just the loaded rows.
  const runDeleteAllMatching = async () => {
    setMatchDeleting(true); setMatchDeleted(0)
    let totalDeleted = 0
    try {
      for (let i = 0; i < 5000; i++) {           // hard cap as a runaway guard
        const { deleted, done } = await deleteJkMatching({
          from, to,
          storeId:  storeIds.length    ? storeIds.join(',')    : undefined,
          status:   statusIds.length   ? statusIds.join(',')   : undefined,
          taskType: taskTypeIds.length ? taskTypeIds.join(',') : undefined
        })
        totalDeleted += deleted
        setMatchDeleted(totalDeleted)
        if (done) break
      }
      toast.success(`Permanently deleted ${totalDeleted.toLocaleString('en-IE')} J/K record${totalDeleted === 1 ? '' : 's'}.`)
      setMatchDelete(false)
      runReport()   // refresh the now-smaller result set
    } catch (e) {
      setError(e.message); toast.error(`Delete failed — ${e.message}`)
    } finally {
      setMatchDeleting(false)
    }
  }

  const toggleAllSelectable = () => {
    if (allSelectableSelected) setSelected(new Set())
    else setSelected(new Set(selectableIds))
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
  const applyOptimisticReview = (ids, status) => {
    const idSet = new Set(ids)
    const now   = new Date().toISOString()
    const prev  = records.map(r => idSet.has(r.id) ? { id: r.id, status: r.status, reviewed_at: r.reviewed_at } : null).filter(Boolean)
    setRecords(rs => rs.map(r => idSet.has(r.id)
      ? { ...r, status, reviewed_at: now, ...(status === 'completed' ? { completed_at: now } : {}) }
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
    const ids = [...selected]
    const n   = ids.length
    const label = status === 'completed' ? 'completed' : 'marked “no change needed”'

    // Update the table instantly, clear selection, show feedback.
    const snapshot = applyOptimisticReview(ids, status)
    setSelected(new Set())
    toast.success(`${n} record${n === 1 ? '' : 's'} ${label}. Use 💬 to send a message to the store.`)

    // Then sync to server in the background.
    setBusy(true); setError('')
    try {
      await bulkReviewTaskRecords({ ids, status })
    } catch (e) {
      revertOptimistic(snapshot)
      setError(e.message); toast.error(`Reverted — ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const reviewOne = async (id, status) => {
    const snapshot = applyOptimisticReview([id], status)
    toast.success(status === 'completed' ? 'Marked complete.' : 'Marked “no change needed”.')

    setBusy(true); setError('')
    try {
      await updateTaskRecord(id, {
        status,
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {})
      })
    } catch (e) {
      revertOptimistic(snapshot)
      setError(e.message); toast.error(`Reverted — ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  // Store-side bulk clear — mark every selected (clearable) record as Clear.
  // Cleared records drop out of the default report view, so remove them
  // optimistically; on failure re-run the report to restore the true state.
  const bulkClear = async () => {
    if (!selected.size) return
    const ids = [...selected]
    const n   = ids.length

    setRecords(rs => rs.filter(r => !selected.has(r.id)))
    setTotal(t => Math.max(0, t - n))
    setSelected(new Set())
    toast.success(`${n} record${n === 1 ? '' : 's'} cleared.`)

    setBusy(true); setError('')
    try {
      await bulkClearTaskRecords(ids)
    } catch (e) {
      setError(e.message); toast.error(`Reverted — ${e.message}`)
      runReport()
    } finally {
      setBusy(false)
    }
  }

  // Copy the selected records to the Pricing page (back office only).
  // Snapshot copies — the originals stay exactly as they are here.
  const sendSelectedToPricing = async () => {
    if (!selected.size) return
    setBusy(true); setError('')
    try {
      const res = await sendToPricing([...selected])
      const bits = [`${res.added} sent to Pricing`]
      if (res.skipped) bits.push(`${res.skipped} already there`)
      toast.success(bits.join(' · '))
      setSelected(new Set())
    } catch (e) {
      setError(e.message); toast.error(e.message)
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
                options={taskTypes.map(t => ({ id: t.code, label: t.name }))}
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

            <div className="filter-field filter-field--wide"><label>Product Status</label>
              <MultiSelectDropdown
                value={itemStatusIds}
                onChange={setItemStatusIds}
                options={[{ id: 'Active', label: 'Active' }, { id: 'Inactive', label: 'Inactive' }]}
                placeholder="Any"
              />
            </div>

            <div className="filter-field filter-field--wide"><label>Barcode Status</label>
              <MultiSelectDropdown
                value={barcodeStatusIds}
                onChange={setBarcodeStatusIds}
                options={[{ id: 'Active', label: 'Active' }, { id: 'Inactive', label: 'Inactive' }]}
                placeholder="Any"
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
            {!isBO && storeClearableIds.length > 0 && (
              <span className="note" style={{ fontSize: 12 }}>· {storeClearableIds.length} clearable</span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {total > 0 && (taskTypeIds.length === 0 || taskTypeIds.some(t => t === 'J' || t === 'K')) && (
                <button
                  className="btn btn-sm"
                  onClick={() => setMatchDelete(true)}
                  title="Permanently delete every J/K record matching this report — all pages"
                  style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}
                >🗑 Delete all matching J/K</button>
              )}
              {hasMore && (
                <button className="btn btn-sm btn-outline" onClick={loadMore} disabled={loading}>
                  {loading ? <><span className="spinner" /> Loading…</> : `Load more (${(total - records.length).toLocaleString('en-IE')} left)`}
                </button>
              )}
            </div>
          </div>

          {/* Bulk action bar — back office reviews, store users clear */}
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
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={sendSelectedToPricing}
                title="Copy the selected records to the Pricing page (originals stay here)">
                € Send to Pricing ({selected.size})
              </button>
              {selectedJkIds.length > 0 && (
                <button className="btn btn-sm" disabled={busy} onClick={() => setDeleteTarget({ ids: selectedJkIds })}
                  style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}>
                  🗑 Delete J/K ({selectedJkIds.length})
                </button>
              )}
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}
          {!isBO && selected.size > 0 && (
            <div className="flex-row" style={{ padding: '12px 18px', background: 'var(--surface-warm)', borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
              <strong>{selected.size} selected</strong>
              <span style={{ marginLeft: 'auto' }} />
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={bulkClear}>
                {busy ? <><span className="spinner" /> Clearing…</> : `✓ Clear selected (${selected.size})`}
              </button>
              {selectedJkIds.length > 0 && (
                <button className="btn btn-sm" disabled={busy} onClick={() => setDeleteTarget({ ids: selectedJkIds })}
                  style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}>
                  🗑 Delete J/K ({selectedJkIds.length})
                </button>
              )}
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          <div className="table-wrap table-wrap--tall">
            <table>
              <thead>
                <tr>
                  {showCheckCol && (
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={allSelectableSelected}
                        disabled={!selectableIds.length}
                        onChange={toggleAllSelectable}
                        title={selectableIds.length ? (isBO ? 'Select all pending' : 'Select all clearable') : 'Nothing to select'}
                      />
                    </th>
                  )}
                  <th style={{ minWidth: 110 }}>Task</th>
                  <th style={{ minWidth: 200 }}>Store</th>
                  <th style={{ whiteSpace: 'nowrap', width: 130 }}>Product Id</th>
                  <th style={{ minWidth: 260 }}>Product Description</th>
                  <th style={{ width: 110 }}>Product Barcode</th>
                  <th style={{ width: 140 }}>Photos</th>
                  <th style={{ whiteSpace: 'nowrap', width: 110 }}>Date</th>
                  {isBO && <th></th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const status   = STATUS_LABEL[r.status] || STATUS_LABEL.pending
                  const isPending = r.status === 'pending'
                  const isSelectable = selectableSet.has(r.id)
                  const desc = r.item_name || r.description || r.product_name_label || ''
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        {showCheckCol && (
                          <td>
                            {isSelectable && (
                              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                            )}
                          </td>
                        )}
                        <td><strong>{TASK_FORMS[r.task_type]?.name || r.task_type}</strong></td>
                        <td>{storesById[r.store_id]?.store_name || <span className="td-muted">—</span>}</td>
                        <td className="td-code" style={{ whiteSpace: 'nowrap' }}>
                          {r.product_barcode || r.product_code || <span className="td-muted">—</span>}
                          {/* € = priced (still on the Pricing page). Empty bubble =
                              was sent for pricing but later removed from it. */}
                          {r.pricing_removed_at ? (
                            <span title={`Was sent for pricing — removed ${formatDT(r.pricing_removed_at)}`} style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              marginLeft: 6, width: 18, height: 18, borderRadius: '50%',
                              background: 'transparent', border: '1px solid #C9B26A',
                              verticalAlign: 'middle'
                            }} />
                          ) : r.priced_at && (
                            <span title={`Priced ${formatDT(r.priced_at)}`} style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              marginLeft: 6, width: 18, height: 18, borderRadius: '50%',
                              background: '#FCF3D9', color: '#8A6D1A', border: '1px solid #E7D39A',
                              fontSize: 11, fontWeight: 700, verticalAlign: 'middle'
                            }}>€</span>
                          )}
                        </td>
                        <td>{desc || <span className="td-muted">—</span>}</td>
                        <td className="td-code">{r.barcode_no || r.product_code || ''}</td>
                        <td>
                          <div className="flex-row" style={{ gap: 6 }}>
                            {r.photo_product_url && <a href={r.photo_product_url} target="_blank" rel="noopener noreferrer">📷 product</a>}
                            {r.photo_barcode_url && <a href={r.photo_barcode_url} target="_blank" rel="noopener noreferrer">📷 barcode</a>}
                            {!r.photo_product_url && !r.photo_barcode_url && <span className="td-muted">—</span>}
                          </div>
                        </td>
                        <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>
                          {formatDMY(r.created_at)}
                          {isPending && <AgeClock at={r.created_at} style={{ marginLeft: 6 }} />}
                        </td>
                        {isBO && (
                          <td>
                            <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                              {isPending && (
                                <>
                                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => reviewOne(r.id, 'completed')}>
                                    Complete
                                  </button>
                                  <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => reviewOne(r.id, 'no_change_needed')}>
                                    No change
                                  </button>
                                </>
                              )}
                              <button
                                className="btn btn-sm btn-outline"
                                title="All details for this record"
                                onClick={() => setDetailRecord(r)}
                              >🔍 Details</button>
                              <button
                                className={`btn btn-sm btn-icon ${expandedMessages.has(r.id) ? 'btn-primary' : 'btn-outline'}`}
                                title="Messages"
                                onClick={() => toggleMessages(r.id)}
                              >💬</button>
                              {(r.task_type === 'J' || r.task_type === 'K') && (
                                <button
                                  className="btn btn-sm"
                                  title="Permanently delete this record"
                                  onClick={() => setDeleteTarget({ ids: [r.id] })}
                                  style={{ background: '#C0392B', color: '#fff', border: 'none', fontWeight: 600 }}
                                >🗑</button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                      {/* Message thread panel */}
                      {expandedMessages.has(r.id) && (
                        <tr>
                          <td colSpan={isBO ? 9 : 8} style={{ padding: 0, borderTop: 'none' }}>
                            <RecordMessages
                              recordId={r.id}
                              resolvedAt={r.messages_resolved_at}
                              resolvedByName={r.messages_resolved_by_name}
                            />
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

      <RecordDetailModal
        open={!!detailRecord}
        record={detailRecord}
        storeName={detailRecord ? (storesById[detailRecord.store_id]?.store_name || '') : ''}
        onClose={() => setDetailRecord(null)}
      />

      <ConfirmDeleteModal
        open={!!deleteTarget}
        count={deleteTarget?.ids.length || 1}
        busy={deleting}
        dateFrom={from}
        dateTo={to}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null) }}
      />

      <ConfirmDeleteModal
        open={matchDelete}
        count={total}
        busy={matchDeleting}
        dateFrom={from}
        dateTo={to}
        onConfirm={runDeleteAllMatching}
        onCancel={() => { if (!matchDeleting) setMatchDelete(false) }}
      />
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
          <div className="table-wrap table-wrap--tall">
            <table>
              <thead><tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all rows" />
                </th>
                <th style={{ minWidth: 160 }}>Template</th>
                <th style={{ minWidth: 150 }}>Store</th>
                <th style={{ width: 100, whiteSpace: 'nowrap' }}>Due</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 140, whiteSpace: 'nowrap' }}>Completed at</th>
                <th style={{ minWidth: 200 }}>Block answers</th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const t = r.store_task_templates || {}
                  const blocks = Array.isArray(t.blocks) ? t.blocks : []
                  const ans = r.answers && typeof r.answers === 'object' ? r.answers : {}
                  const lines = blocks.map(b => {
                    const v = ans[b.id]
                    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null
                    const fmtOne = x => (x && typeof x === 'object' && !Array.isArray(x))
                      ? Object.values(x).filter(z => z !== null && z !== undefined && z !== '').join(' ')
                      : String(x ?? '')
                    const display = Array.isArray(v)
                      ? v.map(fmtOne).join(' | ')
                      : (typeof v === 'string' && v.startsWith('http')
                          ? <a href={v} target="_blank" rel="noopener noreferrer">📎 view</a>
                          : (typeof v === 'object' ? fmtOne(v) : String(v)))
                    return { label: b.label, display }
                  }).filter(Boolean)
                  return (
                    <tr key={r.id}>
                      <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                      <td><strong>{t.title || '—'}</strong>{t.category && <span className="chip" style={{ marginLeft: 6 }}>{t.category}</span>}</td>
                      <td>{storeName(r.store_id) || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.due_date || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={'badge ' + (r.status === 'completed' ? 'badge-completed' : r.status === 'missed' ? 'badge-deleted' : 'badge-pending')}>{r.status}</span>
                        {r.status === 'pending' && <AgeClock at={r.created_at} style={{ marginLeft: 5 }} />}
                      </td>
                      <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{r.completed_at ? new Date(r.completed_at).toLocaleString('en-IE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}</td>
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

// ── Space Plan report ────────────────────────────────────────────────────
const SP_COLS    = ['store_code','store_name','equipment','subcategory','planned_count','category','audited_count','equipment_audited_total','equipment_variance','last_count_date']
const SP_HEADERS = ['Store Code','Store Name','Equipment','Subcategory','Planned','Category','Audited (dept)','Audited Total','Variance','Last Count']
// minWidth per column, parallel to SP_COLS/SP_HEADERS — a floor, never a cap.
// 'equipment' has none: it's the descriptive column, left to absorb leftover width.
const SP_MIN_WIDTHS = [100, 150, undefined, 110, 80, 110, 90, 90, 90, 100]

function SpacePlanReport() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [stores, setStores]           = useState([])
  const [storeIds, setStoreIds]       = useState(isBO ? [] : (session.storeId ? [session.storeId] : []))
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (isBO) getStores().then(r => setStores(r.filter(s => s.is_active))).catch(() => {})
  }, [isBO])

  const fetchData = async () => {
    const storeParam = storeIds.length ? storeIds.join(',') : undefined
    return getSpacePlanReport(storeParam)
  }

  const run = async () => {
    setLoading(true); setError('')
    try {
      const { rows } = await fetchData()
      setRows(rows)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const downloadXLSX = async () => {
    setDownloading(true); setError('')
    try {
      const { rows } = await fetchData()
      if (!rows.length) { toast.error('No data to export yet.'); return }
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadExcel(`Space Plan - ${stamp}.xlsx`, rows, SP_COLS, SP_HEADERS)
    } catch (e) { setError(e.message) } finally { setDownloading(false) }
  }

  return (
    <div>
      <div className="card">
        <div className="card-body">
          <div className="filter-row">
            {isBO && (
              <div className="filter-field filter-field--wide"><label>Stores</label>
                <MultiSelectDropdown
                  value={storeIds}
                  onChange={setStoreIds}
                  options={stores.map(s => ({ id: s.id, label: s.store_name, subLabel: s.store_code }))}
                  placeholder="All stores"
                />
              </div>
            )}
            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={run} disabled={loading}>
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

      {rows.length > 0 && (
        <div className="card mt-20">
          <div className="card-header">{rows.length.toLocaleString('en-IE')} rows</div>
          <div className="table-wrap table-wrap--tall">
            <table>
              <thead><tr>{SP_HEADERS.map((h, i) => <th key={SP_COLS[i]} style={SP_MIN_WIDTHS[i] ? { minWidth: SP_MIN_WIDTHS[i] } : undefined}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {SP_COLS.map((c, j) => <td key={c} style={SP_MIN_WIDTHS[j] ? { whiteSpace: 'nowrap' } : undefined}>{r[c] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Competition report — competitors recorded per store, filterable + Excel.
function CompetitionReport() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [stores, setStores]           = useState([])
  const [storeIds, setStoreIds]       = useState(isBO ? [] : (session.storeId ? [session.storeId] : []))
  const [rows, setRows]               = useState([])
  const [loading, setLoading]         = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (isBO) getStores().then(r => setStores(r.filter(s => s.is_active))).catch(() => {})
  }, [isBO])

  const fetchData = async () => {
    const storeParam = storeIds.length ? storeIds.join(',') : undefined
    return getCompetitorReport(storeParam)
  }

  const run = async () => {
    setLoading(true); setError('')
    try { const { rows } = await fetchData(); setRows(rows) }
    catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const downloadXLSX = async () => {
    setDownloading(true); setError('')
    try {
      const { rows } = await fetchData()
      if (!rows.length) { toast.error('No data to export yet.'); return }
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadExcel(`Competition - ${stamp}.xlsx`, rows, COMPETITION_REPORT_COLS, COMPETITION_REPORT_HEADERS)
    } catch (e) { setError(e.message) } finally { setDownloading(false) }
  }

  return (
    <div>
      <div className="card">
        <div className="card-body">
          <div className="filter-row">
            {isBO && (
              <div className="filter-field filter-field--wide"><label>Stores</label>
                <MultiSelectDropdown
                  value={storeIds}
                  onChange={setStoreIds}
                  options={stores.map(s => ({ id: s.id, label: s.store_name, subLabel: s.store_code }))}
                  placeholder="All stores"
                />
              </div>
            )}
            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={run} disabled={loading}>
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

      {rows.length > 0 && (
        <div className="card mt-20">
          <div className="card-header">{rows.length.toLocaleString('en-IE')} rows</div>
          <div className="table-wrap table-wrap--tall">
            <table>
              <thead><tr>{COMPETITION_REPORT_HEADERS.map((h, i) => <th key={COMPETITION_REPORT_COLS[i]} style={COMPETITION_REPORT_MIN_WIDTHS[i] ? { minWidth: COMPETITION_REPORT_MIN_WIDTHS[i] } : undefined}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {COMPETITION_REPORT_COLS.map((c, j) => <td key={c} style={COMPETITION_REPORT_MIN_WIDTHS[j] ? { whiteSpace: 'nowrap' } : undefined}>{r[c] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// Audit-ledger panel shown under a record row when History is expanded.
