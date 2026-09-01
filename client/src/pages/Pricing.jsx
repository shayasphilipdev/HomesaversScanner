import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { useToast } from '../components/Toast.jsx'
import { downloadExcel } from '../lib/excel.js'
import { getPricingItems, savePricingItem, deletePricingItem, getPricingReport, getTaskTypes } from '../lib/api.js'
import { VAT_OPTIONS, vatPct, marginPct } from '../lib/pricingOptions.js'
import AgeClock from '../components/AgeClock.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import RecordDetailModal from '../components/RecordDetailModal.jsx'

// Pricing — back office only. Records sent here from Reports are priced:
// enter New Selling Price + VAT Rate (+ optional notes), Save → Priced.
// Margin recomputes live; empty when cost is unknown (e.g. most Non-Scans).
// Delete removes the pricing copy only — never the original task record.

const euro = (v) => (v == null || v === '' || isNaN(Number(v))) ? '' : `€${Number(v).toFixed(2)}`
const fmtDT = (iso) => iso ? new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: '2-digit' }) : ''

// Local (not UTC) calendar date as 'YYYY-MM-DD' — what a date-picker's
// "today" should mean to whoever is looking at the page right now.
const isoDate = (d) => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const todayStr = () => isoDate(new Date())
const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d) }

export default function Pricing() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [items, setItems]       = useState([])
  const [edits, setEdits]       = useState({})     // id → {new_selling_price, vat_rate, pricing_notes}
  const [statusFilter, setStatusFilter] = useState('all')
  const [taskTypes, setTaskTypes]     = useState([])
  const [taskTypeIds, setTaskTypeIds] = useState([])   // [] = all task types
  const [fromDate, setFromDate]       = useState(daysAgoStr(7))
  const [toDate, setToDate]           = useState(todayStr())
  const [loading, setLoading]   = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]       = useState('')
  const [detail, setDetail]     = useState(null)   // { record, storeName } | null — the Details popup

  useEffect(() => { getTaskTypes().then(setTaskTypes).catch(() => setTaskTypes([])) }, [])

  const filterOpts = () => ({ status: statusFilter, taskTypes: taskTypeIds, from: fromDate, to: toDate })

  const load = async () => {
    setLoading(true); setError('')
    try {
      const rows = await getPricingItems(filterOpts())
      // To price always on top, then by Task, newest first within a task.
      rows.sort((a, b) => {
        const pa = a.pricing_status === 'priced' ? 1 : 0
        const pb = b.pricing_status === 'priced' ? 1 : 0
        if (pa !== pb) return pa - pb
        const t = (a.task_type_name || '').localeCompare(b.task_type_name || '')
        if (t !== 0) return t
        return new Date(b.created_at) - new Date(a.created_at)
      })
      setItems(rows)
      // Seed row edits from stored values so re-opening shows what was saved.
      setEdits(Object.fromEntries(rows.map(it => [it.id, {
        new_selling_price: it.new_selling_price ?? '',
        vat_rate:          it.vat_rate || '',
        pricing_notes:     it.pricing_notes || ''
      }])))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (isBO) load() /* eslint-disable-next-line */ }, [isBO, statusFilter, taskTypeIds, fromDate, toDate])

  const setEdit = (id, k, v) => setEdits(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }))

  const save = async (it) => {
    const e = edits[it.id] || {}
    if (e.new_selling_price === '' || e.new_selling_price == null) { toast.error('New Selling Price is required.'); return }
    if (!e.vat_rate) { toast.error('VAT Rate is required.'); return }
    setSavingId(it.id)
    try {
      await savePricingItem(it.id, {
        new_selling_price: e.new_selling_price,
        vat_rate:          e.vat_rate,
        pricing_notes:     e.pricing_notes
      })
      toast.success(`${it.record?.item_name || it.product_barcode || 'Record'} priced.`)
      await load()
    } catch (err) { toast.error(err.message) } finally { setSavingId(null) }
  }

  const remove = async (it) => {
    const name = it.record?.item_name || it.record?.description || it.product_barcode || 'this record'
    if (!window.confirm(`Remove ${name} from the Pricing list?\n\nThe original record is NOT deleted — only this pricing copy.`)) return
    try { await deletePricingItem(it.id); await load() } catch (e) { toast.error(e.message) }
  }

  const exportExcel = async () => {
    setDownloading(true); setError('')
    try {
      const { cols, headers, rows } = await getPricingReport(filterOpts())
      if (!rows.length) { toast.error('Nothing to export for this filter.'); return }
      const stamp = new Date().toISOString().slice(0, 10)
      const suffix = statusFilter === 'all' ? '' : ` - ${statusFilter === 'priced' ? 'Priced' : 'To price'}`
      await downloadExcel(`Pricing${suffix} - ${stamp}.xlsx`, rows, cols, headers, new Set(['photo_product_url', 'photo_barcode_url']))
    } catch (e) { setError(e.message) } finally { setDownloading(false) }
  }

  if (!isBO) {
    return (
      <div className="card"><div className="empty-state">
        <p><strong>Back office only.</strong></p>
        <p className="note">The Pricing page is available to back-office logins.</p>
      </div></div>
    )
  }

  const toPrice = items.filter(i => i.pricing_status !== 'priced').length
  const priced  = items.filter(i => i.pricing_status === 'priced').length

  // Live VAT % + margin for an item using the row's current (unsaved) edits.
  const liveVat    = (it) => vatPct((edits[it.id] || {}).vat_rate)
  const liveMargin = (it) => marginPct((edits[it.id] || {}).new_selling_price, (edits[it.id] || {}).vat_rate, it.cost)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Pricing</div>
          <div className="page-subtitle">Price the records sent from Reports · {toPrice} to price · {priced} priced</div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="filter-row">
            <div className="filter-field"><label>Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="to_price">To price</option>
                <option value="priced">Priced</option>
              </select>
            </div>

            <div className="filter-field filter-field--wide"><label>Task type</label>
              <MultiSelectDropdown
                value={taskTypeIds}
                onChange={setTaskTypeIds}
                options={taskTypes.map(t => ({ id: t.code, label: t.name }))}
                placeholder="All task types"
              />
            </div>

            <div className="filter-field"><label>From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
            <div className="filter-field"><label>To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>

            <div className="filter-actions">
              <button className="btn btn-sm btn-outline" onClick={exportExcel} disabled={downloading || !items.length}>
                {downloading ? <><span className="spinner spinner-dark" /> …</> : '↓ Excel'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="login-error mb-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !items.length ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">€</div>
          <p><strong>Nothing here yet.</strong></p>
          <p className="note">Select records in Reports → HO records and use “€ Send to Pricing”.</p>
        </div></div>
      ) : (
        <div className="card">
          <div className="card-header">{items.length.toLocaleString('en-IE')} record(s)</div>
          <div className="table-wrap pricing-scroll">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Product Barcode</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Product Code</th>
                  <th style={{ minWidth: 200 }}>Description</th>
                  <th>Cost</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Current SP</th>
                  <th style={{ width: 80 }}>New Selling Price *</th>
                  <th style={{ width: 110 }}>VAT Rate *</th>
                  <th style={{ width: 60 }}>Margin %</th>
                  <th style={{ minWidth: 130 }}>Notes</th>
                  <th></th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const r = it.record || {}
                  const e = edits[it.id] || {}
                  const vp = liveVat(it)
                  const mg = liveMargin(it)
                  const isPriced = it.pricing_status === 'priced'
                  const canSave = e.new_selling_price !== '' && e.new_selling_price != null && !!e.vat_rate
                  const empty = <span className="td-muted">—</span>
                  return (
                    <tr key={it.id} style={isPriced ? { background: 'var(--surface-warm)' } : undefined}>
                      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{r.barcode_no || r.product_code || empty}</td>
                      <td className="td-code" title={it.product_barcode || ''} style={{ whiteSpace: 'nowrap', maxWidth: 85, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.product_barcode || empty}</td>
                      <td>{r.item_name || r.description || r.product_name_label || empty}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{euro(it.cost) || empty}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{euro(it.current_selling_price) || empty}</td>
                      <td>
                        <input
                          type="text" inputMode="decimal" placeholder="€"
                          value={e.new_selling_price ?? ''}
                          onChange={ev => { const v = ev.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setEdit(it.id, 'new_selling_price', v) }}
                          style={{ width: 55 }}
                        />
                      </td>
                      <td>
                        <select value={e.vat_rate || ''} onChange={ev => setEdit(it.id, 'vat_rate', ev.target.value)} title={e.vat_rate || ''} style={{ width: 85, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <option value="">— select —</option>
                          {VAT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.code} ({o.pct}%)</option>)}
                          {e.vat_rate && !VAT_OPTIONS.some(o => o.code.toLowerCase() === String(e.vat_rate).toLowerCase()) && (
                            <option value={e.vat_rate}>{e.vat_rate} (9999)</option>
                          )}
                        </select>
                        {vp === 9999 && <div className="note" style={{ fontSize: 11, color: 'var(--red, #c0392b)' }}>Unknown rate: 9999</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600, maxWidth: 45, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mg == null ? empty : `${mg}%`}
                      </td>
                      <td>
                        <input
                          type="text" value={e.pricing_notes ?? ''}
                          onChange={ev => setEdit(it.id, 'pricing_notes', ev.target.value)}
                          title={e.pricing_notes || ''}
                          placeholder="Notes…" style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <div className="flex-row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm btn-primary" disabled={savingId === it.id || !canSave} onClick={() => save(it)}
                            title={canSave ? (isPriced ? 'Save changes' : 'Save and mark Priced') : 'New Selling Price and VAT Rate are required'}>
                            {savingId === it.id ? <span className="spinner" /> : 'Save'}
                          </button>
                          <button
                            className="btn btn-sm btn-outline"
                            title="All details for this record"
                            onClick={() => setDetail({ record: r, storeName: it.store_name })}
                          >🔍 Details</button>
                          <button className="btn btn-sm btn-outline" disabled={savingId === it.id} onClick={() => remove(it)}>
                            Delete
                          </button>
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isPriced
                          ? <span className="badge badge-completed" title={`Priced by ${it.priced_by_name || '—'} · ${fmtDT(it.priced_at)}`}>€ Priced</span>
                          : (
                            <>
                              <span className="badge badge-pending">To price</span>
                              {/* Pricing blocks the store from selling — flag it sooner than the default 24h/72h cadence. */}
                              <AgeClock at={it.created_at} warnHours={8} staleHours={24} style={{ marginLeft: 5 }} />
                            </>
                          )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RecordDetailModal
        open={!!detail}
        record={detail?.record}
        storeName={detail?.storeName || ''}
        onClose={() => setDetail(null)}
      />
    </div>
  )
}
