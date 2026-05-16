import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { adminListProducts, adminProductsCount, adminBulkProducts } from '../lib/api.js'
import { parseCSV } from '../lib/csv.js'
import AdminNav from '../components/AdminNav.jsx'

// Back-office only — Product Master admin.
// - Shows the most-recent N products + a search box.
// - Bulk CSV upsert by product_id (existing rows are updated, new rows inserted).
export default function AdminProducts() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [count, setCount]       = useState(0)
  const [products, setProducts] = useState([])
  const [q, setQ]               = useState('')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [showBulk, setShowBulk] = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [c, p] = await Promise.all([
        adminProductsCount(),
        adminListProducts({ limit: 100, q: q || undefined })
      ])
      setCount(c.count); setProducts(p)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { if (isBO) load() /* eslint-disable-next-line */ }, [isBO])

  if (!isBO) {
    return <div className="card"><div className="empty-state"><p>Admin pages are only available to back-office users.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Products master</div>
          <div className="page-subtitle">{count.toLocaleString('en-IE')} total · showing most recent 100</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
          placeholder="Search product id or description…" style={{ flex: '1 1 240px', maxWidth: 360 }}
        />
        <button className="btn btn-sm btn-outline" onClick={load}>Search</button>
        <button className="btn btn-sm btn-primary" onClick={() => setShowBulk(v => !v)}>
          {showBulk ? '✕ Cancel' : '↥ Bulk CSV upload'}
        </button>
      </div>

      {showBulk && <BulkUpload onDone={() => { setShowBulk(false); load() }} />}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !products.length ? (
        <div className="card"><div className="empty-state"><p>No products found.</p></div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product ID</th>
                  <th>Description</th>
                  <th>UOM</th>
                  <th>Category</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td className="td-code">{p.product_id}</td>
                    <td>{p.description || <span className="td-muted">—</span>}</td>
                    <td>{p.uom || <span className="td-muted">—</span>}</td>
                    <td>{p.category || <span className="td-muted">—</span>}</td>
                    <td className="td-muted">{p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-IE') : '—'}</td>
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

function BulkUpload({ onDone }) {
  const [preview, setPreview] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const handleFile = async (e) => {
    setErr('')
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const { headers, rows } = parseCSV(text)
      const lower = headers.map(h => h.toLowerCase())
      const idIdx   = lower.findIndex(h => h === 'product_id' || h === 'id' || h === 'barcode')
      const descIdx = lower.findIndex(h => h === 'description' || h === 'name')
      const uomIdx  = lower.findIndex(h => h === 'uom')
      const catIdx  = lower.findIndex(h => h === 'category')
      if (idIdx === -1) {
        setErr('CSV must include a "product_id" (or "id"/"barcode") column.')
        return
      }
      const warnings = []
      const clean = rows.map((r, i) => {
        const id = (r[headers[idIdx]] || '').trim()
        if (!id) { warnings.push(`Row ${i + 2}: missing product_id — skipped`); return null }
        return {
          product_id:  id,
          description: descIdx > -1 ? (r[headers[descIdx]] || '').trim() : '',
          uom:         uomIdx  > -1 ? (r[headers[uomIdx]]  || '').trim() : '',
          category:    catIdx  > -1 ? (r[headers[catIdx]]  || '').trim() : ''
        }
      }).filter(Boolean)
      setPreview({ rows: clean, warnings })
    } catch (e) {
      setErr(e.message || 'Could not parse CSV')
    } finally {
      e.target.value = ''
    }
  }

  const confirm = async () => {
    if (!preview?.rows?.length) return
    setSaving(true); setErr('')
    try {
      const res = await adminBulkProducts(preview.rows)
      setPreview(null)
      alert(`Upserted ${res.written} product(s).`)
      onDone()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Bulk CSV upload (upsert by product_id)</div>
      <div className="card-body">
        <p className="note" style={{ marginTop: 0 }}>
          Required: <code>product_id</code>. Optional: <code>description</code>, <code>uom</code>, <code>category</code>. Existing rows with the same <code>product_id</code> are updated.
        </p>
        {!preview && <input type="file" accept=".csv,text/csv" onChange={handleFile} />}
        {preview && (
          <>
            <p><strong>{preview.rows.length}</strong> row(s) ready to upsert.</p>
            {preview.warnings.length > 0 && (
              <div className="warning-box mb-12">
                <span className="warning-icon">⚠️</span>
                <div>
                  <strong>{preview.warnings.length} warning(s):</strong>
                  <ul style={{ marginTop: 4, marginBottom: 0 }}>
                    {preview.warnings.slice(0, 5).map((w, i) => <li key={i} style={{ fontSize: 13 }}>{w}</li>)}
                    {preview.warnings.length > 5 && <li style={{ fontSize: 13 }}>…and {preview.warnings.length - 5} more</li>}
                  </ul>
                </div>
              </div>
            )}
            <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
              <table style={{ fontSize: 13 }}>
                <thead><tr><th>Product ID</th><th>Description</th><th>UOM</th><th>Category</th></tr></thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="td-code">{r.product_id}</td>
                      <td>{r.description || ''}</td>
                      <td>{r.uom || ''}</td>
                      <td>{r.category || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 100 && <div className="note" style={{ padding: 6 }}>Showing first 100 of {preview.rows.length}.</div>}
            </div>
            <div className="flex-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setPreview(null)} disabled={saving}>Discard</button>
              <button className="btn btn-primary btn-sm" onClick={confirm} disabled={saving}>
                {saving ? <><span className="spinner" /> Importing…</> : `Upsert ${preview.rows.length} product(s)`}
              </button>
            </div>
          </>
        )}
        {err && <div className="login-error mt-12">{err}</div>}
      </div>
    </div>
  )
}
