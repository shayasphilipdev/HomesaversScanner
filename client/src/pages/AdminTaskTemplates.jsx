import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListTemplates, adminCreateTemplate, adminUpdateTemplate, adminDeleteTemplate,
  adminListAreas, adminListStores
} from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import AdminNav from '../components/AdminNav.jsx'

// Templates page (Phase 9D). Visible to task creators.
const ROLE_OPTIONS = [
  { value: 'all',                label: 'Everyone at the targeted stores' },
  { value: 'sales_assistant',    label: 'Sales Assistants' },
  { value: 'store_manager',      label: 'Store Managers' },
  { value: 'area_manager',       label: 'Area Managers' },
  { value: 'support_admin',      label: 'Store Support Administrators' },
  { value: 'buying_manager',     label: 'Buying Managers' },
  { value: 'commercial_manager', label: 'Commercial Managers' },
  { value: 'director',           label: 'Director' }
]
const FREQ_OPTIONS = [
  { value: 'daily',    label: 'Daily' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'monthly',  label: 'Monthly' },
  { value: 'yearly',   label: 'Yearly' },
  { value: 'once_off', label: 'Once-off' }
]
const SCOPE_OPTIONS = [
  { value: 'all',    label: 'All stores' },
  { value: 'area',   label: 'Specific area(s)' },
  { value: 'stores', label: 'Specific stores' }
]
const PRIORITY_OPTIONS = [
  { value: '',       label: '— Normal —' },
  { value: 'high',   label: '🔴 High' },
  { value: 'medium', label: '🟡 Medium' },
  { value: 'low',    label: '🟢 Low' }
]

const TASK_CREATOR_ROLES = ['buying_manager', 'area_manager', 'commercial_manager', 'director']

export default function AdminTaskTemplates() {
  const { session } = useStore()
  const toast = useToast()
  const canCreate = TASK_CREATOR_ROLES.includes(session.role) || session.mode === 'backoffice'

  const [templates, setTemplates] = useState([])
  const [areas, setAreas]   = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [editing, setEditing] = useState(null)   // template object or {} for new

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [t, a, s] = await Promise.all([adminListTemplates(), adminListAreas(), adminListStores()])
      setTemplates(t); setAreas(a); setStores(s)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { if (canCreate) load() }, [canCreate])

  if (!canCreate) {
    return <div className="card"><div className="empty-state"><p>Only task creators can manage templates.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Task Templates</div>
          <div className="page-subtitle">{templates.length} template{templates.length === 1 ? '' : 's'}</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ marginBottom: 16, gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>+ Create template</button>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="login-error mt-12">{error}</div>}

      {editing && (
        <TemplateForm
          template={editing.id ? editing : null}
          areas={areas} stores={stores}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          toast={toast}
        />
      )}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !templates.length ? (
        <div className="card"><div className="empty-state">
          <p>No templates yet.</p>
          <p className="note" style={{ marginTop: 6 }}>Create your first task above. Templates appear at each targeted store as a daily/weekly/etc. checklist item.</p>
        </div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Frequency</th>
                  <th>Scope</th>
                  <th>For role</th>
                  <th>Requires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.title}</strong>
                      {t.category && <span className="chip" style={{ marginLeft: 6 }}>{t.category}</span>}
                      {t.priority && <span className="chip" style={{ marginLeft: 6 }}>{t.priority}</span>}
                      {t.description && <div className="note" style={{ fontSize: 12, marginTop: 2 }}>{t.description}</div>}
                    </td>
                    <td>{t.frequency}{t.due_window ? ` · by ${t.due_window}` : ''}</td>
                    <td>{describeScope(t, areas, stores)}</td>
                    <td>{ROLE_OPTIONS.find(r => r.value === t.assigned_to_role)?.label.replace(' at the targeted stores', '') || t.assigned_to_role}</td>
                    <td>
                      {t.requires_photo && <span className="chip" style={{ marginRight: 4 }}>📷 photo</span>}
                      {t.requires_notes && <span className="chip">📝 notes</span>}
                      {!t.requires_photo && !t.requires_notes && <span className="td-muted">—</span>}
                    </td>
                    <td>{t.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
                    <td>
                      <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-outline" onClick={() => setEditing(t)}>Edit</button>
                        {t.is_active && (
                          <button className="btn btn-sm btn-danger" onClick={async () => {
                            if (!confirm(`Deactivate "${t.title}"? Existing instances stay; no new ones will be generated.`)) return
                            try { await adminDeleteTemplate(t.id); toast.success('Template deactivated.'); load() }
                            catch (e) { toast.error(e.message) }
                          }}>Deactivate</button>
                        )}
                      </div>
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

function describeScope(t, areas, stores) {
  if (t.applies_to === 'all')  return 'All stores'
  if (t.applies_to === 'area') {
    const names = (t.area_ids || []).map(id => areas.find(a => a.id === id)?.area_name).filter(Boolean)
    return `Areas: ${names.join(', ') || '—'}`
  }
  if (t.applies_to === 'stores' || t.applies_to === 'one') {
    const names = (t.store_ids || []).map(id => stores.find(s => s.id === id)?.store_name).filter(Boolean)
    return `Stores: ${names.join(', ') || '—'}`
  }
  return t.applies_to
}

function TemplateForm({ template, areas, stores, onClose, onSaved, toast }) {
  const [form, setForm] = useState(() => ({
    title:            template?.title || '',
    description:      template?.description || '',
    instructions:     template?.instructions || '',
    category:         template?.category || '',
    frequency:        template?.frequency || 'daily',
    due_window:       template?.due_window || '',
    requires_photo:   !!template?.requires_photo,
    requires_notes:   !!template?.requires_notes,
    applies_to:       template?.applies_to || 'all',
    area_ids:         template?.area_ids || [],
    store_ids:        template?.store_ids || [],
    assigned_to_role: template?.assigned_to_role || 'all',
    priority:         template?.priority || '',
    sort_order:       template?.sort_order || 0
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return setErr('Title is required')
    if (form.applies_to === 'area' && !form.area_ids.length)   return setErr('Pick at least one area')
    if (form.applies_to === 'stores' && !form.store_ids.length) return setErr('Pick at least one store')
    setSaving(true); setErr('')
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        description: form.description.trim() || null,
        instructions: form.instructions.trim() || null,
        category: form.category.trim() || null,
        due_window: form.due_window.trim() || null,
        priority: form.priority || null
      }
      if (template?.id) {
        await adminUpdateTemplate(template.id, payload)
        toast.success('Template updated.')
      } else {
        await adminCreateTemplate(payload)
        toast.success('Template created.')
      }
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const toggleId = (key, id) => setForm(f => ({
    ...f,
    [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id]
  }))

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">{template?.id ? 'Edit template' : 'Create template'}</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group full">
              <label>Title *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Check fridge temperatures" />
            </div>
            <div className="form-group full">
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short summary" />
            </div>
            <div className="form-group full">
              <label>Instructions (shown when completing)</label>
              <textarea rows={2} value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} placeholder="What exactly should the user do?" />
            </div>
            <div className="form-group">
              <label>Category</label>
              <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Compliance" />
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Frequency</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Due by (HH:MM, optional)</label>
              <input value={form.due_window} onChange={e => setForm(f => ({ ...f, due_window: e.target.value }))} placeholder="e.g. 10:00" />
            </div>
            <div className="form-group">
              <label>Scope</label>
              <select value={form.applies_to} onChange={e => setForm(f => ({ ...f, applies_to: e.target.value }))}>
                {SCOPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Assign to role</label>
              <select value={form.assigned_to_role} onChange={e => setForm(f => ({ ...f, assigned_to_role: e.target.value }))}>
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {form.applies_to === 'area' && (
              <div className="form-group full">
                <label>Pick areas</label>
                <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {areas.filter(a => a.is_active).map(a => (
                    <button type="button" key={a.id}
                      className={`btn btn-sm ${form.area_ids.includes(a.id) ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => toggleId('area_ids', a.id)}>
                      {a.area_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form.applies_to === 'stores' && (
              <div className="form-group full">
                <label>Pick stores</label>
                <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {stores.filter(s => s.is_active).map(s => (
                    <button type="button" key={s.id}
                      className={`btn btn-sm ${form.store_ids.includes(s.id) ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => toggleId('store_ids', s.id)}>
                      {s.store_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Requires photo</label>
              <label className="flex-row" style={{ gap: 8 }}>
                <input type="checkbox" checked={form.requires_photo} onChange={e => setForm(f => ({ ...f, requires_photo: e.target.checked }))} />
                <span className="note">Completer must attach a photo</span>
              </label>
            </div>
            <div className="form-group">
              <label>Requires notes</label>
              <label className="flex-row" style={{ gap: 8 }}>
                <input type="checkbox" checked={form.requires_notes} onChange={e => setForm(f => ({ ...f, requires_notes: e.target.checked }))} />
                <span className="note">Completer must add a note</span>
              </label>
            </div>
          </div>
          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : (template?.id ? 'Save changes' : 'Create template')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
