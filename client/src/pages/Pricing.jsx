import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import { useToast } from '../components/Toast.jsx'
import { downloadExcel } from '../lib/excel.js'
import { getPricingItems, savePricingItem, deletePricingItem, getPricingReport } from '../lib/api.js'
import { VAT_OPTIONS, vatPct, marginPct } from '../lib/pricingOptions.js'

// Pricing — back office only. Records sent here from Reports are priced:
// enter New Selling Price + VAT Rate (+ optional notes), Save → Priced.
// Margin recomputes live; empty when cost is unknown (e.g. most Non-Scans).
// Delete removes the pricing copy only — never the original task record.

const euro = (v) => (v == null || v === '' || isNaN(Number(v))) ? '' : `€${Number(v).toFixed(2)}`
const fmtDT = (iso) => iso ? new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: '2-digit' }) : ''

export default function Pricing() {
  const { session } = useStore()
  const toast = useToast()
  const isBO = session.mode === 'backoffice'

  const [items, setItems]       = useState([])
  const [edits, setEdits]       = useState({})     // id → {new_selling_price, vat_rate, pricing_notes}
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading]   = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]       = useState('')

  const load = async (filter = statusFilter) => {
    setLoading(true); setError('')
    try {
      const rows = await getPricingItems(filter)
      setItems(rows)
      // Seed row edits from stored values so re-opening shows what was saved.
      setEdits(Object.fromEntries(rows.map(it => [it.id, {
        new_selling_price: it.new_selling_price ?? '',
        vat_rate:          it.vat_rate || '',
        pricing_notes:     it.pricing_notes || ''
      }])))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { if (isBO) load() /* eslint-disable-next-line */ }, [isBO, statusFilter])

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
      const { cols, headers, rows } = await getPricingReport(statusFilter)
      if (!rows.length) { toast.error('Nothing to export for this filter.'); return }
      const stamp = new Date().toISOString().slice(0, 10)
      const suffix = statusFilter === 'all' ? '' : ` - ${statusFilter === 'priced' ? 'Priced' : 'To price'}`
      await downloadExcel(`Pricing${suffix} - ${stamp}.xlsx`, rows, cols, headers)
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
        <div className="flex-row" style={{ gap: 8, alignItems: 'center' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 150 }}>
            <option value="all">All statuses</option>
            <option value="to_price">To price</option>
            <option value="priced">Priced</option>
          </select>
          <button className="btn btn-sm btn-outline" onClick={exportExcel} disabled={downloading || !items.length}>
            {downloading ? <><span className="spinner spinner-dark" /> …</> : '↓ Excel'}
          </button>
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
          <div className="table-wrap">
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Task</th>
                  <th>Date</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Product Barcode</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Product Code</th>
                  <th style={{ minWidth: 220 }}>Description</th>
                  <th>UOM</th>
                  <th>Qty</th>
                  <th>Supplier</th>
                  <th>Item Status</th>
                  <th>Barcode Status</th>
                  <th>Record Status</th>
                  <th style={{ minWidth: 140 }}>Details</th>
                  <th style={{ minWidth: 120 }}>Record Notes</th>
                  <th>Cost</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Current SP</th>
                  <th style={{ whiteSpace: 'nowrap' }}>New Selling Price *</th>
                  <th style={{ whiteSpace: 'nowrap' }}>VAT Rate *</th>
                  <th style={{ whiteSpace: 'nowrap' }}>Margin %</th>
                  <th style={{ minWidth: 140 }}>Notes</th>
                  <th>Status</th>
                  <th></th>
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
                      <td style={{ whiteSpace: 'nowrap' }}>{it.store_name || empty}</td>
                      <td><strong>{it.task_type_name || empty}</strong></td>
                      <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDT(r.created_at)}</td>
                      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{it.product_barcode || empty}</td>
                      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{r.barcode_no || r.product_code || empty}</td>
                      <td>{r.item_name || r.description || r.product_name_label || empty}</td>
                      <td>{r.uom || empty}</td>
                      <td>{r.quantity ?? empty}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{[r.supl_id, r.supplier_code].filter(Boolean).join(' · ') || empty}</td>
                      <td>{r.item_status || empty}</td>
                      <td>{r.barcode_status || empty}</td>
                      <td>{r.status || empty}</td>
                      <td style={{ fontSize: 12 }}>{it.details_fmt || empty}</td>
                      <td style={{ fontSize: 12 }}>{r.notes || empty}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{euro(it.cost) || empty}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{euro(it.current_selling_price) || empty}</td>
                      <td>
                        <input
                          type="text" inputMode="decimal" placeholder="€"
                          value={e.new_selling_price ?? ''}
                          onChange={ev => { const v = ev.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setEdit(it.id, 'new_selling_price', v) }}
                          style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <select value={e.vat_rate || ''} onChange={ev => setEdit(it.id, 'vat_rate', ev.target.value)} style={{ width: 150 }}>
                          <option value="">— select —</option>
                          {VAT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.code} ({o.pct}%)</option>)}
                          {e.vat_rate && !VAT_OPTIONS.some(o => o.code.toLowerCase() === String(e.vat_rate).toLowerCase()) && (
                            <option value={e.vat_rate}>{e.vat_rate} (9999)</option>
                          )}
                        </select>
                        {vp === 9999 && <div className="note" style={{ fontSize: 11, color: 'var(--red, #c0392b)' }}>Unknown rate: 9999</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {mg == null ? empty : `${mg}%`}
                      </td>
                      <td>
                        <input
                          type="text" value={e.pricing_notes ?? ''}
                          onChange={ev => setEdit(it.id, 'pricing_notes', ev.target.value)}
                          placeholder="Notes…" style={{ width: 140 }}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isPriced
                          ? <span className="badge badge-completed" title={`Priced by ${it.priced_by_name || '—'} · ${fmtDT(it.priced_at)}`}>€ Priced</span>
                          : <span className="badge badge-pending">To price</span>}
                      </td>
                      <td>
                        <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-primary" disabled={savingId === it.id || !canSave} onClick={() => save(it)}
                            title={canSave ? (isPriced ? 'Save changes' : 'Save and mark Priced') : 'New Selling Price and VAT Rate are required'}>
                            {savingId === it.id ? <span className="spinner" /> : 'Save'}
                          </button>
                          <button className="btn btn-sm btn-outline" disabled={savingId === it.id} onClick={() => remove(it)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
