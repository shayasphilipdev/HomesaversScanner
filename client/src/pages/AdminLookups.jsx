import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListLookups, adminCreateLookup, adminUpdateLookup, adminDeleteLookup, getTaskTypes
} from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'

const KINDS = [
  { kind: 'reason_code', label: 'Reason Codes',  hint: 'Used by Task C (Wrong Prices) and any other task type you tick.' },
  { kind: 'drs_size',    label: 'DRS Sizes',     hint: 'Used by Task F (DRS Errors). Update when Ireland’s DRS thresholds change.' }
]

export default function AdminLookups() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [options, setOptions]     = useState([])
  const [taskTypes, setTaskTypes] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [opts, tt] = await Promise.all([adminListLookups(), getTaskTypes()])
      setOptions(opts); setTaskTypes(tt)
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
          <div className="page-title">Reason &amp; Size lookups</div>
          <div className="page-subtitle">Manage dropdown options used by task forms</div>
        </div>
      </div>

      <AdminNav />

      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : (
        KINDS.map(k => (
          <KindBlock
            key={k.kind}
            kind={k.kind} label={k.label} hint={k.hint}
            options={options.filter(o => o.kind === k.kind)}
            taskTypes={taskTypes}
            onChange={load}
          />
        ))
      )}
    </div>
  )
}

function KindBlock({ kind, label, hint, options, taskTypes, onChange }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>{label}</span>
        <span className="chip" style={{ marginLeft: 'auto' }}>{options.length} option{options.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="card-body">
        <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>{hint}</p>

        <div className="flex-row" style={{ marginBottom: 12 }}>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(v => !v)}>
            {showAdd ? '✕ Cancel' : '+ Add option'}
          </button>
        </div>

        {showAdd && (
          <AddLookup kind={kind} taskTypes={taskTypes} onCreated={() => { setShowAdd(false); onChange() }} />
        )}

        {!options.length ? (
          <div className="empty-state"><p>No options yet — add the first one above.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Used by task types</th>
                  <th>Sort</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {options.map(opt => (
                  <LookupRow
                    key={opt.id}
                    option={opt}
                    taskTypes={taskTypes}
                    editing={editingId === opt.id}
                    onEdit={() => setEditingId(opt.id)}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); onChange() }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AddLookup({ kind, taskTypes, onCreated }) {
  const [label, setLabel]           = useState('')
  const [selectedTypes, setSel]     = useState([])
  const [sort, setSort]             = useState(0)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState('')

  const toggle = (code) => {
    setSel(s => s.includes(code) ? s.filter(c => c !== code) : [...s, code])
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!label.trim()) return setErr('Label is required')
    setSaving(true); setErr('')
    try {
      await adminCreateLookup({ kind, label: label.trim(), task_types: selectedTypes, sort_order: Number(sort) || 0 })
      setLabel(''); setSel([]); setSort(0)
      onCreated()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 16, padding: 14, background: 'rgba(255,255,255,.6)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
      <div className="form-grid">
        <div className="form-group full">
          <label>Label *</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Price Matrix" />
        </div>
        <div className="form-group full">
          <label>Used by task types</label>
          <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {taskTypes.map(t => (
              <button
                key={t.code} type="button"
                className={`btn btn-sm ${selectedTypes.includes(t.code) ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => toggle(t.code)}
              >
                {t.code}
              </button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label>Sort order</label>
          <input type="number" value={sort} onChange={e => setSort(e.target.value)} placeholder="0" />
        </div>
      </div>
      {err && <div className="login-error mt-12">{err}</div>}
      <div className="flex-row mt-12" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : 'Add option'}
        </button>
      </div>
    </form>
  )
}

function LookupRow({ option, taskTypes, editing, onEdit, onCancel, onSaved }) {
  const [label, setLabel]       = useState(option.label)
  const [selected, setSelected] = useState(option.task_types || [])
  const [sort, setSort]         = useState(option.sort_order || 0)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')

  const toggle = (code) => setSelected(s => s.includes(code) ? s.filter(c => c !== code) : [...s, code])

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await adminUpdateLookup(option.id, { label: label.trim(), task_types: selected, sort_order: Number(sort) || 0 })
      onSaved()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const toggleActive = async () => {
    setSaving(true); setErr('')
    try { await adminUpdateLookup(option.id, { is_active: !option.is_active }); onSaved() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!confirm(`Delete "${option.label}"? Existing records that reference this label will still show the text.`)) return
    setSaving(true)
    try { await adminDeleteLookup(option.id); onSaved() }
    catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <tr>
        <td><input value={label} onChange={e => setLabel(e.target.value)} /></td>
        <td>
          <div className="flex-row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {taskTypes.map(t => (
              <button key={t.code} type="button"
                className={`btn btn-sm ${selected.includes(t.code) ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => toggle(t.code)}>{t.code}</button>
            ))}
          </div>
        </td>
        <td><input type="number" value={sort} onChange={e => setSort(e.target.value)} style={{ width: 70 }} /></td>
        <td>{option.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
        <td>
          {err && <div className="login-error" style={{ marginBottom: 6, fontSize: 12 }}>{err}</div>}
          <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-outline" onClick={onCancel} disabled={saving}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{option.label}</td>
      <td>
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {(option.task_types || []).map(t => <span key={t} className="chip">{t}</span>)}
          {!(option.task_types || []).length && <span className="td-muted">— none —</span>}
        </div>
      </td>
      <td>{option.sort_order}</td>
      <td>{option.is_active ? <span className="badge badge-completed">Active</span> : <span className="badge badge-pending">Inactive</span>}</td>
      <td>
        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm btn-outline" onClick={onEdit}>Edit</button>
          <button className="btn btn-sm btn-outline" onClick={toggleActive}>{option.is_active ? 'Deactivate' : 'Activate'}</button>
          <button className="btn btn-sm btn-danger"  onClick={remove}>Delete</button>
        </div>
      </td>
    </tr>
  )
}
