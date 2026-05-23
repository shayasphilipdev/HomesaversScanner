import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { adminListAltBarcodes, adminAltBarcodesCount } from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'
import { canAccessAdmin } from '../lib/roles.js'

// Products = the imported Alternate Barcode table (read-only). The data is
// owned by the daily PowerShell sync; this page is just a window onto it with
// search + a row cap so the 200k-row table stays responsive.
function StatusPill({ value }) {
  const v = (value || '').toLowerCase()
  const tone = v === 'active'
    ? { bg: '#E6F4EA', fg: '#1E7B34' }
    : v === 'inactive'
      ? { bg: '#FCF3E2', fg: '#9A6B12' }
      : { bg: 'var(--bg-soft)', fg: 'var(--text-muted)' }
  return (
    <span style={{ background: tone.bg, color: tone.fg, borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>
      {value || '—'}
    </span>
  )
}

export default function AdminProducts() {
  const { session } = useStore()
  const [data, setData]       = useState([])
  const [count, setCount]     = useState(0)
  const [q, setQ]             = useState('')
  const [limit, setLimit]     = useState(200)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [c, rows] = await Promise.all([
        adminAltBarcodesCount().catch(() => ({ count: 0 })),
        adminListAltBarcodes({ limit, q: q || undefined })
      ])
      setCount(c.count); setData(rows)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [limit])

  if (!canAccessAdmin(session)) {
    return <div className="card"><div className="empty-state"><p>Admin-only page.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Products</div>
          <div className="page-subtitle">Imported Alternate Barcode table — synced daily, read-only.</div>
        </div>
      </div>

      <AdminNav />

      {error && <div className="login-error mt-12">{error}</div>}

      <div className="card">
        <div className="card-body">
          <div className="flex-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div className="filter-field filter-field--wide">
              <label>Search</label>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load()}
                placeholder="barcode, EAN, item name or supplier…"
              />
            </div>
            <div className="filter-field">
              <label>Rows</label>
              <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </div>
            <div className="filter-field">
              <label>&nbsp;</label>
              <button className="btn btn-sm btn-primary" onClick={load} disabled={loading}>
                {loading ? <span className="spinner" /> : 'Search'}
              </button>
            </div>
            <div className="filter-field" style={{ marginLeft: 'auto' }}>
              <span className="note" style={{ fontSize: 13 }}>
                {count.toLocaleString('en-IE')} total · showing {data.length.toLocaleString('en-IE')}
              </span>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
          ) : !data.length ? (
            <div className="empty-state"><p>No rows. Has the sync run yet?</p></div>
          ) : (
            <div className="table-wrap">
              <table style={{ fontSize: 13 }}>
                <thead><tr>
                  <th>Barcode No</th>
                  <th>EAN</th>
                  <th>Item name</th>
                  <th>Supplier</th>
                  <th>Code</th>
                  <th>Product</th>
                  <th>Barcode</th>
                </tr></thead>
                <tbody>
                  {data.map(r => (
                    <tr key={r.id}>
                      <td className="td-code">{r.barcode_no}</td>
                      <td className="td-muted">{r.ean_barcode || '—'}</td>
                      <td>{r.item_name || '—'}</td>
                      <td>{r.supl_id || '—'}</td>
                      <td className="td-muted">{r.supplier_code || '—'}</td>
                      <td><StatusPill value={r.item_status} /></td>
                      <td><StatusPill value={r.barcode_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
