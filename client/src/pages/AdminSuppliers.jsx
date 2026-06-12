import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListSuppliers, adminCreateSupplier, adminUpdateSupplier,
  adminDeleteSupplier, adminSeedSuppliers
} from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'

const EMPTY_FORM = { supplier_code: '', supplier_name: '', is_active: true }

export default function AdminSuppliers() {
  const { session } = useStore()
  const isAdmin = session.mode === 'backoffice'

  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [seeding, setSeeding]     = useState(false)
  const [seedResult, setSeedResult] = useState(null)

  // Modal state
  const [modal, setModal]     = useState(null)  // null | 'add' | 'edit'
  const [editing, setEditing] = useState(null)  // supplier row being edited
  const [form, setForm]       = useState(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState('')

  // Search filter
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const rows = await adminListSuppliers()
      setSuppliers(rows)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  const openAdd = () => {
    setForm(EMPTY_FORM); setFormError(''); setEditing(null); setModal('add')
  }

  const openEdit = (s) => {
    setForm({ supplier_code: s.supplier_code || '', supplier_name: s.supplier_name || '', is_active: s.is_active })
    setFormError(''); setEditing(s); setModal('edit')
  }

  const closeModal = () => { setModal(null); setEditing(null); setForm(EMPTY_FORM) }

  const handleSave = async () => {
    if (!form.supplier_name.trim()) { setFormError('Supplier Name is required.'); return }
    setSaving(true); setFormError('')
    try {
      if (modal === 'add') {
        await adminCreateSupplier({ supplier_code: form.supplier_code.trim() || null, supplier_name: form.supplier_name.trim(), is_active: true })
      } else {
        await adminUpdateSupplier(editing.id, { supplier_code: form.supplier_code.trim() || null, supplier_name: form.supplier_name.trim(), is_active: form.is_active })
      }
      await load()
      closeModal()
    } catch (e) { setFormError(e.message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (s) => {
    if (!confirm(`Delete supplier "${s.supplier_name}"? This cannot be undone.`)) return
    try {
      await adminDeleteSupplier(s.id)
      setSuppliers(prev => prev.filter(x => x.id !== s.id))
    } catch (e) { alert('Delete failed: ' + e.message) }
  }

  const handleSeed = async () => {
    if (!confirm('This will add new suppliers from the Alt Barcodes table (no existing entries will be changed). Continue?')) return
    setSeeding(true); setSeedResult(null); setError('')
    try {
      const result = await adminSeedSuppliers()
      setSeedResult(result)
      await load()
    } catch (e) { setError(e.message) }
    finally { setSeeding(false) }
  }

  const filtered = suppliers.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (s.supplier_code || '').toLowerCase().includes(q) || (s.supplier_name || '').toLowerCase().includes(q)
  })

  if (!isAdmin) {
    return <div className="card"><div className="empty-state"><p>Admin pages are only available to back-office users.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Suppliers</div>
          <div className="page-subtitle">Manage supplier list · {suppliers.length} total</div>
        </div>
        <div className="flex-row" style={{ gap: 8 }}>
          <button className="btn btn-sm btn-outline" onClick={handleSeed} disabled={seeding}>
            {seeding ? <><span className="spinner" /> Seeding…</> : '↓ Seed from Alt Barcodes'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={openAdd}>+ Add supplier</button>
        </div>
      </div>

      <AdminNav />

      {seedResult && (
        <div className="warning-box mb-12" style={{ background: '#E6F4EA', borderColor: '#3E9F4B' }}>
          <span>✓</span>
          <div>Seeded {seedResult.inserted} new suppliers ({seedResult.skipped} already existed).</div>
        </div>
      )}

      {error && <div className="login-error mb-12">{error}</div>}

      <div style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search by code or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
      </div>

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supplier Code</th>
                  <th>Supplier Name</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    {search ? 'No suppliers match your search.' : 'No suppliers yet. Use "Seed from Alt Barcodes" to populate.'}
                  </td></tr>
                )}
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td className="td-code">{s.supplier_code || <span className="td-muted">—</span>}</td>
                    <td>{s.supplier_name}</td>
                    <td>
                      <span className={`badge ${s.is_active ? 'badge-completed' : 'badge-pending'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}>Edit</button>
                        <button className="btn btn-sm btn-icon btn-outline" title="Delete" onClick={() => handleDelete(s)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }} onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="card" style={{ width: '100%', maxWidth: 440, margin: 0 }}>
            <div className="card-header">
              {modal === 'add' ? 'Add supplier' : `Edit: ${editing?.supplier_name}`}
            </div>
            <div className="card-body">
              <div className="form-group">
                <label>Supplier Code</label>
                <input
                  type="text"
                  value={form.supplier_code}
                  onChange={e => setForm(f => ({ ...f, supplier_code: e.target.value }))}
                  placeholder="e.g. SMITH001 (optional)"
                />
              </div>
              <div className="form-group">
                <label>Supplier Name *</label>
                <input
                  type="text"
                  value={form.supplier_name}
                  onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
                  placeholder="e.g. Smith Bakeries Ltd"
                  autoFocus
                />
              </div>
              {modal === 'edit' && (
                <div className="form-group">
                  <label>Status</label>
                  <div className="flex-row" style={{ gap: 10, marginTop: 4 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${form.is_active ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setForm(f => ({ ...f, is_active: true }))}
                    >Active</button>
                    <button
                      type="button"
                      className={`btn btn-sm ${!form.is_active ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setForm(f => ({ ...f, is_active: false }))}
                    >Inactive</button>
                  </div>
                </div>
              )}
              {formError && <div className="login-error mt-8">{formError}</div>}
              <div className="flex-row" style={{ gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-outline" onClick={closeModal} disabled={saving}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <span className="spinner" /> : modal === 'add' ? 'Add' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
