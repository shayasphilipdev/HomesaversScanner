import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  getStores, adminListSpaceEquipment, adminUpdateSpaceEquipment,
  adminGetSpacePlanned, adminSetSpacePlanned
} from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import { useToast } from '../components/Toast.jsx'

export default function AdminSpacePlan() {
  const { session } = useStore()
  const toast = useToast()
  const isAdmin = session.mode === 'backoffice'

  const [equipment, setEquipment] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [busyId, setBusyId]       = useState(null)

  // Planned-count editor
  const [stores, setStores]       = useState([])
  const [storeId, setStoreId]     = useState(null)
  const [planned, setPlanned]     = useState({})   // equipment_id -> string
  const [dirty, setDirty]         = useState(new Set())
  const [plannedLoading, setPlannedLoading] = useState(false)
  const [savingPlanned, setSavingPlanned]   = useState(false)

  const loadEquipment = async () => {
    setLoading(true); setError('')
    try { setEquipment(await adminListSpaceEquipment()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!isAdmin) return
    loadEquipment()
    getStores().then(rows => setStores(rows.filter(s => s.is_active))).catch(() => setStores([]))
  }, [isAdmin])

  const toggleActive = async (e) => {
    setBusyId(e.id)
    try {
      const upd = await adminUpdateSpaceEquipment(e.id, { is_active: !e.is_active })
      setEquipment(list => list.map(x => x.id === e.id ? { ...x, is_active: upd.is_active } : x))
    } catch (err) { toast.error('Could not update — ' + (err?.message || '')) }
    finally { setBusyId(null) }
  }

  const loadPlanned = async (sid) => {
    setStoreId(sid)
    setDirty(new Set())
    if (!sid) { setPlanned({}); return }
    setPlannedLoading(true)
    try {
      const { planned: rows } = await adminGetSpacePlanned(sid)
      const m = {}
      for (const r of rows) m[r.equipment_id] = String(r.planned_count)
      setPlanned(m)
    } catch (e) { toast.error(e.message) }
    finally { setPlannedLoading(false) }
  }

  const setPlannedCell = (eqId, value) => {
    if (value !== '' && !/^\d+$/.test(value)) return
    setPlanned(prev => ({ ...prev, [eqId]: value }))
    setDirty(prev => new Set(prev).add(eqId))
  }

  const savePlanned = async () => {
    if (!dirty.size || !storeId) return
    setSavingPlanned(true)
    try {
      for (const eqId of dirty) {
        await adminSetSpacePlanned(storeId, eqId, planned[eqId] === '' ? 0 : Number(planned[eqId]))
      }
      setDirty(new Set())
      toast.success('Planned counts saved.')
    } catch (e) { toast.error('Save failed — ' + (e?.message || '')) }
    finally { setSavingPlanned(false) }
  }

  const storeOptions = useMemo(
    () => stores.map(s => ({ id: s.id, label: `${s.store_name} (${s.store_code})` })),
    [stores]
  )

  if (!isAdmin) {
    return <div className="card"><div className="empty-state"><p>Admin pages are only available to back-office users.</p></div></div>
  }

  const activeCount = equipment.filter(e => e.is_active).length

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Space Plan admin</div>
          <div className="page-subtitle">{activeCount} of {equipment.length} equipment visible to stores</div>
        </div>
      </div>

      <AdminNav />

      {error && <div className="login-error mb-12">{error}</div>}

      {/* Equipment visibility */}
      <div className="card mb-12">
        <div className="card-header">
          Equipment
          <span className="note" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
            Stores only see equipment that is shown. All start hidden.
          </span>
        </div>
        {loading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: 30 }}><span className="spinner spinner-dark" /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th style={{ width: 60 }}>#</th><th>Equipment</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {equipment.map(e => (
                  <tr key={e.id}>
                    <td className="td-muted">{e.sort_order}</td>
                    <td><strong>{e.name}</strong></td>
                    <td>
                      <span className={`badge ${e.is_active ? 'badge-completed' : 'badge-pending'}`}>
                        {e.is_active ? 'Shown' : 'Hidden'}
                      </span>
                    </td>
                    <td>
                      <div className="flex-row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className={`btn btn-sm ${e.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => toggleActive(e)}
                          disabled={busyId === e.id}
                        >
                          {busyId === e.id ? <span className="spinner" /> : e.is_active ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Planned counts editor */}
      <div className="card">
        <div className="card-header">Planned equipment counts</div>
        <div className="card-body">
          <div className="store-pick-bar" style={{ marginBottom: 14 }}>
            <span className="store-pick-label">Store</span>
            <div style={{ flex: 1, maxWidth: 360 }}>
              <MultiSelectDropdown
                single
                options={storeOptions}
                value={storeId ? [storeId] : []}
                onChange={arr => loadPlanned(arr[0] || null)}
                placeholder="— Pick a store —"
              />
            </div>
            {storeId && (
              <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={savePlanned} disabled={savingPlanned || !dirty.size}>
                {savingPlanned ? <><span className="spinner" /> Saving…</> : dirty.size ? `Save (${dirty.size})` : 'Saved'}
              </button>
            )}
          </div>

          {!storeId ? (
            <p className="note">Pick a store to view and edit its planned counts.</p>
          ) : plannedLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Equipment</th><th className="td-right" style={{ width: 160 }}>Planned count</th></tr>
                </thead>
                <tbody>
                  {equipment.map(e => (
                    <tr key={e.id}>
                      <td>
                        {e.name}
                        {!e.is_active && <span className="badge badge-pending" style={{ marginLeft: 8 }}>Hidden</span>}
                      </td>
                      <td className="td-right">
                        <input
                          type="text" inputMode="numeric"
                          value={planned[e.id] ?? ''}
                          onChange={ev => setPlannedCell(e.id, ev.target.value)}
                          placeholder="0"
                          style={{
                            width: 110, textAlign: 'right', padding: '6px 8px', borderRadius: 6,
                            border: dirty.has(e.id) ? '1px solid var(--primary)' : '1px solid var(--border)'
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
