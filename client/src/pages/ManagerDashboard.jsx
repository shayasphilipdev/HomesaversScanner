import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { getManagerOverview } from '../lib/api.js'
import { canSeeManagerDashboard } from '../lib/roles.js'

// Phone-first manager dashboard.
//   - Big finger-friendly KPI tiles up top
//   - "By store today" table ranked worst-first
//   - Last-7-days heatmap so a slipping store is obvious at a glance
// Tap any tile or row -> drill straight to the appropriate filtered view.

export default function ManagerDashboard() {
  const { session } = useStore()
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try { setData(await getManagerOverview()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (!canSeeManagerDashboard(session)) {
    return <div className="card"><div className="empty-state"><p>This page is for managers and head-office roles.</p></div></div>
  }

  if (loading) {
    return <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
  }
  if (error) {
    return <div className="login-error mt-12">{error}</div>
  }
  if (!data) return null

  const t = data.totals

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Manager view</div>
          <div className="page-subtitle">
            {data.per_store.length} store{data.per_store.length === 1 ? '' : 's'} · refreshed {new Date(data.as_of).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* KPI tiles — tap to drill */}
      <div className="kpi-grid">
        <KpiTile
          label="Today's HO records"
          value={t.ho_today}
          sub="logged across your stores"
          to="/reports"
          feature
        />
        <KpiTile
          label="Awaiting HO"
          value={t.ho_pending}
          sub="pending review"
          to="/tasks"
          tone={t.ho_pending > 0 ? 'warn' : 'ok'}
        />
        <KpiTile
          label="Awaiting Clear"
          value={t.ho_to_clear}
          sub="HO replied — verify at till"
          to="/tasks"
          tone={t.ho_to_clear > 0 ? 'warn' : 'ok'}
        />
        <KpiTile
          label="Today's checklists"
          value={t.store_completion_pct == null ? '—' : `${t.store_completion_pct}%`}
          sub={`${t.tasks_today_done} of ${t.tasks_today_total} done`}
          to="/store-tasks"
          tone={completionTone(t.store_completion_pct)}
        />
      </div>

      {/* Per-store league */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">By store today</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th className="td-right">HO today</th>
                <th className="td-right">Pending</th>
                <th className="td-right">To clear</th>
                <th className="td-right">Checklist</th>
              </tr>
            </thead>
            <tbody>
              {data.per_store.map(r => (
                <tr key={r.store_id}>
                  <td><strong>{r.store_name}</strong></td>
                  <td className="td-right">{r.ho_today}</td>
                  <td className="td-right">{r.ho_pending || <span className="td-muted">—</span>}</td>
                  <td className="td-right">{r.ho_to_clear || <span className="td-muted">—</span>}</td>
                  <td className="td-right"><CompletionPill pct={r.completion_pct} done={r.tasks_today_done} total={r.tasks_today_total} /></td>
                </tr>
              ))}
              {!data.per_store.length && (
                <tr><td colSpan={5} className="td-muted" style={{ textAlign: 'center', padding: 20 }}>No stores in your scope.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7-day heatmap */}
      {data.by_day_7.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">Checklist completion · last 7 days</div>
          <div className="card-body" style={{ paddingTop: 6 }}>
            <Heatmap rows={data.by_day_7} />
            <div className="flex-row" style={{ gap: 14, fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, flexWrap: 'wrap' }}>
              <LegendDot colour="#3E9F4B" label="≥ 90%" />
              <LegendDot colour="#7FB347" label="70–89%" />
              <LegendDot colour="#E0A03A" label="40–69%" />
              <LegendDot colour="#D14B3D" label="< 40%" />
              <LegendDot colour="var(--bg-soft)" label="no data" border />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiTile({ label, value, sub, to, feature, tone }) {
  const cls = ['kpi-card']
  if (feature) cls.push('kpi-feature')
  if (tone === 'warn') cls.push('kpi-card-warn')
  if (tone === 'ok')   cls.push('kpi-card-ok')
  return (
    <Link to={to} className={cls.join(' ')} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </Link>
  )
}

function completionTone(pct) {
  if (pct == null) return null
  if (pct >= 90) return 'ok'
  if (pct < 70)  return 'warn'
  return null
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

function Heatmap({ rows }) {
  if (!rows.length) return null
  const dayLabels = rows[0].days.map(d => new Date(d.date).toLocaleDateString('en-IE', { weekday: 'short' }))
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, 1fr) repeat(7, 36px)',
        gap: 4, alignItems: 'center', fontSize: 12.5, minWidth: 360
      }}>
        <div></div>
        {dayLabels.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>{d}</div>
        ))}
        {rows.map(r => (
          <Fragment key={r.store_id}>
            <div style={{ fontWeight: 600, paddingRight: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.store_name}</div>
            {r.days.map(d => (
              <div key={d.date}
                title={`${r.store_name} · ${new Date(d.date).toLocaleDateString('en-IE', { day: '2-digit', month: 'short' })} · ${d.pct == null ? 'no checklist' : d.pct + '%'}`}
                style={{
                  height: 28, borderRadius: 4,
                  background: heatColour(d.pct),
                  border: d.pct == null ? '1px solid var(--border-soft)' : 'none'
                }} />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function heatColour(pct) {
  if (pct == null) return 'var(--bg-soft)'
  if (pct >= 90) return '#3E9F4B'
  if (pct >= 70) return '#7FB347'
  if (pct >= 40) return '#E0A03A'
  return '#D14B3D'
}

function LegendDot({ colour, label, border }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        width: 14, height: 14, borderRadius: 3, display: 'inline-block',
        background: colour, border: border ? '1px solid var(--border)' : 'none'
      }} />
      {label}
    </span>
  )
}

