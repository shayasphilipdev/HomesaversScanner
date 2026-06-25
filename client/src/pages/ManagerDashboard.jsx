import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { getManagerOverview } from '../lib/api.js'
import { canSeeManagerDashboard } from '../lib/roles.js'

export default function ManagerDashboard() {
  const { session } = useStore()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try { setData(await getManagerOverview()) }
    catch (e) { setError(e.message) }
    finally   { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (!canSeeManagerDashboard(session)) {
    return <div className="card"><div className="empty-state"><p>This page is for managers and head-office roles.</p></div></div>
  }
  if (loading) {
    return <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
  }
  if (error) return <div className="login-error mt-12">{error}</div>
  if (!data)  return null

  const t = data.totals
  const perStore = data.per_store   // sorted worst-first by backend
  const total    = perStore.length

  // Derived manager-specific metrics (not available on main dashboard)
  const storesActive    = perStore.filter(r => r.ho_today > 0 || r.tasks_today_done > 0).length
  const storesOnTrack   = perStore.filter(r => r.completion_pct != null && r.completion_pct >= 70).length
  const storesAlert     = perStore.filter(r => r.ho_today === 0 && (r.completion_pct == null || r.completion_pct < 40)).length

  // Build store_id → days[] lookup from heatmap data
  const dayMap = Object.fromEntries((data.by_day_7 || []).map(r => [r.store_id, r.days]))
  const dayKeys = data.by_day_7?.[0]?.days.map(d => d.date) || []
  const todayKey = dayKeys[dayKeys.length - 1]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Store overview</div>
          <div className="page-subtitle">
            {total} store{total !== 1 ? 's' : ''} in scope · refreshed {new Date(data.as_of).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Manager-specific KPIs — not duplicated on main dashboard */}
      <div className="kpi-grid">
        <MgrKpi
          label="Stores active today"
          value={`${storesActive} / ${total}`}
          sub="have HO or checklist activity"
          feature
        />
        <MgrKpi
          label="Checklists on track"
          value={storesOnTrack}
          sub={`of ${total} stores ≥ 70% done`}
          to="/store-tasks"
          tone={storesOnTrack === total ? 'ok' : storesOnTrack < total / 2 ? 'warn' : null}
        />
        <MgrKpi
          label="Photos today"
          value={t.photos_today ?? 0}
          sub="product + barcode across stores"
        />
        <MgrKpi
          label="Need attention"
          value={storesAlert}
          sub="no HO + low checklist today"
          to="/store-tasks"
          tone={storesAlert > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* Unified table — today's stats + 7-day checklist trend in one row per store */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>Store details · today + checklist trend</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <HeatLegend />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th className="td-right" title="HO task records logged today">HO today</th>
                <th className="td-right" title="HO records pending review">Pending</th>
                <th className="td-right" title="HO reviewed — waiting for store to clear">To clear</th>
                <th className="td-right" title="Today's checklist completion">Checklist</th>
                {dayKeys.map((d, i) => {
                  const isToday = d === todayKey
                  const label   = new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { weekday: 'short' })
                  const dayNum  = new Date(d + 'T12:00:00').getDate()
                  return (
                    <th key={d} style={{ width: 34, textAlign: 'center', padding: '6px 2px' }}>
                      <div style={{ fontSize: 9, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--primary)' : 'var(--text-muted)', lineHeight: 1.3 }}>
                        {label.slice(0, 2)}
                      </div>
                      <div style={{ fontSize: 9, color: isToday ? 'var(--primary)' : 'var(--text-muted)', fontWeight: isToday ? 700 : 400 }}>
                        {dayNum}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {perStore.length === 0 && (
                <tr><td colSpan={5 + dayKeys.length} className="td-muted" style={{ textAlign: 'center', padding: 20 }}>No stores in scope.</td></tr>
              )}
              {perStore.map(r => {
                const days   = dayMap[r.store_id] || []
                const alert  = r.ho_today === 0 && (r.completion_pct == null || r.completion_pct < 40)
                return (
                  <tr key={r.store_id} style={alert ? { borderLeft: '3px solid #E0A03A' } : undefined}>
                    <td>
                      <strong style={{ fontSize: 13 }}>{r.store_name}</strong>
                      {r.store_code && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{r.store_code}</span>}
                    </td>
                    <td className="td-right">
                      {r.ho_today > 0
                        ? <strong style={{ color: 'var(--primary)' }}>{r.ho_today}</strong>
                        : <span className="td-muted">—</span>}
                    </td>
                    <td className="td-right">
                      {r.ho_pending > 0
                        ? <span style={{ color: '#B47F1E', fontWeight: 600 }}>{r.ho_pending}</span>
                        : <span className="td-muted">—</span>}
                    </td>
                    <td className="td-right">
                      {r.ho_to_clear > 0
                        ? <span style={{ color: '#3E9F4B', fontWeight: 600 }}>{r.ho_to_clear}</span>
                        : <span className="td-muted">—</span>}
                    </td>
                    <td className="td-right">
                      <CompletionPill pct={r.completion_pct} done={r.tasks_today_done} total={r.tasks_today_total} />
                    </td>
                    {days.map(d => (
                      <td key={d.date} style={{ padding: '4px 3px', textAlign: 'center' }}>
                        <div
                          title={d.pct == null ? 'No checklist data' : `${d.pct}%`}
                          style={{
                            width: 26, height: 26, borderRadius: 5, margin: '0 auto',
                            background: heatColour(d.pct),
                            border: d.pct == null ? '1px solid var(--border-soft)' : 'none',
                            boxShadow: d.date === todayKey && d.pct != null ? '0 0 0 2px var(--primary)' : 'none'
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MgrKpi({ label, value, sub, to, feature, tone }) {
  const cls = ['kpi-card']
  if (feature)         cls.push('kpi-feature')
  if (tone === 'warn') cls.push('kpi-card-warn')
  if (tone === 'ok')   cls.push('kpi-card-ok')
  const inner = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </>
  )
  return to
    ? <Link to={to} className={cls.join(' ')} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
    : <div className={cls.join(' ')}>{inner}</div>
}

function CompletionPill({ pct, done, total }) {
  if (pct == null) return <span className="td-muted">—</span>
  const colour = pct >= 90 ? '#3E9F4B' : pct >= 70 ? '#7FB347' : pct >= 40 ? '#E0A03A' : '#D14B3D'
  return (
    <span title={`${done} of ${total} done`} style={{
      background: colour, color: '#fff',
      padding: '2px 10px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 600
    }}>
      {pct}%
    </span>
  )
}

function heatColour(pct) {
  if (pct == null) return 'var(--bg-soft)'
  if (pct >= 90) return '#3E9F4B'
  if (pct >= 70) return '#7FB347'
  if (pct >= 40) return '#E0A03A'
  return '#D14B3D'
}

function HeatLegend() {
  const items = [
    { colour: '#3E9F4B', label: '≥ 90%' },
    { colour: '#7FB347', label: '70–89%' },
    { colour: '#E0A03A', label: '40–69%' },
    { colour: '#D14B3D', label: '< 40%' },
    { colour: 'var(--bg-soft)', label: 'no data', border: true },
  ]
  return (
    <>
      {items.map(i => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, display: 'inline-block', background: i.colour, border: i.border ? '1px solid var(--border)' : 'none', flexShrink: 0 }} />
          {i.label}
        </span>
      ))}
    </>
  )
}
