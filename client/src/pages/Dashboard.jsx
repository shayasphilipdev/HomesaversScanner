import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../App.jsx'
import { getDashboardStats, getStores } from '../lib/api.js'

const STATUS_LABEL = {
  pending:          'Pending',
  completed:        'HQ completed',
  no_change_needed: 'No change',
  store_completed:  'Store confirmed'
}

const RANGES = [
  { key: 'today', label: 'Today',     days: 0  },
  { key: 'week',  label: 'This week', days: 7  },
  { key: 'month', label: 'This month',days: 30 }
]

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function toIso(d)      { return d.toISOString() }

function relativeRange(key) {
  const now = new Date()
  switch (key) {
    case 'today':
      return { from: toIso(startOfDay(now)), to: toIso(now) }
    case 'week':
      return { from: toIso(startOfDay(new Date(now - 7  * 86400000))), to: toIso(now) }
    default:
      return { from: toIso(startOfDay(new Date(now - 30 * 86400000))), to: toIso(now) }
  }
}

export default function Dashboard() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [rangeKey, setRangeKey]     = useState('month')
  const [storeFilter, setStoreFilter] = useState('all')
  const [stores, setStores]         = useState([])
  const [stats, setStats]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  useEffect(() => {
    if (isBO) getStores().then(setStores).catch(() => setStores([]))
  }, [isBO])

  useEffect(() => {
    const { from, to } = relativeRange(rangeKey)
    setLoading(true); setError('')
    getDashboardStats({ from, to, storeId: isBO ? storeFilter : undefined })
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [rangeKey, storeFilter, isBO])

  const totals = stats?.totals || { all: 0, pending: 0, completed: 0, no_change_needed: 0, store_completed: 0 }
  const reviewed = totals.completed + totals.no_change_needed

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Welcome back{isBO ? '' : `, ${session.storeName}`}</div>
          <div className="page-subtitle">Here's how things look in your scanner data</div>
        </div>
        <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map(r => (
            <button key={r.key} className={`btn btn-sm ${rangeKey === r.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRangeKey(r.key)}>
              {r.label}
            </button>
          ))}
          {isBO && (
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">All stores</option>
              {stores.filter(s => s.is_active).map(s => (
                <option key={s.id} value={s.id}>{s.store_name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="kpi-grid">
        <KpiCard label="Total records"    value={totals.all}             feature  sub={isBO ? 'All stores' : session.storeName} />
        <KpiCard label="Pending review"   value={totals.pending}         sub="Awaiting HQ action" />
        <KpiCard label="HQ reviewed"      value={reviewed}               sub={`${totals.completed} complete · ${totals.no_change_needed} no change`} />
        <KpiCard label="Store confirmed"  value={totals.store_completed} sub="Loop closed" />
      </div>

      <div className="dash-row">
        <ActivityChart byDay={stats?.by_day || []} loading={loading} />
        <TaskTypeBars  rows={stats?.by_task_type || []} loading={loading} />
      </div>

      {isBO && (
        <div className="dash-row">
          <StoresBars rows={stats?.by_store || []} loading={loading} />
          <RecentList rows={stats?.recent || []}   loading={loading} isBO={isBO} />
        </div>
      )}
      {!isBO && <RecentList rows={stats?.recent || []} loading={loading} isBO={isBO} />}
    </div>
  )
}

function KpiCard({ label, value, sub, feature }) {
  return (
    <div className={`kpi-card${feature ? ' kpi-feature' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{Number(value || 0).toLocaleString('en-IE')}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

function ActivityChart({ byDay, loading }) {
  // Build SVG bar chart of last 14 days
  const W = 600, H = 180, P = 24
  const max = Math.max(1, ...byDay.map(d => d.count))
  const bw = byDay.length ? (W - P * 2) / byDay.length : 0
  const total = byDay.reduce((s, d) => s + d.count, 0)

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>Activity · last 14 days</span>
        <span className="chip" style={{ marginLeft: 'auto' }}>
          <span className="chip-dot" /> {total} records
        </span>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 180, display: 'block' }}>
            <defs>
              <linearGradient id="bg-bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#C96442" stopOpacity=".95" />
                <stop offset="100%" stopColor="#C96442" stopOpacity=".55" />
              </linearGradient>
            </defs>
            {/* baseline */}
            <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#E8E1D2" strokeWidth="1" />
            {byDay.map((d, i) => {
              const h = d.count === 0 ? 2 : ((H - P * 2) * d.count) / max
              const x = P + i * bw + 3
              const y = H - P - h
              const w = Math.max(2, bw - 6)
              return (
                <g key={d.date}>
                  <rect x={x} y={y} width={w} height={h} rx="4" fill="url(#bg-bar)" />
                  {(i === 0 || i === byDay.length - 1 || i === Math.floor(byDay.length / 2)) && (
                    <text x={x + w / 2} y={H - 6} textAnchor="middle" fill="#8C8779" fontSize="10">
                      {new Date(d.date).toLocaleDateString('en-IE', { day: '2-digit', month: 'short' })}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}

function TaskTypeBars({ rows, loading }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="card">
      <div className="card-header">By task type</div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
        ) : !rows.length ? (
          <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>No records in this range yet.</p></div>
        ) : (
          rows.map(r => (
            <div className="stat-row" key={r.code}>
              <div className="stat-row-label"><strong>{r.code}</strong> · {r.name}</div>
              <div className="stat-row-bar"><span style={{ width: `${(r.count / max) * 100}%` }} /></div>
              <div className="stat-row-val">{r.count}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function StoresBars({ rows, loading }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="card">
      <div className="card-header">By store</div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
        ) : !rows.length ? (
          <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>No records in this range yet.</p></div>
        ) : (
          rows.slice(0, 8).map(r => (
            <div className="stat-row" key={r.id}>
              <div className="stat-row-label">{r.store_name || <span className="td-muted">—</span>}</div>
              <div className="stat-row-bar"><span style={{ width: `${(r.count / max) * 100}%` }} /></div>
              <div className="stat-row-val">{r.count}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RecentList({ rows, loading, isBO }) {
  return (
    <div className="card">
      <div className="card-header">Recent activity</div>
      <div className="card-body" style={{ padding: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
        ) : !rows.length ? (
          <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>Nothing yet — encourage your team to scan!</p></div>
        ) : (
          rows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,.04)' }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--primary-tint)', color: 'var(--primary-dark)', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.task_type}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.product || '—'} {isBO && r.store_name && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>· {r.store_name}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {STATUS_LABEL[r.status] || r.status} · {new Date(r.created_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
