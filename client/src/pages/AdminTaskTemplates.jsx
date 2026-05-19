import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListTemplates, adminCreateTemplate, adminUpdateTemplate, adminDeleteTemplate,
  adminListAreas, adminListStores, adminListUsers, getLookupOptions,
  adminCreateLookup
} from '../lib/api.js'
import { useToast } from '../components/Toast.jsx'
import AdminNav from '../components/AdminNav.jsx'
import BlockBuilder from '../components/forms/BlockBuilder.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'

// Templates page (Phase 9D). Visible to task creators.
const ROLE_OPTIONS = [
  { value: 'all',                label: 'Everyone at the targeted stores' },
  { value: 'sales_assistant',    label: 'Sales Assistants' },
  { value: 'store_manager',      label: 'Store Managers' },
  { value: 'area_manager',       label: 'Area Managers' },
  { value: 'support_admin',      label: 'Store Support Administrators' },
  { value: 'buying_manager',     label: 'Buying Managers' },
  { value: 'buying_head',        label: 'Buying Heads' },
  { value: 'admin',              label: 'Admin' }
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

const TASK_CREATOR_ROLES = ['buying_manager', 'area_manager', 'buying_head', 'admin']

export default function AdminTaskTemplates() {
  const { session } = useStore()
  const toast = useToast()
  const canCreate = TASK_CREATOR_ROLES.includes(session.role) || session.mode === 'backoffice'

  const [templates, setTemplates] = useState([])
  const [areas, setAreas]   = useState([])
  const [stores, setStores] = useState([])
  const [users, setUsers]   = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [editing, setEditing] = useState(null)   // template object or {} for new

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [t, a, s, u, c] = await Promise.all([
        adminListTemplates(), adminListAreas(), adminListStores(),
        adminListUsers().catch(() => []),
        getLookupOptions({ kind: 'task_category' }).catch(() => [])
      ])
      setTemplates(t); setAreas(a); setStores(s); setUsers(u); setCategories(c)
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
          areas={areas} stores={stores} users={users} categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          onCategoriesChanged={async () => {
            const c = await getLookupOptions({ kind: 'task_category' }).catch(() => [])
            setCategories(c)
          }}
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

// ISO timestamp → datetime-local string in the browser's local time.
function toLocalDT(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

function TemplateForm({ template, areas, stores, users, categories = [], onClose, onSaved, onCategoriesChanged, toast }) {
  const [form, setForm] = useState(() => ({
    title:                template?.title || '',
    description:          template?.description || '',
    instructions:         template?.instructions || '',
    category:             template?.category || '',
    frequency:            template?.frequency || 'daily',
    due_window:           template?.due_window || '',
    applies_to:           template?.applies_to || 'all',
    area_ids:             template?.area_ids || [],
    store_ids:            template?.store_ids || [],
    assigned_to_role:     template?.assigned_to_role || 'all',
    assigned_to_roles:    template?.assigned_to_roles || [],
    start_at:             template?.start_at ? toLocalDT(template.start_at) : '',
    end_at:               template?.end_at   ? toLocalDT(template.end_at)   : '',
    blocks:               template?.blocks || [],
    priority:             template?.priority || '',
    sort_order:           template?.sort_order || 0
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return setErr('Title is required')
    if (form.applies_to === 'area'   && !form.area_ids.length)  return setErr('Pick at least one area')
    if (form.applies_to === 'stores' && !form.store_ids.length) return setErr('Pick at least one store')
    setSaving(true); setErr('')
    try {
      const payload = {
        ...form,
        title:        form.title.trim(),
        description:  form.description.trim() || null,
        instructions: form.instructions.trim() || null,
        category:     form.category.trim() || null,
        due_window:   form.due_window.trim() || null,
        priority:     form.priority || null,
        start_at:     form.start_at ? new Date(form.start_at).toISOString() : null,
        end_at:       form.end_at   ? new Date(form.end_at).toISOString()   : null
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
              <CategoryPicker
                value={form.category}
                onChange={v => setForm(f => ({ ...f, category: v }))}
                categories={categories}
                onCreated={() => onCategoriesChanged?.()}
                toast={toast}
              />
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
              <label>Primary assignee role</label>
              <select value={form.assigned_to_role} onChange={e => setForm(f => ({ ...f, assigned_to_role: e.target.value }))}>
                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="form-group full">
              <label>Also visible to these roles (optional)</label>
              <MultiSelectDropdown
                value={form.assigned_to_roles}
                onChange={next => setForm(f => ({ ...f, assigned_to_roles: next }))}
                options={ROLE_OPTIONS
                  .filter(o => o.value !== 'all' && o.value !== form.assigned_to_role)
                  .map(o => ({ id: o.value, label: o.label }))}
                placeholder="No extra roles — primary assignee only"
              />
            </div>

            <div className="form-group">
              <label>Starts at (date &amp; time, optional)</label>
              <input type="datetime-local" value={form.start_at} onChange={e => setForm(f => ({ ...f, start_at: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Ends at (date &amp; time, optional)</label>
              <input type="datetime-local" value={form.end_at} onChange={e => setForm(f => ({ ...f, end_at: e.target.value }))} />
            </div>
            {form.applies_to === 'area' && (
              <div className="form-group full">
                <label>Pick areas *</label>
                <MultiSelectDropdown
                  value={form.area_ids}
                  onChange={next => setForm(f => ({ ...f, area_ids: next }))}
                  options={areas.filter(a => a.is_active).map(a => ({ id: a.id, label: a.area_name }))}
                  placeholder="Pick one or more areas…"
                />
              </div>
            )}
            {form.applies_to === 'stores' && (
              <div className="form-group full">
                <label>Pick stores *</label>
                <MultiSelectDropdown
                  value={form.store_ids}
                  onChange={next => setForm(f => ({ ...f, store_ids: next }))}
                  options={stores.filter(s => s.is_active).map(s => ({ id: s.id, label: s.store_name, subLabel: s.store_code }))}
                  placeholder="Pick one or more stores…"
                />
              </div>
            )}

            <div className="form-group full">
              <label>Form blocks</label>
              <span className="note" style={{ fontSize: 12, marginBottom: 8 }}>
                Build the form the completer fills in. Mix text, numbers, photos, choice questions, headings, alerts. Required/optional is set per block.
              </span>
              <BlockBuilder value={form.blocks} onChange={blocks => setForm(f => ({ ...f, blocks }))} />
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

// Category dropdown with an inline "+ Add" so the HO user can create a new
// task_category without leaving this form. New categories are written to
// the lookup_options table (kind='task_category') and shown immediately.
function CategoryPicker({ value, onChange, categories, onCreated, toast }) {
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const lbl = newLabel.trim()
    if (!lbl) return
    setBusy(true)
    try {
      await adminCreateLookup({ kind: 'task_category', label: lbl, is_active: true, sort_order: (categories?.length || 0) + 1 })
      toast?.success(`Added category "${lbl}".`)
      onChange(lbl)
      setNewLabel(''); setAdding(false)
      onCreated?.()
    } catch (e) {
      toast?.error(e.message)
    } finally { setBusy(false) }
  }

  if (adding) {
    return (
      <div className="flex-row" style={{ gap: 6 }}>
        <input
          autoFocus
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          placeholder="New category name"
          style={{ flex: 1 }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Add'}
        </button>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => { setAdding(false); setNewLabel('') }} disabled={busy}>Cancel</button>
      </div>
    )
  }

  return (
    <div className="flex-row" style={{ gap: 6 }}>
      <select value={value || ''} onChange={e => onChange(e.target.value)} style={{ flex: 1 }}>
        <option value="">— None —</option>
        {categories.map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
      </select>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => setAdding(true)} title="Add a new category">+ Add</button>
    </div>
  )
}
