import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListSuppliers, adminCreateSupplier, adminUpdateSupplier, adminBulkSuppliers
} from '../lib/api.js'
import { parseCSV } from '../lib/csv.js'
import AdminNav from '../components/AdminNav.jsx'

// Back-office only — Suppliers admin.
// - List all suppliers (active + inactive)
// - Add one
// - Edit name / code / active state inline
// - CSV bulk upload (client-parsed → POST /admin/suppliers/bulk)
export default function AdminSuppliers() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [editingId, setEditingId] = useState(null)
  const [showAdd, setShowAdd]     = useState(false)
  const [showBulk, setShowBulk]   = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try { setSuppliers(await adminListSuppliers()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (isBO) load() }, [isBO])

  if (!isBO) {
    return <div className="card"><div className="empty-state"><p>Admin pages are only available to back-office users.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Suppliers admin</div>
          <div className="page-subtitle">{suppliers.length} suppliers</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(v => !v); setShowBulk(false) }}>
          {showAdd ? '✕ Cancel' : '+ Add supplier'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => { setShowBulk(v => !v); setShowAdd(false) }}>
          {showBulk ? '✕ Cancel' : '↥ Bulk CSV upload'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {showAdd && <AddSupplier onCreated={() => { setShowAdd(false); load() }} />}
      {showBulk && <BulkUpload onDone={() => { setShowBulk(false); load() }} />}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !suppliers.length ? (
        <div className="card"><div className="empty-state"><p>No suppliers yet — add one above or upload a CSV.</p></div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => (
                  <SupplierRow
                    key={s.id}
                    supplier={s}
                    editing={editingId === s.id}
                    onEdit={() => setEditingId(s.id)}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); load() }}
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

function AddSupplier({ onCreated }) {
  const [form, setForm] = useState({ supplier_code: '', supplier_name: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.supplier_name.trim()) return setErr('Supplier name is required')
    setSaving(true); setErr('')
    try {
      await adminCreateSupplier({
        supplier_code: form.supplier_code.trim() || null,
        supplier_name: form.supplier_name.trim()
      })
      setForm({ supplier_code: '', supplier_name: '' })
      onCreated()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Add supplier</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Supplier Code (optional)</label>
              <input value={form.supplier_code} onChange={e => setForm(f => ({ ...f, supplier_code: e.target.value }))} placeholder="e.g. SUP001" />
            </div>
            <div className="form-group">
              <label>Supplier Name *</label>
              <input value={form.supplier_name} onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} placeholder="e.g. Acme Wholesale" />
            </div>
          </div>
          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : 'Create supplier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BulkUpload({ onDone }) {
  const [preview, setPreview] = useState(null)  // { rows: [{supplier_code?, supplier_name}], warnings: [] }
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const handleFile = async (e) => {
    setErr('')
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const { headers, rows } = parseCSV(text)
      // Tolerant column matching — accept supplier_code / code / id and
      // supplier_name / name. Lowercased.
      const lower = headers.map(h => h.toLowerCase())
      const codeIdx = lower.findIndex(h => h === 'supplier_code' || h === 'code' || h === 'id')
      const nameIdx = lower.findIndex(h => h === 'supplier_name' || h === 'name')
      if (nameIdx === -1) {
        setErr('CSV must include a "supplier_name" (or "name") column.')
        return
      }
      const warnings = []
      const clean = rows.map((r, i) => {
        const name = (r[headers[nameIdx]] || '').trim()
        const code = codeIdx === -1 ? '' : (r[headers[codeIdx]] || '').trim()
        if (!name) { warnings.push(`Row ${i + 2}: missing supplier_name — skipped`); return null }
        return { supplier_code: code || null, supplier_name: name }
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
      const res = await adminBulkSuppliers(preview.rows)
      setPreview(null)
      onDone()
      alert(`Imported ${res.inserted} supplier(s).`)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Bulk CSV upload</div>
      <div className="card-body">
        <p className="note" style={{ marginTop: 0 }}>
          Required columns: <code>supplier_name</code>. Optional: <code>supplier_code</code>. First row is treated as the header.
        </p>
        {!preview && (
          <input type="file" accept=".csv,text/csv" onChange={handleFile} />
        )}
        {preview && (
          <>
            <p><strong>{preview.rows.length}</strong> valid row(s) ready to import.</p>
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
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--gray-200)', borderRadius: 6, marginBottom: 12 }}>
              <table style={{ fontSize: 13 }}>
                <thead><tr><th>Code</th><th>Name</th></tr></thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((r, i) => (
                    <tr key={i}><td className="td-code">{r.supplier_code || ''}</td><td>{r.supplier_name}</td></tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 50 && <div className="note" style={{ padding: 6 }}>Showing first 50 of {preview.rows.length}.</div>}
            </div>
            <div className="flex-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setPreview(null)} disabled={saving}>Discard</button>
              <button className="btn btn-primary btn-sm" onClick={confirm} disabled={saving}>
                {saving ? <><span className="spinner" /> Importing…</> : `Import ${preview.rows.length} supplier(s)`}
              </button>
            </div>
          </>
        )}
        {err && <div className="login-error mt-12">{err}</div>}
      </div>
    </div>
  )
}

function SupplierRow({ supplier, editing, onEdit, onCancel, onSaved }) {
  const [form, setForm] = useState({ supplier_code: supplier.supplier_code || '', supplier_name: supplier.supplier_name })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await adminUpdateSupplier(supplier.id, {
        supplier_code: form.supplier_code.trim() || null,
        supplier_name: form.supplier_name.trim()
      })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async () => {
    setSaving(true); setErr('')
    try { await adminUpdateSupplier(supplier.id, { is_active: !supplier.is_active }); onSaved() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <tr>
        <td><input value={form.supplier_code} onChange={e => setForm(f => ({ ...f, supplier_code: e.target.value }))} style={{ width: 110 }} /></td>
        <td><input value={form.supplier_name} onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} /></td>
        <td>{supplier.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
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
      <td className="td-code">{supplier.supplier_code || <span className="td-muted">—</span>}</td>
      <td>{supplier.supplier_name}</td>
      <td>{supplier.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
      <td>
        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onEdit}>Edit</button>
          <button className="btn btn-sm btn-outline" onClick={toggleActive}>
            {supplier.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </td>
    </tr>
  )
}
