import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListProducts, adminProductsCount, adminBulkProducts, adminUpdateProduct,
  getSuppliers
} from '../lib/api.js'
import { parseCSV } from '../lib/csv.js'
import AdminNav from '../components/AdminNav.jsx'
import { useToast } from '../components/Toast.jsx'

// Back-office only — Product Master admin.
// - Shows the most-recent N products + a search box.
// - Bulk CSV upsert by product_id (existing rows are updated, new rows inserted).
export default function AdminProducts() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [count, setCount]       = useState(0)
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [q, setQ]               = useState('')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [c, p, s] = await Promise.all([
        adminProductsCount(),
        adminListProducts({ limit: 100, q: q || undefined }),
        getSuppliers().catch(() => [])
      ])
      setCount(c.count); setProducts(p); setSuppliers(s)
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

      {!loading && !!products.length && (
        <p className="note" style={{ marginBottom: 10 }}>Click a row to edit the supplier or other fields.</p>
      )}

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
                  <th>Supplier</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    suppliers={suppliers}
                    editing={editingId === p.id}
                    onEdit={() => setEditingId(p.id)}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); load() }}
                    toast={toast}
                  />
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
  const toast = useToast()
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
      const idIdx       = lower.findIndex(h => h === 'product_id' || h === 'id' || h === 'barcode')
      const descIdx     = lower.findIndex(h => h === 'description' || h === 'name')
      const uomIdx      = lower.findIndex(h => h === 'uom')
      const catIdx      = lower.findIndex(h => h === 'category')
      const supplierIdx = lower.findIndex(h => h === 'supplier_name' || h === 'supplier')
      if (idIdx === -1) {
        setErr('CSV must include a "product_id" (or "id"/"barcode") column.')
        return
      }
      const warnings = []
      const clean = rows.map((r, i) => {
        const id = (r[headers[idIdx]] || '').trim()
        if (!id) { warnings.push(`Row ${i + 2}: missing product_id — skipped`); return null }
        return {
          product_id:    id,
          description:   descIdx     > -1 ? (r[headers[descIdx]]     || '').trim() : '',
          uom:           uomIdx      > -1 ? (r[headers[uomIdx]]      || '').trim() : '',
          category:      catIdx      > -1 ? (r[headers[catIdx]]      || '').trim() : '',
          supplier_name: supplierIdx > -1 ? (r[headers[supplierIdx]] || '').trim() : ''
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
      toast.success(`Upserted ${res.written} product${res.written === 1 ? '' : 's'}.`)
      onDone()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Bulk CSV upload (upsert by product_id)</div>
      <div className="card-body">
        <p className="note" style={{ marginTop: 0 }}>
          Required: <code>product_id</code>. Optional: <code>description</code>, <code>uom</code>, <code>category</code>, <code>supplier_name</code> (matched against active suppliers; unknown names are ignored). Existing rows are updated by <code>product_id</code>.
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
                <thead><tr><th>Product ID</th><th>Description</th><th>UOM</th><th>Category</th><th>Supplier</th></tr></thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="td-code">{r.product_id}</td>
                      <td>{r.description || ''}</td>
                      <td>{r.uom || ''}</td>
                      <td>{r.category || ''}</td>
                      <td>{r.supplier_name || ''}</td>
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

function ProductRow({ product, suppliers, editing, onEdit, onCancel, onSaved, toast }) {
  const [form, setForm] = useState({
    description: product.description || '',
    uom:         product.uom || '',
    category:    product.category || '',
    supplier_id: product.supplier_id || ''
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const supplierName = (id) =>
    suppliers.find(s => s.id === id)?.supplier_name || product.supplier_name || ''

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await adminUpdateProduct(product.id, {
        description: form.description.trim() || null,
        uom:         form.uom.trim() || null,
        category:    form.category.trim() || null,
        supplier_id: form.supplier_id || null
      })
      toast.success('Product updated.')
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <tr>
        <td className="td-code">{product.product_id}</td>
        <td><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></td>
        <td><input value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} style={{ width: 90 }} /></td>
        <td><input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ width: 120 }} /></td>
        <td>
          <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
            <option value="">— None —</option>
            {suppliers.filter(s => s.is_active).map(s => (
              <option key={s.id} value={s.id}>{s.supplier_name}</option>
            ))}
          </select>
        </td>
        <td className="td-muted">{product.updated_at ? new Date(product.updated_at).toLocaleDateString('en-IE') : '—'}</td>
        <td>
          {err && <div className="login-error" style={{ marginBottom: 6, fontSize: 12 }}>{err}</div>}
          <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-outline" onClick={onCancel} disabled={saving}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="td-code">{product.product_id}</td>
      <td>{product.description || <span className="td-muted">—</span>}</td>
      <td>{product.uom || <span className="td-muted">—</span>}</td>
      <td>{product.category || <span className="td-muted">—</span>}</td>
      <td>{supplierName(product.supplier_id) || <span className="td-muted">—</span>}</td>
      <td className="td-muted">{product.updated_at ? new Date(product.updated_at).toLocaleDateString('en-IE') : '—'}</td>
      <td>
        <button className="btn btn-sm btn-outline" onClick={onEdit}>Edit</button>
      </td>
    </tr>
  )
}
