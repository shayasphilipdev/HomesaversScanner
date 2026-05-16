import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListUsers, adminCreateUser, adminUpdateUser, adminResetUserPin,
  adminListStores, adminListAreas
} from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import AdminNav from '../components/AdminNav.jsx'

// Back-office only — Users admin (Phase 9B).
// Manages real human accounts that own a role + (optionally) a store +
// area memberships. The login screen now uses these accounts.
const ROLE_LABELS = {
  sales_assistant:    'Sales Assistant',
  store_manager:      'Store Manager',
  area_manager:       'Area Manager',
  support_admin:      'Store Support Administrator',
  buying_manager:     'Buying Manager',
  commercial_manager: 'Commercial Manager',
  director:           'Director'
}
const STORE_ROLES = ['sales_assistant', 'store_manager']
const HQ_ROLES    = ['area_manager', 'support_admin', 'buying_manager', 'commercial_manager', 'director']

export default function AdminUsers() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [users, setUsers]   = useState([])
  const [stores, setStores] = useState([])
  const [areas, setAreas]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [editingId, setEditingId] = useState(null)
  const [pinResetId, setPinResetId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [u, s, a] = await Promise.all([adminListUsers(), adminListStores(), adminListAreas()])
      setUsers(u); setStores(s); setAreas(a)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { if (isBO) load() }, [isBO])

  if (!isBO) {
    return <div className="card"><div className="empty-state"><p>Admin pages are only available to back-office users.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Users</div>
          <div className="page-subtitle">{users.length} user{users.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ marginBottom: 16, gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? '✕ Cancel' : '+ Add user'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {showAdd && <AddUser toast={toast} stores={stores} areas={areas} onCreated={() => { setShowAdd(false); load() }} />}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !users.length ? (
        <div className="card"><div className="empty-state"><p>No users yet.</p></div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Store / Areas</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <UserRow
                    key={u.id}
                    user={u} stores={stores} areas={areas}
                    editing={editingId === u.id}
                    resettingPin={pinResetId === u.id}
                    onEdit={() => { setEditingId(u.id); setPinResetId(null) }}
                    onCancelEdit={() => setEditingId(null)}
                    onResetPin={() => { setPinResetId(u.id); setEditingId(null) }}
                    onCancelResetPin={() => setPinResetId(null)}
                    onSaved={() => { setEditingId(null); setPinResetId(null); load() }}
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

function AddUser({ onCreated, stores, areas, toast }) {
  const [form, setForm] = useState({ username: '', display_name: '', role: 'sales_assistant', store_id: '', pin: '', area_ids: [] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const isStoreRole = STORE_ROLES.includes(form.role)
  const isAreaMgr   = form.role === 'area_manager'

  const submit = async (e) => {
    e.preventDefault()
    if (!form.username.trim())     return setErr('Username is required')
    if (!form.display_name.trim()) return setErr('Display name is required')
    if (form.pin.length < 4)       return setErr('PIN must be at least 4 characters')
    if (isStoreRole && !form.store_id) return setErr('Please pick a store for this role')

    setSaving(true); setErr('')
    try {
      await adminCreateUser({
        username:     form.username.trim(),
        display_name: form.display_name.trim(),
        role:         form.role,
        store_id:     isStoreRole ? form.store_id : null,
        area_ids:     isAreaMgr ? form.area_ids : [],
        pin:          form.pin
      })
      toast.success('User created.')
      onCreated()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Add user</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Username *</label>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. jdoe or 1015-mgr" />
            </div>
            <div className="form-group">
              <label>Display Name *</label>
              <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="e.g. Jane Doe" />
            </div>
            <div className="form-group">
              <label>Role *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, store_id: '', area_ids: [] }))}>
                <optgroup label="Store">
                  {STORE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </optgroup>
                <optgroup label="HQ / Area">
                  {HQ_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </optgroup>
              </select>
            </div>
            {isStoreRole && (
              <div className="form-group">
                <label>Store *</label>
                <select value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}>
                  <option value="">Select store…</option>
                  {stores.filter(s => s.is_active).map(s => (
                    <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                  ))}
                </select>
              </div>
            )}
            {isAreaMgr && (
              <div className="form-group full">
                <label>Areas covered</label>
                <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {areas.filter(a => a.is_active).map(a => {
                    const checked = form.area_ids.includes(a.id)
                    return (
                      <button
                        type="button" key={a.id}
                        className={`btn btn-sm ${checked ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setForm(f => ({
                          ...f,
                          area_ids: checked ? f.area_ids.filter(x => x !== a.id) : [...f.area_ids, a.id]
                        }))}
                      >
                        {a.area_name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Initial PIN *</label>
              <input type="text" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} placeholder="≥ 4 characters" />
            </div>
          </div>
          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function UserRow({ user, stores, areas, editing, resettingPin, onEdit, onCancelEdit, onResetPin, onCancelResetPin, onSaved, toast }) {
  const [form, setForm] = useState({
    username:     user.username,
    display_name: user.display_name,
    role:         user.role,
    store_id:     user.store_id || '',
    area_ids:     user.area_ids || []
  })
  const [newPin, setNewPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const isStoreRole = STORE_ROLES.includes(form.role)
  const isAreaMgr   = form.role === 'area_manager'

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await adminUpdateUser(user.id, {
        username:     form.username.trim(),
        display_name: form.display_name.trim(),
        role:         form.role,
        store_id:     isStoreRole ? form.store_id : null,
        area_ids:     isAreaMgr ? form.area_ids : []
      })
      toast.success('User updated.')
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async () => {
    setSaving(true); setErr('')
    try { await adminUpdateUser(user.id, { is_active: !user.is_active }); onSaved() }
    catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const resetPin = async () => {
    if (newPin.length < 4) return setErr('PIN must be at least 4 characters')
    setSaving(true); setErr('')
    try { await adminResetUserPin(user.id, newPin); setNewPin(''); toast.success('PIN reset.'); onSaved() }
    catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const storeName = stores.find(s => s.id === user.store_id)?.store_name
  const areaNames = (user.area_ids || []).map(id => areas.find(a => a.id === id)?.area_name).filter(Boolean)

  if (editing) {
    return (
      <tr>
        <td><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} style={{ width: 110 }} /></td>
        <td><input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} /></td>
        <td>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, store_id: '', area_ids: [] }))}>
            {[...STORE_ROLES, ...HQ_ROLES].map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </td>
        <td>
          {isStoreRole && (
            <select value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}>
              <option value="">— Pick store —</option>
              {stores.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          )}
          {isAreaMgr && (
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {areas.filter(a => a.is_active).map(a => {
                const checked = form.area_ids.includes(a.id)
                return (
                  <button type="button" key={a.id} className={`btn btn-sm ${checked ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setForm(f => ({ ...f, area_ids: checked ? f.area_ids.filter(x => x !== a.id) : [...f.area_ids, a.id] }))}>
                    {a.area_name}
                  </button>
                )
              })}
            </div>
          )}
        </td>
        <td>{user.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
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
        <td className="td-code">{user.username}</td>
        <td>{user.display_name}</td>
        <td>{ROLE_LABELS[user.role] || user.role}</td>
        <td>{storeName || areaNames.join(', ') || <span className="td-muted">—</span>}</td>
        <td>{user.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
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
      <td className="td-code">{user.username}</td>
      <td>{user.display_name}</td>
      <td>{ROLE_LABELS[user.role] || user.role}</td>
      <td>{storeName || areaNames.join(', ') || <span className="td-muted">—</span>}</td>
      <td>{user.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
      <td>
        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onEdit}>Edit</button>
          <button className="btn btn-sm btn-outline" onClick={onResetPin}>Reset PIN</button>
          <button className="btn btn-sm btn-outline" onClick={toggleActive}>{user.is_active ? 'Deactivate' : 'Activate'}</button>
        </div>
      </td>
    </tr>
  )
}
