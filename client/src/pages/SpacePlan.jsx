import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../App.jsx'
import { useCurrentStore } from '../lib/currentStore.jsx'
import { getSpacePlanGrid, saveSpacePlanCounts, getSpacePlanReport } from '../lib/api.js'
import { downloadExcel } from '../lib/excel.js'
import CurrentStorePicker from '../components/CurrentStorePicker.jsx'
import { useToast } from '../components/Toast.jsx'

const cellKey = (eqId, catId) => `${eqId}|${catId}`

// Sum the audited cells for one equipment across all categories.
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
  if (v > 0)   return { color: 'var(--green)', fontWeight: 700 }   // over plan
  return { color: 'var(--red)', fontWeight: 700 }                  // under plan
}

export default function SpacePlan() {
  const { session } = useStore()
  const toast = useToast()
  const { currentStoreId, scopedStores, ready } = useCurrentStore()

  const [data, setData]       = useState(null)   // { equipment, categories, planned, counts }
  const [cells, setCells]     = useState({})     // `${eq}|${cat}` -> string
  const [dirty, setDirty]     = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError]     = useState('')

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
      setDirty(new Set())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [currentStoreId])

  const setCell = (eqId, catId, value) => {
    // Allow only non-negative integers (or blank).
    if (value !== '' && !/^\d+$/.test(value)) return
    const k = cellKey(eqId, catId)
    setCells(prev => ({ ...prev, [k]: value }))
    setDirty(prev => new Set(prev).add(k))
  }

  const save = async () => {
    if (!dirty.size) return
    setSaving(true); setError('')
    const changed = [...dirty].map(k => {
      const [equipment_id, category_id] = k.split('|')
      const v = cells[k]
      return { equipment_id, category_id, audited_count: v === '' || v == null ? null : Number(v) }
    })
    try {
      await saveSpacePlanCounts(currentStoreId, changed)
      setDirty(new Set())
      toast.success(`Saved ${changed.length} count${changed.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e.message); toast.error('Save failed — ' + (e?.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const exportExcel = async () => {
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

  const equipment  = data?.equipment  || []
  const categories = data?.categories || []
  const stickyCol = { position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Space Plan</div>
          <div className="page-subtitle">Count store equipment by department and compare with the plan</div>
        </div>
        {currentStoreId && equipment.length > 0 && (
          <div className="flex-row" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={exportExcel} disabled={downloading}>
              {downloading ? <><span className="spinner spinner-dark" /> Preparing…</> : '↓ Excel'}
            </button>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving || !dirty.size}>
              {saving ? <><span className="spinner" /> Saving…</> : dirty.size ? `Save (${dirty.size})` : 'Saved'}
            </button>
          </div>
        )}
      </div>

      <CurrentStorePicker subject="count" />

      {error && <div className="login-error mb-12">{error}</div>}

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
            {/* Equipment Variance summary — top of page */}
            <div className="card mb-12">
              <div className="card-header">Equipment Variance</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Equipment</th>
                      <th className="td-right">Planned</th>
                      <th className="td-right">Audited total</th>
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
                          <td className="td-right" style={varianceTone(variance)}>
                            {variance > 0 ? `+${variance}` : variance}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Entry grid — equipment rows x category columns */}
            <div className="card">
              <div className="card-header">
                Count grid
                <span className="note" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
                  Enter how many of each equipment serve each department.
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ ...stickyCol, minWidth: 180 }}>Equipment</th>
                      <th className="td-right">Planned</th>
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
                          <td className="td-right" style={varianceTone(variance)}>{variance > 0 ? `+${variance}` : variance}</td>
                          {categories.map(c => {
                            const k = cellKey(e.id, c.id)
                            return (
                              <td key={c.id} style={{ padding: 4 }}>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={cells[k] ?? ''}
                                  onChange={ev => setCell(e.id, c.id, ev.target.value)}
                                  style={{
                                    width: 56, textAlign: 'right', padding: '6px 8px',
                                    border: dirty.has(k) ? '1px solid var(--primary)' : '1px solid var(--border)',
                                    borderRadius: 6, background: 'var(--surface)'
                                  }}
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
          </>
        )}
    </div>
  )
}
