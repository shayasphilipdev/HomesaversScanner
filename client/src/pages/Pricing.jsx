import { useEffect, useRef, useState } from 'react'
import { useStore } from '../App.jsx'
import { useToast } from '../components/Toast.jsx'
import { downloadExcel } from '../lib/excel.js'
import { getPricingItems, savePricingItem, deletePricingItem, getPricingReport, getTaskTypes } from '../lib/api.js'
import { VAT_OPTIONS, vatPct, marginPct } from '../lib/pricingOptions.js'
import AgeClock from '../components/AgeClock.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import RecordDetailModal from '../components/RecordDetailModal.jsx'

// Pricing — back office only. Records sent here from Reports are priced:
// enter New Selling Price + VAT Rate (+ optional notes) and it autosaves →
// Priced, 800ms after the last keystroke on that row (no Save button).
// Margin recomputes live; empty when cost is unknown (e.g. most Non-Scans).
// Delete removes the pricing copy only — never the original task record.

const AUTOSAVE_DELAY_MS = 800

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
  const [savingIds, setSavingIds] = useState(new Set())   // ids currently mid-autosave (a Set — more than one row can be saving at once)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]       = useState('')
  const [detail, setDetail]     = useState(null)   // { record, storeName } | null — the Details popup
  // id → { it, values, timer } — pending debounced autosaves, flushed on unmount.
  const pendingRef = useRef({})

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

  // Actually calls the API. Silently does nothing until both required fields
  // are filled — the same gate the old Save button's `disabled` enforced —
  // so autosave never fires a premature 400 while someone's still typing the
  // price and hasn't picked a VAT rate yet.
  const doSave = async (it, values) => {
    if (values.new_selling_price === '' || values.new_selling_price == null || !values.vat_rate) return
    setSavingIds(prev => new Set(prev).add(it.id))
    try {
      const updated = await savePricingItem(it.id, {
        new_selling_price: values.new_selling_price,
        vat_rate:          values.vat_rate,
        pricing_notes:     values.pricing_notes
      })
      // Merge the saved fields into the row in place rather than re-fetching
      // the whole list — a full reload re-sorts (to-price rows first) and
      // would yank a row out from under whoever's editing it the instant it
      // flips to Priced. Sort order catches up next time the list reloads
      // (a filter change, or reopening the page).
      setItems(prev => prev.map(x => (x.id === it.id ? { ...x, ...updated } : x)))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingIds(prev => { const next = new Set(prev); next.delete(it.id); return next })
    }
  }

  // Debounced per row — every keystroke resets that row's own timer, so
  // typing a whole price (or tabbing through price → VAT → notes) fires ONE
  // save 800ms after the last change, not one per keystroke.
  const scheduleAutosave = (it, nextValues) => {
    const existing = pendingRef.current[it.id]
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      delete pendingRef.current[it.id]
      doSave(it, nextValues)
    }, AUTOSAVE_DELAY_MS)
    pendingRef.current[it.id] = { it, values: nextValues, timer }
  }

  // Flush (not just cancel) any pending autosave on unmount — leaving the
  // page inside the debounce window must not silently drop the last edit.
  useEffect(() => {
    return () => {
      Object.values(pendingRef.current).forEach(({ timer, it, values }) => {
        clearTimeout(timer)
        doSave(it, values)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setEdit = (it, k, v) => {
    setEdits(prev => {
      const nextRow = { ...(prev[it.id] || {}), [k]: v }
      scheduleAutosave(it, nextRow)
      return { ...prev, [it.id]: nextRow }
    })
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
    <div className="pricing-compact">
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
                  <th style={{ whiteSpace: 'nowrap', width: 130 }}>Product Barcode</th>
                  <th style={{ whiteSpace: 'nowrap', width: 130 }}>Product Code</th>
                  <th style={{ minWidth: 180 }}>Description</th>
                  <th style={{ width: 90 }}>Cost</th>
                  <th style={{ whiteSpace: 'nowrap', width: 90 }}>Current SP</th>
                  <th style={{ whiteSpace: 'nowrap', width: 130 }}>New Selling Price *</th>
                  <th style={{ whiteSpace: 'nowrap', width: 140 }}>VAT Rate *</th>
                  <th style={{ whiteSpace: 'nowrap', width: 80 }}>Margin %</th>
                  <th style={{ width: 95 }}>Notes</th>
                  <th style={{ width: 120 }}></th>
                  <th style={{ width: 150 }}>Status</th>
                  {/* Delete lives in its own trailing column, away from Details —
                      users were misclicking Delete instead of Details when both
                      buttons sat side by side in one cell. */}
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const r = it.record || {}
                  const e = edits[it.id] || {}
                  const vp = liveVat(it)
                  const mg = liveMargin(it)
                  const isPriced = it.pricing_status === 'priced'
                  const isSaving = savingIds.has(it.id)
                  const empty = <span className="td-muted">—</span>
                  return (
                    <tr key={it.id} style={isPriced ? { background: 'var(--surface-warm)' } : undefined}>
                      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{r.barcode_no || r.product_code || empty}</td>
                      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>{it.product_barcode || empty}</td>
                      <td>{r.item_name || r.description || r.product_name_label || empty}</td>
                      <td style={{ whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{euro(it.cost) || empty}</td>
                      <td style={{ whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{euro(it.current_selling_price) || empty}</td>
                      <td>
                        <input
                          type="text" inputMode="decimal" placeholder="€"
                          value={e.new_selling_price ?? ''}
                          onChange={ev => { const v = ev.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setEdit(it, 'new_selling_price', v) }}
                          style={{ width: 110, background: '#fff', color: '#1a1a1a' }}
                        />
                      </td>
                      <td>
                        <select value={e.vat_rate || ''} onChange={ev => setEdit(it, 'vat_rate', ev.target.value)} title={e.vat_rate || ''} style={{ width: 120, background: '#fff', color: '#1a1a1a' }}>
                          <option value="">— select —</option>
                          {VAT_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.code} ({o.pct}%)</option>)}
                          {e.vat_rate && !VAT_OPTIONS.some(o => o.code.toLowerCase() === String(e.vat_rate).toLowerCase()) && (
                            <option value={e.vat_rate}>{e.vat_rate} (9999)</option>
                          )}
                        </select>
                        {vp === 9999 && <div className="note" style={{ fontSize: 11, color: 'var(--red, #c0392b)' }}>Unknown rate: 9999</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mg == null ? empty : `${mg}%`}
                      </td>
                      <td>
                        <input
                          type="text" value={e.pricing_notes ?? ''}
                          onChange={ev => setEdit(it, 'pricing_notes', ev.target.value)}
                          title={e.pricing_notes || ''}
                          placeholder="Notes…" style={{ width: 80, background: '#fff', color: '#1a1a1a' }}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div className="flex-row" style={{ gap: 6, whiteSpace: 'nowrap', alignItems: 'center' }}>
                          {isSaving && (
                            <span className="note" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <span className="spinner spinner-dark" /> Saving…
                            </span>
                          )}
                          <button
                            className="btn btn-sm btn-outline"
                            title="All details for this record"
                            onClick={() => setDetail({ record: r, storeName: it.store_name })}
                          >🔍 Details</button>
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
                      {/* Delete sits alone at the true end of the row, one full
                          column away from Details and Status — the previous
                          layout put it right beside Details, and rows scanned
                          left-to-right were landing a misclick on Delete. */}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-outline" disabled={isSaving} onClick={() => remove(it)}>
                          Delete
                        </button>
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
