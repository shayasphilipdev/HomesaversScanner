import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { adminListStores, adminCreateStore, adminUpdateStore, adminResetStorePin } from '../lib/api.js'

// Back-office only — Stores admin.
// - Lists all stores (active + inactive)
// - Add new store (code, name, region, initial PIN)
// - Edit code/name/region/active-state inline
// - Reset PIN
export default function AdminStores() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [stores, setStores]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pinResetId, setPinResetId] = useState(null)
  const [showAdd, setShowAdd]   = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try { setStores(await adminListStores()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (isBO) load() }, [isBO])

  if (!isBO) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>Admin pages are only available to back-office users.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Stores admin</div>
          <div className="page-subtitle">Manage stores · {stores.length} total</div>
        </div>
      </div>

      <div className="flex-row" style={{ marginBottom: 16, gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? '✕ Cancel' : '+ Add store'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {showAdd && <AddStore onCreated={() => { setShowAdd(false); load() }} />}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !stores.length ? (
        <div className="card"><div className="empty-state"><p>No stores yet — add your first one above.</p></div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Region</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stores.map(s => (
                  <StoreRow
                    key={s.id}
                    store={s}
                    editing={editingId === s.id}
                    resettingPin={pinResetId === s.id}
                    onEdit={() => { setEditingId(s.id); setPinResetId(null) }}
                    onCancelEdit={() => setEditingId(null)}
                    onResetPin={() => { setPinResetId(s.id); setEditingId(null) }}
                    onCancelResetPin={() => setPinResetId(null)}
                    onSaved={() => { setEditingId(null); setPinResetId(null); load() }}
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

function AddStore({ onCreated }) {
  const [form, setForm] = useState({ store_code: '', store_name: '', region: '', pin: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.store_code.trim()) return setErr('Store code is required')
    if (!form.store_name.trim()) return setErr('Store name is required')
    if (form.pin.length < 4)     return setErr('PIN must be at least 4 characters')
    setSaving(true); setErr('')
    try {
      await adminCreateStore({
        store_code: form.store_code.trim(),
        store_name: form.store_name.trim(),
        region:     form.region.trim() || null,
        pin:        form.pin
      })
      setForm({ store_code: '', store_name: '', region: '', pin: '' })
      onCreated()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Add store</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Store Code *</label>
              <input value={form.store_code} onChange={e => setForm(f => ({ ...f, store_code: e.target.value }))} placeholder="e.g. 1016" />
            </div>
            <div className="form-group">
              <label>Store Name *</label>
              <input value={form.store_name} onChange={e => setForm(f => ({ ...f, store_name: e.target.value }))} placeholder="e.g. Cork" />
            </div>
            <div className="form-group">
              <label>Region</label>
              <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="e.g. Area 2" />
            </div>
            <div className="form-group">
              <label>Initial PIN *</label>
              <input type="text" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} placeholder="≥ 4 characters" />
            </div>
          </div>
          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : 'Create store'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StoreRow({ store, editing, resettingPin, onEdit, onCancelEdit, onResetPin, onCancelResetPin, onSaved }) {
  const [form, setForm]   = useState({ store_code: store.store_code, store_name: store.store_name, region: store.region || '' })
  const [newPin, setNewPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await adminUpdateStore(store.id, {
        store_code: form.store_code.trim(),
        store_name: form.store_name.trim(),
        region:     form.region.trim() || null
      })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async () => {
    setSaving(true); setErr('')
    try { await adminUpdateStore(store.id, { is_active: !store.is_active }); onSaved() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const resetPin = async () => {
    if (newPin.length < 4) return setErr('PIN must be at least 4 characters')
    setSaving(true); setErr('')
    try { await adminResetStorePin(store.id, newPin); setNewPin(''); onSaved() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <tr>
        <td><input value={form.store_code} onChange={e => setForm(f => ({ ...f, store_code: e.target.value }))} style={{ width: 90 }} /></td>
        <td><input value={form.store_name} onChange={e => setForm(f => ({ ...f, store_name: e.target.value }))} /></td>
        <td><input value={form.region}     onChange={e => setForm(f => ({ ...f, region: e.target.value }))} /></td>
        <td>{store.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
        <td>
          {err && <div className="login-error" style={{ marginBottom: 6, fontSize: 12 }}>{err}</div>}
          <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-outline" onClick={onCancelEdit} disabled={saving}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  if (resettingPin) {
    return (
      <tr>
        <td className="td-code">{store.store_code}</td>
        <td>{store.store_name}</td>
        <td>{store.region || <span className="td-muted">—</span>}</td>
        <td>{store.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
        <td>
          {err && <div className="login-error" style={{ marginBottom: 6, fontSize: 12 }}>{err}</div>}
          <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <input type="text" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="New PIN" style={{ width: 120 }} />
            <button className="btn btn-sm btn-outline" onClick={onCancelResetPin} disabled={saving}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={resetPin} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Set PIN'}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="td-code">{store.store_code}</td>
      <td>{store.store_name}</td>
      <td>{store.region || <span className="td-muted">—</span>}</td>
      <td>{store.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
      <td>
        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onEdit}>Edit</button>
          <button className="btn btn-sm btn-outline" onClick={onResetPin}>Reset PIN</button>
          <button className="btn btn-sm btn-outline" onClick={toggleActive}>
            {store.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </td>
    </tr>
  )
}
