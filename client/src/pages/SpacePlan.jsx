import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../App.jsx'
import { useCurrentStore } from '../lib/currentStore.jsx'
import { getSpacePlanGrid, saveSpacePlanCounts, getSpacePlanReport } from '../lib/api.js'
import { downloadExcel } from '../lib/excel.js'
import CurrentStorePicker from '../components/CurrentStorePicker.jsx'
import { useToast } from '../components/Toast.jsx'

const cellKey = (eqId, catId) => `${eqId}|${catId}`

function equipmentTotal(cells, eqId, categories) {
  let t = 0
  for (const c of categories) {
    const v = cells[cellKey(eqId, c.id)]
    if (v !== '' && v != null && !isNaN(Number(v))) t += Number(v)
  }
  return t
}

function varianceTone(v) {
  if (v === 0) return { color: 'var(--text-muted)' }
  if (v > 0)   return { color: 'var(--green)', fontWeight: 700 }
  return { color: 'var(--red)', fontWeight: 700 }
}
const fmtVar = v => (v > 0 ? `+${v}` : String(v))

// Switch to the stacked layout on phones.
function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const fn = e => setM(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return m
}

export default function SpacePlan() {
  const { session } = useStore()
  const toast = useToast()
  const isMobile = useIsMobile()
  const { currentStoreId, scopedStores, ready } = useCurrentStore()

  const [data, setData]       = useState(null)
  const [cells, setCells]     = useState({})
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]     = useState('')
  const [status, setStatus]   = useState('idle')   // idle | dirty | saving | saved | error
  const [expanded, setExpanded] = useState(() => new Set())

  // Pending auto-save buffer (keyed cell → payload), tagged with the store it
  // belongs to so switching stores never writes to the wrong one.
  const pendingRef = useRef({ storeId: null, cells: new Map() })
  const timerRef   = useRef(null)
  const flushRef   = useRef(() => {})

  const plannedByEq = useMemo(() => {
    const m = {}
    for (const p of (data?.planned || [])) m[p.equipment_id] = p.planned_count
    return m
  }, [data])

  const load = async () => {
    if (!currentStoreId) { setData(null); return }
    setLoading(true); setError('')
    try {
      const d = await getSpacePlanGrid(currentStoreId)
      setData(d)
      const init = {}
      for (const c of (d.counts || [])) {
        if (c.audited_count != null) init[cellKey(c.equipment_id, c.category_id)] = String(c.audited_count)
      }
      setCells(init)
      pendingRef.current = { storeId: null, cells: new Map() }
      setStatus('idle')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [currentStoreId])

  // ── Auto-save ────────────────────────────────────────────────────────────
  const flush = async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const p = pendingRef.current
    if (!p.cells.size || !p.storeId) return
    const storeId = p.storeId
    const batch = [...p.cells.values()]
    pendingRef.current = { storeId: null, cells: new Map() }
    setStatus('saving')
    try {
      await saveSpacePlanCounts(storeId, batch)
      // Only show "saved" if nothing new queued while we were saving.
      setStatus(pendingRef.current.cells.size ? 'dirty' : 'saved')
    } catch (e) {
      // Re-queue so the next flush retries.
      const cur = pendingRef.current
      cur.storeId = storeId
      for (const c of batch) cur.cells.set(cellKey(c.equipment_id, c.category_id), c)
      setStatus('error'); setError(e.message)
    }
  }
  flushRef.current = flush

  // Flush any pending edits when leaving the page.
  useEffect(() => () => { flushRef.current() }, [])

  const scheduleFlush = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flushRef.current(), 1000)
  }

  const setCell = (eqId, catId, value) => {
    if (value !== '' && !/^\d+$/.test(value)) return
    const k = cellKey(eqId, catId)
    setCells(prev => ({ ...prev, [k]: value }))
    const p = pendingRef.current
    p.storeId = currentStoreId
    p.cells.set(k, { equipment_id: eqId, category_id: catId, audited_count: value === '' ? null : Number(value) })
    setStatus('dirty')
    scheduleFlush()
  }

  const exportExcel = async () => {
    await flush()
    setDownloading(true); setError('')
    try {
      const { cols, headers, rows } = await getSpacePlanReport(currentStoreId)
      if (!rows.length) { toast.error('Nothing to export yet.'); return }
      const store = scopedStores.find(s => s.id === currentStoreId)
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadExcel(`Space Plan - ${store?.store_code || 'store'} - ${stamp}.xlsx`, rows, cols, headers)
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  const toggleEq = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const equipment  = data?.equipment  || []
  const categories = data?.categories || []
  const stickyCol = { position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }

  const statusLabel = {
    idle:   '',
    dirty:  '● Unsaved…',
    saving: 'Saving…',
    saved:  '✓ All changes saved',
    error:  '⚠ Save failed — retrying'
  }[status]
  const statusCls = `sp-status ${status}`

  return (
    <div className="sp-page">
      <div className="page-header">
        <div>
          <div className="page-title">Space Plan</div>
          <div className="page-subtitle">Count equipment by department · saves automatically</div>
        </div>
        {currentStoreId && equipment.length > 0 && (
          <div className="flex-row" style={{ gap: 10, alignItems: 'center' }}>
            {statusLabel && <span className={statusCls}>{statusLabel}</span>}
            <button className="btn btn-sm btn-outline" onClick={exportExcel} disabled={downloading}>
              {downloading ? <><span className="spinner spinner-dark" /> …</> : '↓ Excel'}
            </button>
          </div>
        )}
      </div>

      <CurrentStorePicker subject="count" />

      {error && status !== 'error' && <div className="login-error mb-12">{error}</div>}

      {!ready ? null
        : !currentStoreId ? (
          <div className="card"><div className="empty-state"><p>Pick a store above to start counting.</p></div></div>
        ) : loading ? (
          <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
        ) : !equipment.length ? (
          <div className="card"><div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p><strong>No equipment is enabled yet.</strong></p>
            <p className="note">Head office turns equipment on in Admin → Space Plan when it's ready to be counted.</p>
          </div></div>
        ) : (
          <>
            {/* Equipment Variance summary */}
            <div className="card mb-12">
              <div className="card-header">Equipment Variance</div>
              <div className="table-wrap">
                <table className="sp-grid">
                  <thead>
                    <tr>
                      <th>Equipment</th>
                      <th className="td-right">Planned</th>
                      <th className="td-right">Audited</th>
                      <th className="td-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipment.map(e => {
                      const planned = plannedByEq[e.id] ?? 0
                      const total   = equipmentTotal(cells, e.id, categories)
                      const variance = total - planned
                      return (
                        <tr key={e.id}>
                          <td><strong>{e.name}</strong></td>
                          <td className="td-right">{planned}</td>
                          <td className="td-right">{total}</td>
                          <td className="td-right" style={varianceTone(variance)}>{fmtVar(variance)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Entry — stacked cards on phones, wide grid on larger screens */}
            {isMobile ? (
              <div>
                {equipment.map(e => {
                  const planned = plannedByEq[e.id] ?? 0
                  const total   = equipmentTotal(cells, e.id, categories)
                  const variance = total - planned
                  const open = expanded.has(e.id)
                  return (
                    <div className="sp-eq-card" key={e.id}>
                      <button type="button" className="sp-eq-head" onClick={() => toggleEq(e.id)} aria-expanded={open}>
                        <span className="sp-eq-name">{e.name}</span>
                        <span className="sp-eq-meta">
                          {total}/{planned} <span style={varianceTone(variance)}>({fmtVar(variance)})</span>
                        </span>
                        <span aria-hidden style={{ fontSize: 14 }}>{open ? '▾' : '▸'}</span>
                      </button>
                      {open && (
                        <div className="sp-eq-body">
                          {categories.map(c => {
                            const k = cellKey(e.id, c.id)
                            return (
                              <label className="sp-cat-row" key={c.id}>
                                <span>{c.name}</span>
                                <input
                                  type="text" inputMode="numeric"
                                  value={cells[k] ?? ''}
                                  onChange={ev => setCell(e.id, c.id, ev.target.value)}
                                  onBlur={() => flush()}
                                  placeholder="0"
                                />
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="card">
                <div className="card-header">
                  Count grid
                  <span className="note sp-hint" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
                    Enter how many of each equipment serve each department.
                  </span>
                </div>
                <div className="table-wrap">
                  <table className="sp-grid">
                    <thead>
                      <tr>
                        <th style={{ ...stickyCol, minWidth: 170 }}>Equipment</th>
                        <th className="td-right">Plan</th>
                        <th className="td-right">Total</th>
                        <th className="td-right">Var.</th>
                        {categories.map(c => <th key={c.id} className="td-right" style={{ whiteSpace: 'nowrap' }}>{c.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map(e => {
                        const planned = plannedByEq[e.id] ?? 0
                        const total   = equipmentTotal(cells, e.id, categories)
                        const variance = total - planned
                        return (
                          <tr key={e.id}>
                            <td style={{ ...stickyCol }}><strong>{e.name}</strong></td>
                            <td className="td-right td-muted">{planned}</td>
                            <td className="td-right"><strong>{total}</strong></td>
                            <td className="td-right" style={varianceTone(variance)}>{fmtVar(variance)}</td>
                            {categories.map(c => {
                              const k = cellKey(e.id, c.id)
                              return (
                                <td key={c.id} style={{ padding: 3 }}>
                                  <input
                                    type="text" inputMode="numeric"
                                    value={cells[k] ?? ''}
                                    onChange={ev => setCell(e.id, c.id, ev.target.value)}
                                    onBlur={() => flush()}
                                    className="sp-cell"
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
    </div>
  )
}
