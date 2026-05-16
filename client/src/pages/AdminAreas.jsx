import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { adminListAreas, adminCreateArea, adminUpdateArea } from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import AdminNav from '../components/AdminNav.jsx'

// Back-office only — Areas admin.
// Areas group stores for area-manager visibility scopes and for
// targeting tasks at a whole area. (Phase 9A)
export default function AdminAreas() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [areas, setAreas]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [editingId, setEditingId] = useState(null)
  const [showAdd, setShowAdd]   = useState(false)

  const load = async () => {
    setLoading(true); setError('')
    try { setAreas(await adminListAreas()) }
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
          <div className="page-title">Areas</div>
          <div className="page-subtitle">Group stores into areas · {areas.length} total</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ marginBottom: 16, gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? '✕ Cancel' : '+ Add area'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {showAdd && <AddArea toast={toast} onCreated={() => { setShowAdd(false); load() }} />}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !areas.length ? (
        <div className="card"><div className="empty-state"><p>No areas yet — add the first one above.</p></div></div>
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
                {areas.map(a => (
                  <AreaRow
                    key={a.id}
                    area={a}
                    editing={editingId === a.id}
                    toast={toast}
                    onEdit={() => setEditingId(a.id)}
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

function AddArea({ onCreated, toast }) {
  const [form, setForm] = useState({ area_code: '', area_name: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.area_name.trim()) return setErr('Area name is required')
    setSaving(true); setErr('')
    try {
      await adminCreateArea({
        area_code: form.area_code.trim() || null,
        area_name: form.area_name.trim()
      })
      setForm({ area_code: '', area_name: '' })
      toast.success('Area created.')
      onCreated()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Add area</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Area Code (optional)</label>
              <input value={form.area_code} onChange={e => setForm(f => ({ ...f, area_code: e.target.value }))} placeholder="e.g. A1" />
            </div>
            <div className="form-group">
              <label>Area Name *</label>
              <input value={form.area_name} onChange={e => setForm(f => ({ ...f, area_name: e.target.value }))} placeholder="e.g. Area 6" />
            </div>
          </div>
          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : 'Create area'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AreaRow({ area, editing, onEdit, onCancel, onSaved, toast }) {
  const [form, setForm] = useState({ area_code: area.area_code || '', area_name: area.area_name })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await adminUpdateArea(area.id, {
        area_code: form.area_code.trim() || null,
        area_name: form.area_name.trim()
      })
      toast.success('Area updated.')
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async () => {
    setSaving(true); setErr('')
    try { await adminUpdateArea(area.id, { is_active: !area.is_active }); onSaved() }
    catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <tr>
        <td><input value={form.area_code} onChange={e => setForm(f => ({ ...f, area_code: e.target.value }))} style={{ width: 90 }} /></td>
        <td><input value={form.area_name} onChange={e => setForm(f => ({ ...f, area_name: e.target.value }))} /></td>
        <td>{area.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
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
      <td className="td-code">{area.area_code || <span className="td-muted">—</span>}</td>
      <td>{area.area_name}</td>
      <td>{area.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
      <td>
        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onEdit}>Edit</button>
          <button className="btn btn-sm btn-outline" onClick={toggleActive}>
            {area.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </td>
    </tr>
  )
}
