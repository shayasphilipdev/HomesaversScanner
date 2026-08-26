import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../App.jsx'
import { getStores, getExpiryOverview } from '../lib/api.js'
import { downloadExcel } from '../lib/excel.js'
import { useToast } from '../components/Toast.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import { EXPIRY_CATEGORIES, EXPIRY_ACTIONS, expiryTone } from '../lib/expiry.js'

// HQ Expiry Overview — unifies Task M (Routine Expiry Sweep) records and the
// scheduled Store-Task "expiry sweep" block lines into one line-level view with
// summary totals by Reduce-to-Clear action. Back-office only.
export default function ExpiryReport() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const now      = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 86400000)
  const iso      = d => d.toISOString().slice(0, 10)

  const [from, setFrom]         = useState(iso(monthAgo))
  const [to, setTo]             = useState(iso(now))
  const [storeIds, setStoreIds] = useState([])
  const [category, setCategory] = useState('')
  const [action, setAction]     = useState('')
  const [stores, setStores]     = useState([])

  const [data, setData]         = useState(null)   // { rows, summary, cols, headers }
  const [loading, setLoading]   = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (isBO) getStores().then(setStores).catch(() => setStores([]))
  }, [isBO])

  const run = async () => {
    setLoading(true); setError('')
    try {
      const res = await getExpiryOverview({
        from, to,
        storeId: storeIds.length ? storeIds.join(',') : undefined
      })
      setData(res)
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setLoading(false) }
  }

  // Client-side category / action narrowing on the fetched rows.
  const rows = useMemo(() => {
    const all = data?.rows || []
    return all.filter(r =>
      (!category || r.category === category) &&
      (!action   || r.action === action)
    )
  }, [data, category, action])

  // Recompute the headline totals from the currently-filtered rows.
  const summary = useMemo(() => {
    const s = { total: rows.length, reduced: 0, written_off: 0, rotated: 0, byAction: {} }
    for (const r of rows) {
      const u = Number(r.units) || 0
      const a = r.action || '(none)'
      if (!s.byAction[a]) s.byAction[a] = { lines: 0, units: 0 }
      s.byAction[a].lines++
      s.byAction[a].units += u
      if (a === 'Write Off')          s.written_off += u
      else if (a.startsWith('Reduce')) s.reduced += u
      else if (a === 'Rotate')        s.rotated++
    }
    return s
  }, [rows])

  const downloadXLSX = async () => {
    if (!rows.length) return
    setDownloading(true); setError('')
    try {
      await downloadExcel(
        `expiry-overview-${from}-to-${to}.xlsx`,
        rows, data.cols, data.headers
      )
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setDownloading(false) }
  }

  return (
    <div>
      <div className="card">
        <div className="card-body">
          <div className="filter-row">
            <div className="filter-field"><label>From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="filter-field"><label>To</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
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
            <div className="filter-field"><label>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">All</option>
                {EXPIRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filter-field"><label>Action</label>
              <select value={action} onChange={e => setAction(e.target.value)}>
                <option value="">All</option>
                {EXPIRY_ACTIONS.map(a => <option key={a.v} value={a.v}>{a.v}</option>)}
              </select>
            </div>
            <div className="filter-actions">
              <button className="btn btn-sm btn-primary" onClick={run} disabled={loading}>
                {loading ? (<><span className="spinner" /> Loading…</>) : 'Run report'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={downloadXLSX} disabled={downloading || !rows.length}>
                {downloading ? (<><span className="spinner spinner-dark" /> Preparing…</>) : '↓ Excel'}
              </button>
            </div>
          </div>
          {error && <div className="login-error mt-12">{error}</div>}
        </div>
      </div>

      {data?.truncated && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 8,
          background: '#FFF7E0', border: '1px solid #E0A03A',
          display: 'flex', gap: 10, alignItems: 'flex-start'
        }}>
          <span aria-hidden style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>
            <strong>Showing the most recent {data.row_cap?.toLocaleString?.() || data.row_cap} rows only.</strong>{' '}
            This range returned more data than one report can load, so the totals below are
            incomplete. Narrow the date range or select fewer stores for accurate figures.
          </span>
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="kpi-grid" style={{ marginTop: 16 }}>
            <SummaryCard label="Units reduced"      value={summary.reduced}     tone="#B47F1E" />
            <SummaryCard label="Units written off"  value={summary.written_off} tone="#c0392b" />
            <SummaryCard label="Lines rotated"      value={summary.rotated}     tone="#1E7B34" />
            <SummaryCard label="Total lines logged" value={summary.total}       tone="var(--text)" />
          </div>

          {/* By-action breakdown */}
          {Object.keys(summary.byAction).length > 0 && (
            <div className="card mt-20">
              <div className="card-header">By action</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Action</th><th className="td-right">Lines</th><th className="td-right">Units</th></tr></thead>
                  <tbody>
                    {EXPIRY_ACTIONS.map(a => a.v).concat(
                      Object.keys(summary.byAction).filter(k => !EXPIRY_ACTIONS.some(a => a.v === k))
                    ).filter(k => summary.byAction[k]).map(k => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="td-right">{summary.byAction[k].lines}</td>
                        <td className="td-right">{summary.byAction[k].units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Line detail */}
          <div className="card mt-20">
            <div className="card-header">{rows.length} line{rows.length === 1 ? '' : 's'}</div>
            {rows.length === 0 ? (
              <div className="empty-state" style={{ padding: 30 }}>
                <p className="note">No expiry activity for this range/filter.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>Source</th><th>Store</th><th>Date</th><th>Category</th>
                    <th>Barcode</th><th>Description</th><th>Expiry</th>
                    <th className="td-right">Days</th><th className="td-right">Units</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const tone = r.days_to_expiry === '' || r.days_to_expiry == null ? null : expiryTone(Number(r.days_to_expiry))
                      return (
                        <tr key={i}>
                          <td><span className="chip" style={{ fontSize: 11 }}>{r.source}</span></td>
                          <td>{r.store_name || '—'}</td>
                          <td className="td-muted">{r.date || '—'}</td>
                          <td>{r.category || <span className="td-muted">—</span>}</td>
                          <td className="td-code">{r.barcode || '—'}</td>
                          <td>{r.description || <span className="td-muted">—</span>}</td>
                          <td>{r.expiry_date || '—'}</td>
                          <td className="td-right" style={tone ? { color: tone.c, fontWeight: 700 } : undefined}>
                            {r.days_to_expiry === '' || r.days_to_expiry == null ? '—' : r.days_to_expiry}
                          </td>
                          <td className="td-right">{r.units === '' || r.units == null ? '—' : r.units}</td>
                          <td>{r.action || <span className="td-muted">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className="card">
      <div className="card-body" style={{ padding: 16 }}>
        <div className="note" style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: tone }}>{value}</div>
      </div>
    </div>
  )
}
