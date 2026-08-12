import { useEffect, useState } from 'react'
import { useCurrentStore } from '../lib/currentStore.jsx'
import CurrentStorePicker from '../components/CurrentStorePicker.jsx'
import { useToast } from '../components/Toast.jsx'
import { downloadExcel } from '../lib/excel.js'
import {
  getCompetitors, createCompetitor, updateCompetitor, deleteCompetitor,
  getCompetitorRetailers, addCompetitorRetailer, getCompetitorReport,
} from '../lib/api.js'
import {
  RETAILER_TYPES, SIZE_VS_US, STATUS_OPTIONS, DISTANCE_BANDS, TRAVEL_OPTIONS,
  DIRECT_OPTIONS, PRICE_VS_US, THREAT_OPTIONS, SETTING_OPTIONS, DISTANCE_UNITS,
  COMPETITION_REPORT_COLS, COMPETITION_REPORT_HEADERS,
} from '../lib/competitionOptions.js'

// Competition capture — operations/store users record the retailers around
// their store. One row per competitor; store-scoped like Space Plan. The form
// sits at the top; recorded competitors are listed below it.
const ADD_NEW = '__add_new__'
const EMPTY = {
  retailer_name: '', retailer_type: '', size_vs_us: '', status: '',
  distance_band: '', distance_value: '', distance_unit: 'metres', travel: '',
  direct: '', price_vs_us: '', threat: '', setting: '', details: '',
}

const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }

function Field({ label, children }) {
  return <div className="form-group"><label>{label}</label>{children}</div>
}

function SelectOpts({ value, onChange, opts }) {
  return (
    <select value={value} onChange={onChange}>
      <option value="">—</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function summarize(c) {
  const dist = (c.distance_value != null && c.distance_value !== '')
    ? `${c.distance_value} ${c.distance_unit || ''}`.trim()
    : c.distance_band
  return [c.retailer_type, c.size_vs_us, dist, c.travel, c.status, c.direct].filter(Boolean).join(' · ')
}

export default function Competition() {
  const { currentStoreId, scopedStores, ready } = useCurrentStore()
  const toast = useToast()

  const [retailers, setRetailers] = useState([])
  const [rows, setRows]           = useState([])
  const [form, setForm]           = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]         = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }))

  useEffect(() => { getCompetitorRetailers().then(setRetailers).catch(() => setRetailers([])) }, [])

  const load = async () => {
    if (!currentStoreId) { setRows([]); return }
    setLoading(true); setError('')
    try {
      const d = await getCompetitors(currentStoreId)
      setRows(d.competitors || [])
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  // Reset the form and reload whenever the store changes.
  useEffect(() => { setForm(EMPTY); setEditingId(null); load() /* eslint-disable-next-line */ }, [currentStoreId])

  const onRetailerChange = async (e) => {
    const v = e.target.value
    if (v !== ADD_NEW) { setForm(f => ({ ...f, retailer_name: v })); return }
    const name = (window.prompt('New retailer name') || '').trim()
    if (!name) return
    try {
      const r = await addCompetitorRetailer(name)
      setRetailers(await getCompetitorRetailers())
      setForm(f => ({ ...f, retailer_name: r?.name || name }))
    } catch (err) { toast.error(err.message) }
  }

  const startEdit = (c) => {
    setEditingId(c.id)
    setForm({
      retailer_name: c.retailer_name || '', retailer_type: c.retailer_type || '',
      size_vs_us: c.size_vs_us || '', status: c.status || '',
      distance_band: c.distance_band || '', distance_value: c.distance_value ?? '',
      distance_unit: c.distance_unit || 'metres', travel: c.travel || '',
      direct: c.direct || '', price_vs_us: c.price_vs_us || '',
      threat: c.threat || '', setting: c.setting || '', details: c.details || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => { setEditingId(null); setForm(EMPTY); setError('') }

  const save = async () => {
    if (!currentStoreId) return
    if (!form.retailer_name) { setError('Pick a retailer first.'); return }
    setSaving(true); setError('')
    try {
      if (editingId) { await updateCompetitor(editingId, form); toast.success('Updated.') }
      else           { await createCompetitor({ store_id: currentStoreId, ...form }); toast.success('Saved.') }
      setForm(EMPTY); setEditingId(null)
      await load()
    } catch (e) { setError(e.message); toast.error(e.message) } finally { setSaving(false) }
  }

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.retailer_name} from this store's competitor list?`)) return
    try {
      await deleteCompetitor(c.id)
      if (editingId === c.id) cancelEdit()
      await load()
    } catch (e) { toast.error(e.message) }
  }

  const exportExcel = async () => {
    setDownloading(true); setError('')
    try {
      const { rows: r } = await getCompetitorReport(currentStoreId)
      if (!r.length) { toast.error('Nothing to export yet.'); return }
      const store = scopedStores.find(s => s.id === currentStoreId)
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadExcel(`Competition - ${store?.store_code || 'store'} - ${stamp}.xlsx`, r, COMPETITION_REPORT_COLS, COMPETITION_REPORT_HEADERS)
    } catch (e) { setError(e.message) } finally { setDownloading(false) }
  }

  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: '2-digit' }) : ''
  const knownName = form.retailer_name && !retailers.some(r => r.name === form.retailer_name)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Competition</div>
          <div className="page-subtitle">Record competitors around your store</div>
        </div>
        {currentStoreId && rows.length > 0 && (
          <button className="btn btn-sm btn-outline" onClick={exportExcel} disabled={downloading}>
            {downloading ? <><span className="spinner spinner-dark" /> …</> : '↓ Excel'}
          </button>
        )}
      </div>

      <CurrentStorePicker subject="competitor" />

      {!ready ? null
        : !currentStoreId ? (
          <div className="card"><div className="empty-state"><p>Pick a store above to start recording competitors.</p></div></div>
        ) : (
          <>
            {/* Add / edit form — kept at the top so the entry is always to hand. */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">{editingId ? 'Edit competitor' : 'Add competitor'}</div>
              <div className="card-body">
                <Field label="Retailer *">
                  <select value={form.retailer_name || ''} onChange={onRetailerChange}>
                    <option value="">Select a retailer…</option>
                    {retailers.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                    {knownName && <option value={form.retailer_name}>{form.retailer_name}</option>}
                    <option value={ADD_NEW}>— Add new retailer… —</option>
                  </select>
                </Field>

                <Field label="Retailer type">
                  <select value={form.retailer_type} onChange={set('retailer_type')}>
                    <option value="">—</option>
                    {RETAILER_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>

                <div style={GRID}>
                  <Field label="Size vs us"><SelectOpts value={form.size_vs_us} onChange={set('size_vs_us')} opts={SIZE_VS_US} /></Field>
                  <Field label="Status"><SelectOpts value={form.status} onChange={set('status')} opts={STATUS_OPTIONS} /></Field>
                  <Field label="Distance band"><SelectOpts value={form.distance_band} onChange={set('distance_band')} opts={DISTANCE_BANDS} /></Field>
                  <Field label="Travel"><SelectOpts value={form.travel} onChange={set('travel')} opts={TRAVEL_OPTIONS} /></Field>
                </div>

                <Field label="Distance (approx.)">
                  <div className="flex-row" style={{ gap: 8 }}>
                    <input type="text" inputMode="decimal" value={form.distance_value}
                      onChange={e => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) set('distance_value')(v) }}
                      placeholder="e.g. 400" style={{ flex: 1 }} />
                    <select value={form.distance_unit} onChange={set('distance_unit')} style={{ width: 120 }}>
                      {DISTANCE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </Field>

                <div style={GRID}>
                  <Field label="Direct competitor"><SelectOpts value={form.direct} onChange={set('direct')} opts={DIRECT_OPTIONS} /></Field>
                  <Field label="Price vs us"><SelectOpts value={form.price_vs_us} onChange={set('price_vs_us')} opts={PRICE_VS_US} /></Field>
                  <Field label="Threat level"><SelectOpts value={form.threat} onChange={set('threat')} opts={THREAT_OPTIONS} /></Field>
                  <Field label="Setting"><SelectOpts value={form.setting} onChange={set('setting')} opts={SETTING_OPTIONS} /></Field>
                </div>

                <Field label="Details">
                  <textarea rows={2} value={form.details} onChange={set('details')}
                    placeholder="Layout, offers, footfall, car park, anything else…" />
                </Field>

                {error && <div className="login-error mt-12">{error}</div>}

                <div className="flex-row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? <span className="spinner" /> : (editingId ? 'Update' : 'Save')}
                  </button>
                  {editingId && <button className="btn btn-outline" onClick={cancelEdit} disabled={saving}>Cancel</button>}
                </div>
              </div>
            </div>

            {/* Recorded competitors — listed below the form to save top space. */}
            <div className="card">
              <div className="card-header">Recorded competitors · {rows.length}</div>
              <div className="card-body">
                {loading ? (
                  <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner spinner-dark" /></div>
                ) : !rows.length ? (
                  <p className="note">None yet. Add the first competitor above.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {rows.map(c => (
                      <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="flex-row" style={{ justifyContent: 'space-between', gap: 8 }}>
                            <strong>{c.retailer_name}</strong>
                            <span className="note" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                              upd {fmtDate(c.updated_at)}{c.updated_by_name ? ` · ${c.updated_by_name}` : ''}
                            </span>
                          </div>
                          <div className="note" style={{ fontSize: 12, marginTop: 2 }}>{summarize(c) || '—'}</div>
                          {c.details && <div className="note" style={{ fontSize: 12, marginTop: 2 }}>“{c.details}”</div>}
                        </div>
                        <div className="flex-row" style={{ gap: 6 }}>
                          <button className="btn btn-sm btn-outline" onClick={() => startEdit(c)}>Edit</button>
                          <button className="btn btn-sm btn-outline" onClick={() => remove(c)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
    </div>
  )
}
