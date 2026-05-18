import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListEmployees, adminCreateUser, adminUpdateUser, adminResetUserPin,
  adminListAreas, adminListStores
} from '../lib/api.js'
import { ROLES, ROLE_KEYS, roleLabel } from '../lib/roles.js'
import { useToast } from '../components/Toast.jsx'
import AdminNav from '../components/AdminNav.jsx'
import ScopePicker from '../components/forms/ScopePicker.jsx'

// Phase 9J — Employees admin.
// All real employees (front-line and HQ) live here. Each row has:
//   - a single role (catalogue in lib/roles.js)
//   - a scope (all stores, specific stores, by area)
//   - per-employee toggles for HQ tasks and Store tasks
export default function AdminEmployees() {
  const { session } = useStore()
  const toast = useToast()

  const [employees, setEmployees] = useState([])
  const [areas, setAreas]         = useState([])
  const [stores, setStores]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [editing, setEditing]     = useState(null)
  const [pinResetId, setPinResetId] = useState(null)
  const [showHelp, setShowHelp]   = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [e, a, s] = await Promise.all([
        adminListEmployees().catch(() => []),
        adminListAreas(),
        adminListStores()
      ])
      // Show every employee here, store + HQ alike. Use a separate admin
      // surface if you ever want to split.
      setEmployees(e); setAreas(a); setStores(s)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Employees</div>
          <div className="page-subtitle">{employees.length} employee{employees.length === 1 ? '' : 's'} · one place for store + Head Office accounts</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>+ Add employee</button>
        <button className="btn btn-outline btn-sm" onClick={() => setShowHelp(v => !v)}>
          {showHelp ? '✕ Hide roles' : '? What can each role do?'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {showHelp && <RolesHelp />}

      {editing && (
        <EmployeeForm
          employee={editing.id ? editing : null}
          areas={areas} stores={stores}
          toast={toast}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !employees.length ? (
        <div className="card"><div className="empty-state">
          <p>No employees yet.</p>
          <p className="note" style={{ marginTop: 6 }}>Add your first one above — they’ll be able to sign in at the login screen with their username and PIN.</p>
        </div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Scope</th>
                  <th>HO / Store</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employees.map(e => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.display_name}</strong>
                      {e.employee_code && <span className="td-muted" style={{ marginLeft: 6, fontSize: 12 }}>#{e.employee_code}</span>}
                      {e.department && <div className="td-muted" style={{ fontSize: 12 }}>{e.department}</div>}
                    </td>
                    <td className="td-code">{e.username}</td>
                    <td><span className="chip">{roleLabel(e.role)}</span></td>
                    <td>{describeScope(e, stores, areas)}</td>
                    <td>
                      {e.can_access_hq_tasks    !== false && <span className="chip" style={{ marginRight: 4 }}>HO</span>}
                      {e.can_access_store_tasks !== false && <span className="chip">Store</span>}
                      {e.can_access_hq_tasks === false && e.can_access_store_tasks === false && <span className="td-muted">—</span>}
                    </td>
                    <td>{e.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
                    <td>
                      {pinResetId === e.id ? (
                        <PinResetInline id={e.id} onCancel={() => setPinResetId(null)} onDone={() => { setPinResetId(null); load() }} toast={toast} />
                      ) : (
                        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-outline" onClick={() => setEditing(e)}>Edit</button>
                          <button className="btn btn-sm btn-outline" onClick={() => setPinResetId(e.id)}>Reset PIN</button>
                        </div>
                      )}
                    </td>
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

function describeScope(e, stores, areas) {
  if (e.all_stores) return <span>All stores</span>
  const sn = (id) => stores.find(s => s.id === id)?.store_name
  const an = (id) => areas.find(a => a.id === id)?.area_name
  const parts = []
  if (Array.isArray(e.area_ids) && e.area_ids.length) {
    parts.push('Areas: ' + e.area_ids.map(an).filter(Boolean).join(', '))
  }
  if (Array.isArray(e.store_ids) && e.store_ids.length) {
    parts.push('Stores: ' + e.store_ids.map(sn).filter(Boolean).join(', '))
  }
  if (!parts.length) return <span className="td-muted">No stores assigned</span>
  return <span style={{ fontSize: 12.5 }}>{parts.join(' · ')}</span>
}

function RolesHelp() {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Roles &amp; access</div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {ROLE_KEYS.map(k => {
            const r = ROLES[k]
            return (
              <div key={k} style={{ border: '1px solid var(--border-soft)', borderRadius: 10, padding: 14, background: 'var(--surface-warm)' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.label}</div>
                <div className="note" style={{ fontSize: 12.5, marginBottom: 8 }}>{r.summary}</div>
                <ul style={{ paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {r.can.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PinResetInline({ id, onCancel, onDone, toast }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (pin.length < 4) return toast.error('PIN must be at least 4 characters')
    setBusy(true)
    try { await adminResetUserPin(id, pin); toast.success('PIN reset.'); onDone() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
      <input type="text" value={pin} onChange={e => setPin(e.target.value)} placeholder="New PIN" style={{ width: 120 }} />
      <button className="btn btn-sm btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy}>{busy ? <span className="spinner" /> : 'Set'}</button>
    </div>
  )
}

function EmployeeForm({ employee, areas, stores, toast, onClose, onSaved }) {
  const isEdit = !!employee?.id
  const [form, setForm] = useState(() => ({
    username:               employee?.username || '',
    display_name:           employee?.display_name || '',
    role:                   employee?.role || 'sales_assistant',
    all_stores:             !!employee?.all_stores,
    store_ids:              employee?.store_ids || [],
    area_ids:               employee?.area_ids || [],
    can_access_hq_tasks:    employee ? employee.can_access_hq_tasks    !== false : true,
    can_access_store_tasks: employee ? employee.can_access_store_tasks !== false : true,
    email:                  employee?.email || '',
    phone:                  employee?.phone || '',
    department:             employee?.department || '',
    employee_code:          employee?.employee_code || '',
    start_date:             employee?.start_date || '',
    notes:                  employee?.notes || '',
    is_active:              employee?.is_active !== false,
    pin:                    ''
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const roleMeta = ROLES[form.role]

  const submit = async (e) => {
    e.preventDefault()
    if (!form.username.trim())     return setErr('Username is required')
    if (!form.display_name.trim()) return setErr('Display name is required')
    if (!isEdit && form.pin.length < 4) return setErr('PIN must be at least 4 characters')
    if (!form.all_stores && !form.store_ids.length && !form.area_ids.length) {
      return setErr('Pick at least one store or area, or tick "Access to all stores".')
    }

    setSaving(true); setErr('')
    try {
      const payload = {
        username:               form.username.trim(),
        display_name:           form.display_name.trim(),
        role:                   form.role,
        all_stores:             form.all_stores,
        store_ids:              form.all_stores ? [] : form.store_ids,
        area_ids:               form.all_stores ? [] : form.area_ids,
        can_access_hq_tasks:    form.can_access_hq_tasks,
        can_access_store_tasks: form.can_access_store_tasks,
        email:                  form.email.trim() || null,
        phone:                  form.phone.trim() || null,
        department:             form.department.trim() || null,
        employee_code:          form.employee_code.trim() || null,
        start_date:             form.start_date || null,
        notes:                  form.notes.trim() || null,
        is_active:              form.is_active
      }
      if (isEdit) {
        await adminUpdateUser(employee.id, payload)
        toast.success('Employee updated.')
      } else {
        await adminCreateUser({ ...payload, pin: form.pin })
        toast.success('Employee added.')
      }
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{isEdit ? 'Edit employee' : 'Add employee'}</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Display Name *</label>
              <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="e.g. Jane Doe" />
            </div>
            <div className="form-group">
              <label>Username (for login) *</label>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="e.g. jdoe" />
            </div>

            <div className="form-group full">
              <label>Role *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLE_KEYS.map(k => <option key={k} value={k}>{ROLES[k].label}</option>)}
              </select>
              {roleMeta && (
                <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-warm)', border: '1px solid var(--border-soft)', borderRadius: 8 }}>
                  <div className="note" style={{ fontSize: 12.5, marginBottom: 6 }}>{roleMeta.summary}</div>
                  <ul style={{ paddingLeft: 18, fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
                    {roleMeta.can.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <div className="form-group full">
              <label>Store / Area scope</label>
              <ScopePicker
                value={{ all_stores: form.all_stores, store_ids: form.store_ids, area_ids: form.area_ids }}
                onChange={({ all_stores, store_ids, area_ids }) => setForm(f => ({ ...f, all_stores, store_ids, area_ids }))}
                stores={stores}
                areas={areas}
              />
            </div>

            <div className="form-group full">
              <label>Task access</label>
              <div className="flex-row" style={{ gap: 18, flexWrap: 'wrap' }}>
                <label className="flex-row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.can_access_hq_tasks}
                    onChange={e => setForm(f => ({ ...f, can_access_hq_tasks: e.target.checked }))}
                  />
                  <span><strong>HO Tasks</strong> — error reports A–I (UOM, prices, non-scans…)</span>
                </label>
                <label className="flex-row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.can_access_store_tasks}
                    onChange={e => setForm(f => ({ ...f, can_access_store_tasks: e.target.checked }))}
                  />
                  <span><strong>Store Tasks</strong> — operational checklists</span>
                </label>
              </div>
              <span className="note" style={{ fontSize: 12 }}>Untick to hide a system entirely from this employee.</span>
            </div>

            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@homesavers.ie" />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+353…" />
            </div>
            <div className="form-group">
              <label>Department</label>
              <input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Buying" />
            </div>
            <div className="form-group">
              <label>Employee Code</label>
              <input value={form.employee_code} onChange={e => setForm(f => ({ ...f, employee_code: e.target.value }))} placeholder="optional" />
            </div>
            <div className="form-group">
              <label>Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Active</label>
              <label className="flex-row" style={{ gap: 8 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span className="note">Can sign in</span>
              </label>
            </div>

            <div className="form-group full">
              <label>Notes</label>
              <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes — not shown to the employee." />
            </div>

            {!isEdit && (
              <div className="form-group">
                <label>Initial PIN *</label>
                <input type="text" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} placeholder="≥ 4 characters" />
              </div>
            )}
          </div>

          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : (isEdit ? 'Save changes' : 'Add employee')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
