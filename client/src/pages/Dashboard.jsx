import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../App.jsx'
import { getDashboardStats, getStores, getAreas } from '../lib/api.js'
import { TASK_FORMS } from '../lib/taskTypes.js'
import { downloadExcel } from '../lib/excel.js'
import Skeleton from '../components/Skeleton.jsx'

const STATUS_LABEL = {
  pending:          'Pending',
  completed:        'HO completed',
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
  // scope is encoded as a single string:
  //   'all'              → all stores in user scope
  //   'area:<area_id>'   → all stores in that area (intersected with user scope)
  //   'store:<store_id>' → that single store
  const [scope, setScope]           = useState('all')
  const [stores, setStores]         = useState([])
  const [areas, setAreas]           = useState([])
  const [stats, setStats]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')

  useEffect(() => {
    if (isBO) {
      getStores().then(setStores).catch(() => setStores([]))
      getAreas().then(setAreas).catch(() => setAreas([]))
    }
  }, [isBO])

  // Build the storeIds list to send to the backend based on the current scope.
  const scopedStoreIds = useMemo(() => {
    if (!isBO) return null
    if (scope === 'all') return null
    if (scope.startsWith('area:')) {
      const aid = scope.slice(5)
      return stores.filter(s => s.is_active && s.area_id === aid).map(s => s.id)
    }
    if (scope.startsWith('store:')) return [scope.slice(6)]
    return null
  }, [scope, stores, isBO])

  useEffect(() => {
    const { from, to } = relativeRange(rangeKey)
    setLoading(true); setError('')
    const args = { from, to }
    if (isBO) {
      if (Array.isArray(scopedStoreIds) && scopedStoreIds.length) args.storeIds = scopedStoreIds
      // null = all stores in user scope (no filter)
    }
    getDashboardStats(args)
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [rangeKey, scope, scopedStoreIds, isBO])

  const totals = stats?.totals   || { all: 0, pending: 0, completed: 0, no_change_needed: 0, store_completed: 0 }
  const ho     = stats?.ho_totals  || { all: 0, pending: 0, completed: 0, no_change_needed: 0, store_completed: 0 }
  const ops    = stats?.ops_totals || { all: 0, pending: 0, store_completed: 0 }
  const hoReviewed = ho.completed + ho.no_change_needed

  const scopeLabel = (() => {
    if (scope === 'all') return 'All stores'
    if (scope.startsWith('area:')) {
      const a = areas.find(x => x.id === scope.slice(5))
      return a ? `Area · ${a.area_name}` : 'Area'
    }
    if (scope.startsWith('store:')) {
      const s = stores.find(x => x.id === scope.slice(6))
      return s ? s.store_name : 'Store'
    }
    return ''
  })()

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Welcome back</div>
          <div className="page-subtitle">{isBO ? `Showing: ${scopeLabel}` : "Here's how your scanner activity is looking"}</div>
        </div>
        <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map(r => (
            <button key={r.key} className={`btn btn-sm ${rangeKey === r.key ? 'btn-primary' : 'btn-outline'}`} onClick={() => setRangeKey(r.key)}>
              {r.label}
            </button>
          ))}
          {isBO && (
            <select value={scope} onChange={e => setScope(e.target.value)} style={{ width: 'auto', minWidth: 200, maxWidth: 260 }}>
              <option value="all">All stores in scope</option>
              {areas.length > 0 && (
                <optgroup label="By area">
                  {areas.map(a => <option key={a.id} value={`area:${a.id}`}>Area · {a.area_name}</option>)}
                </optgroup>
              )}
              <optgroup label="By store">
                {stores.filter(s => s.is_active).map(s => (
                  <option key={s.id} value={`store:${s.id}`}>{s.store_name}</option>
                ))}
              </optgroup>
            </select>
          )}
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      <div className="kpi-grid">
        <SplitKpiCard loading={loading} feature
          hoLabel="Total HO records"  hoValue={ho.all}           hoSub={isBO ? scopeLabel : 'Your stores'}
          opsLabel="Total ops records" opsValue={ops.all}        opsSub={isBO ? scopeLabel : 'Your stores'}
        />
        <SplitKpiCard loading={loading}
          hoLabel="Pending review"    hoValue={ho.pending}       hoSub="Awaiting HO action"
          opsLabel="Pending action"   opsValue={ops.pending}     opsSub="Store to clear"
        />
        <SplitKpiCard loading={loading}
          hoLabel="HO reviewed"       hoValue={hoReviewed}       hoSub={`${ho.completed} complete · ${ho.no_change_needed} no change`}
          opsLabel="Store cleared"    opsValue={ops.store_completed} opsSub="Actioned by store"
        />
        <KpiCard loading={loading} label="Store confirmed" value={ho.store_completed} sub="Loop closed" />
      </div>

      <div className="dash-row dash-row--thirds">
        <TaskDonutOps    rows={stats?.by_task_type || []} loading={loading} />
        <TaskDonutChecks rows={stats?.by_task_type || []} loading={loading} />
        {isBO && <StoresMissingDeptCheck byStore={stats?.by_store || []} allStores={stores} scopeStoreIds={scopedStoreIds} loading={loading} />}
      </div>

      {isBO && <StoreDonutGrid rows={stats?.by_store || []} loading={loading} allStores={stores} />}
      {!isBO && <RecentList rows={stats?.recent || []} loading={loading} isBO={isBO} />}

      {/* Activity — moved below the store graph and made compact (secondary info). */}
      <ActivityChart byDay={stats?.by_day || []} loading={loading} compact />
    </div>
  )
}

function KpiCard({ label, value, sub, tone, loading }) {
  const cls = ['kpi-card']
  if (tone === 'warn') cls.push('kpi-card-warn')
  if (tone === 'ok')   cls.push('kpi-card-ok')
  return (
    <div className={cls.join(' ')}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {loading ? <Skeleton w={80} h={28} /> : Number(value || 0).toLocaleString('en-IE')}
      </div>
      {sub && <div className="kpi-sub">{loading ? <Skeleton w={140} h={12} /> : sub}</div>}
    </div>
  )
}

function SplitKpiCard({ loading, feature, hoLabel, hoValue, hoSub, opsLabel, opsValue, opsSub }) {
  return (
    <div className={`kpi-card kpi-split${feature ? ' kpi-split-feature' : ''}`}>
      <div className="kpi-split-side kpi-split-ho">
        <div className="kpi-split-tag">HO</div>
        <div className="kpi-label">{hoLabel}</div>
        <div className="kpi-value">{loading ? <Skeleton w={70} h={26} /> : Number(hoValue || 0).toLocaleString('en-IE')}</div>
        {hoSub && <div className="kpi-sub">{loading ? <Skeleton w={120} h={11} /> : hoSub}</div>}
      </div>
      <div className="kpi-split-divider" />
      <div className="kpi-split-side kpi-split-ops">
        <div className="kpi-split-tag ops">Ops</div>
        <div className="kpi-label">{opsLabel}</div>
        <div className="kpi-value">{loading ? <Skeleton w={70} h={26} /> : Number(opsValue || 0).toLocaleString('en-IE')}</div>
        {opsSub && <div className="kpi-sub">{loading ? <Skeleton w={120} h={11} /> : opsSub}</div>}
      </div>
    </div>
  )
}

function ActivityChart({ byDay, loading, compact }) {
  const days = Array.isArray(byDay) ? byDay : []

  const hoTotal  = days.reduce((s, d) => s + (d.ho_count  || 0), 0)
  const opsTotal = days.reduce((s, d) => s + (d.ops_count || 0), 0)
  const fmt = (n) => n.toLocaleString('en-IE')

  // SVG coordinate space. Drawn with preserveAspectRatio="none" so it stretches
  // to fill the flex body and the bars always sit on the bottom baseline (VH).
  const VW = 1000, VH = 300, GAP = 12
  const n = days.length || 14
  const slot = VW / n
  const barW = Math.max(1, slot - GAP)

  const HO_MIN = 6        // min visible HO (blue) height when ho_count > 0
  const ZERO_TICK = 3     // faint flat tick on the baseline for zero days

  // Stacked scale: (ho + ops) mapped into VH. HO stays a thin base because Ops dwarfs it.
  const maxStack = Math.max(1, ...days.map(d => (d.ho_count || 0) + (d.ops_count || 0)))
  const yScale = (v) => (v / maxStack) * VH

  const bars = days.map((d, i) => {
    const x = i * slot + GAP / 2
    const ho = d.ho_count || 0
    const ops = d.ops_count || 0
    const hoH = ho > 0 ? Math.max(yScale(ho), HO_MIN) : 0
    let opsH = ops > 0 ? yScale(ops) : 0
    if (hoH + opsH > VH) opsH = Math.max(0, VH - hoH)   // never eat the HO base
    const hoY  = VH - hoH        // HO is the BOTTOM block — bottom edge on baseline
    const opsY = hoY - opsH      // Ops stacked directly on top
    const isZero = ho === 0 && ops === 0
    return { i, x, ho, ops, opsY, opsH, hoY, hoH, isZero }
  })

  const labelDate = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IE', { day: '2-digit', month: 'short' }) : ''
  const firstLabel = days[0] ? labelDate(days[0].date) : ''
  const midLabel   = days.length ? labelDate(days[Math.floor((days.length - 1) / 2)].date) : ''
  const lastLabel  = days.length ? labelDate(days[days.length - 1].date) : ''

  return (
    <div className="ac-card" style={compact ? { maxWidth: 640 } : undefined}>
      <div className="ac-accent" />

      <div className="ac-head">
        <div className="ac-title">Activity</div>
        <div className="ac-legend">
          <span className="ac-leg"><span className="ac-sw ac-sw-ho" /> HO <b>{fmt(hoTotal)}</b></span>
          <span className="ac-leg"><span className="ac-sw ac-sw-ops" /> Ops <b>{fmt(opsTotal)}</b></span>
        </div>
      </div>

      <div className="ac-body" style={compact ? { height: 150 } : undefined}>
        {loading ? (
          <div className="ac-loading"><span className="spinner spinner-dark" /></div>
        ) : (
          <svg className="ac-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none"
            role="img" aria-label={`Stacked bar chart of activity over the selected period. HO total ${fmt(hoTotal)}, Ops total ${fmt(opsTotal)}.`}>
            <defs>
              {/* HO blue: bright at top, medium blue at bottom — refined, never navy/muddy */}
              <linearGradient id="acHoGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5BA8F5" />
                <stop offset="1" stopColor="#2E78D6" />
              </linearGradient>
              {/* Ops orange: light at top, warm amber at bottom — premium, never burnt/dark */}
              <linearGradient id="acOpsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFB066" />
                <stop offset="1" stopColor="#F2843C" />
              </linearGradient>
            </defs>

            <line x1="0" y1={VH * (1 / 3)} x2={VW} y2={VH * (1 / 3)} className="ac-grid" />
            <line x1="0" y1={VH * (2 / 3)} x2={VW} y2={VH * (2 / 3)} className="ac-grid" />
            <line x1="0" y1={VH} x2={VW} y2={VH} className="ac-baseline" />

            {bars.map((b) => b.isZero ? (
              <rect key={b.i} x={b.x} y={VH - ZERO_TICK} width={barW} height={ZERO_TICK} rx="0" className="ac-zero" />
            ) : (
              <g key={b.i}>
                {/* Ops (orange) stacked ON TOP */}
                {b.ops > 0 && (
                  <rect x={b.x} y={b.opsY} width={barW} height={b.opsH} rx="0" fill="url(#acOpsGrad)" />
                )}
                {/* HO (blue) at the BOTTOM — crisp top edge meets Ops cleanly */}
                {b.ho > 0 && (
                  <rect x={b.x} y={b.hoY} width={barW} height={b.hoH} rx="0" fill="url(#acHoGrad)" />
                )}
              </g>
            ))}
          </svg>
        )}
      </div>

      <div className="ac-axis">
        <span>{firstLabel}</span>
        <span>{midLabel}</span>
        <span>{lastLabel}</span>
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
              <div className="stat-row-label"><strong>{r.name || r.code}</strong></div>
              <div className="stat-row-bar"><span style={{ width: `${(r.count / max) * 100}%` }} /></div>
              <div className="stat-row-val">{r.count}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Donut charts — split into Ops tasks vs Check tasks.
const DONUT_COLORS = ['#0E9A52', '#12A156', '#0A7339', '#3960A8', '#B47F1E', '#C96442', '#7E57C2', '#2D7A4E', '#E07346', '#5DCAA5', '#9A6B12']
const CHECK_CODES  = new Set(['J', 'H', 'K'])

function TaskDonutOps({ rows, loading }) {
  const data = (rows || []).filter(r => r.count > 0 && !CHECK_CODES.has(r.code))
  return <DonutCard title="HO Tasks" data={data} loading={loading} colorOffset={3} />
}

function TaskDonutChecks({ rows, loading }) {
  const data = (rows || []).filter(r => r.count > 0 && CHECK_CODES.has(r.code))
  return <DonutCard title="Operations Task" data={data} loading={loading} colorOffset={0} />
}

function DonutCard({ title, data, loading, colorOffset = 0 }) {
  const total = data.reduce((s, r) => s + r.count, 0)
  const cx = 80, cy = 80, rMid = 50, sw = 20
  const circ = 2 * Math.PI * rMid
  let offset = 0
  const segs = data.map((d, i) => {
    const len = total ? (d.count / total) * circ : 0
    const seg = { ...d, len, off: offset, color: DONUT_COLORS[(colorOffset + i) % DONUT_COLORS.length], pct: total ? Math.round((d.count / total) * 100) : 0 }
    offset += len
    return seg
  })
  return (
    <div className="card">
      <div className="card-header">{title}</div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><span className="spinner spinner-dark" /></div>
        ) : total === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>No records in this range yet.</p></div>
        ) : (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <svg viewBox="0 0 160 160" style={{ width: 130, height: 130, flexShrink: 0 }}>
              <circle cx={cx} cy={cy} r={rMid} fill="none" stroke="var(--border-soft)" strokeWidth={sw} />
              {segs.map(s => (
                <circle key={s.code} cx={cx} cy={cy} r={rMid} fill="none"
                  stroke={s.color} strokeWidth={sw}
                  strokeDasharray={`${s.len} ${circ - s.len}`} strokeDashoffset={-s.off}
                  transform={`rotate(-90 ${cx} ${cy})`} />
              ))}
              <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text)">{total.toLocaleString('en-IE')}</text>
              <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="var(--text-muted)">records</text>
            </svg>
            <div style={{ flex: 1, minWidth: 110 }}>
              {segs.map(s => (
                <div key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', fontSize: 12.5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || s.code}</span>
                  <span style={{ fontWeight: 600 }}>{s.count}</span>
                  <span style={{ color: 'var(--text-muted)', width: 34, textAlign: 'right' }}>{s.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Per-status breakdown with a "% reviewed" headline.
function StatusBreakdown({ totals, loading }) {
  const items = [
    { label: 'Pending review',   value: totals.pending,          color: '#B47F1E' },
    { label: 'HO completed',     value: totals.completed,        color: '#2D7A4E' },
    { label: 'No change needed', value: totals.no_change_needed, color: '#3960A8' },
    { label: 'Store confirmed',  value: totals.store_completed,  color: '#0E9A52' },
  ]
  const total    = Math.max(1, totals.all || items.reduce((s, i) => s + i.value, 0))
  const reviewed = (totals.completed || 0) + (totals.no_change_needed || 0)
  const reviewPct = totals.all ? Math.round((reviewed / totals.all) * 100) : 0
  return (
    <div className="card">
      <div className="card-header">
        Status breakdown
        <span className="chip" style={{ marginLeft: 'auto' }}><span className="chip-dot" /> {reviewPct}% reviewed</span>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><span className="spinner spinner-dark" /></div>
        ) : items.map(i => (
          <div className="stat-row" key={i.label}>
            <div className="stat-row-label">{i.label}</div>
            <div className="stat-row-bar"><span style={{ width: `${Math.round((i.value / total) * 100)}%`, background: i.color }} /></div>
            <div className="stat-row-val">{i.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const TYPE_COLORS = {
  A: '#0E9A52', B: '#12A156', C: '#3960A8', D: '#B47F1E',
  E: '#C96442', F: '#7E57C2', G: '#2D7A4E', H: '#E07346',
  I: '#9A6B12', J: '#0A7339', K: '#5DCAA5',
}

function StoreDonutGrid({ rows, loading, allStores }) {
  // Merge stats rows (stores with records) with the full store list so every
  // store is always shown. Inactive stores appear faded at the end.
  const merged = useMemo(() => {
    if (!allStores.length) return rows
    const statsById = Object.fromEntries((rows || []).map(r => [r.id, r]))
    return allStores.map(s => ({
      id: s.id,
      store_name: s.store_name,
      store_code: s.store_code,
      is_active: s.is_active,
      types: [],
      ...(statsById[s.id] || {})
    })).sort((a, b) => (a.store_code || '').localeCompare(b.store_code || '', undefined, { numeric: true }))
  }, [rows, allStores])

  const display      = allStores.length ? merged : rows
  const activeCount  = display.filter(s => s.is_active !== false).length
  const inactiveCount = display.filter(s => s.is_active === false).length

  // Excel of the by-store data — one row per store, a column per task type in
  // display order, worst-first (matches the chart). Built from data already
  // loaded, so no extra request.
  const exportStores = () => {
    const cols    = ['store_code', 'store_name', ...STORE_BAR_TASKS.map(t => t.code), 'total']
    const headers = ['Store Code', 'Store Name', ...STORE_BAR_TASKS.map(t => t.name), 'Total']
    const exportRows = sortStoresWorstFirst((display || []).map(s => {
      const { byCode, total } = storeCounts(s)
      return { ...s, _byCode: byCode, _total: total }
    })).map(s => {
      const row = { store_code: s.store_code || '', store_name: s.store_name || '' }
      for (const t of STORE_BAR_TASKS) row[t.code] = s._byCode[t.code] || 0
      row.total = s._total
      return row
    })
    const stamp = new Date().toISOString().slice(0, 10)
    downloadExcel(`By store - ${stamp}.xlsx`, exportRows, cols, headers)
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        By store
        <div className="flex-row" style={{ marginLeft: 'auto', gap: 8, alignItems: 'center' }}>
          {!loading && display.length > 0 && (
            <span className="chip">
              <span className="chip-dot" />
              {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}
            </span>
          )}
          {!loading && display.length > 0 && (
            <button className="btn btn-sm btn-outline" onClick={exportStores}>↓ Excel</button>
          )}
        </div>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
        ) : !display.length ? (
          <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>No records in this range yet.</p></div>
        ) : (
          <StoreBarList display={display} />
        )}
      </div>
    </div>
  )
}

// Active stores that have NOT recorded a Department Check (task type J) within
// the selected period. Period-linked automatically: `byStore` comes from the
// same stats fetch, which is scoped by the Today/Week/Month buttons up top.
function StoresMissingDeptCheck({ byStore, allStores, scopeStoreIds, loading }) {
  const doneJ = new Set()
  for (const s of (byStore || [])) {
    if ((s.types || []).some(t => t.code === 'J' && t.count > 0)) doneJ.add(s.id)
  }
  const missing = (allStores || [])
    .filter(s => s.is_active !== false)
    .filter(s => !scopeStoreIds || scopeStoreIds.includes(s.id))
    .filter(s => !doneJ.has(s.id))
    .sort((a, b) => (a.store_code || '').localeCompare(b.store_code || '', undefined, { numeric: true }))

  return (
    <div className="card">
      <div className="card-header">
        No Department Check
        {!loading && <span className="chip" style={{ marginLeft: 'auto' }}><span className="chip-dot" />{missing.length}</span>}
      </div>
      <div className="card-body" style={{ maxHeight: 300, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner spinner-dark" /></div>
        ) : missing.length === 0 ? (
          <div className="empty-state" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>✓ Every store did a Department Check.</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {missing.map(s => (
              <div key={s.id} className="flex-row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.store_name}</span>
                <span className="td-muted" style={{ flexShrink: 0, fontSize: 12 }}>{s.store_code}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// By-store performance bars — one horizontal stacked bar per store, worst
// (fewest transactions) first. Each bar is split by task type in a fixed order,
// coloured per task, with counts shown inside the wider segments (hover any
// segment, or use the Excel export, for exact numbers). Bar length = the
// store's total relative to the busiest store, so under-performers read short.
const STORE_BAR_TASKS = [
  { code: 'J', name: 'Department Check',      color: '#2E78D6' },
  { code: 'K', name: 'Price Check',           color: '#17A2B8' },
  { code: 'H', name: 'Stock Count',           color: '#3E9F4B' },
  { code: 'B', name: 'Non-Scans',             color: '#F2843C' },
  { code: 'C', name: 'Wrong Prices',          color: '#E0518D' },
  { code: 'D', name: 'Wrong Description',      color: '#7C5CBF' },
  { code: 'G', name: 'Promotion Error',       color: '#E0A03A' },
  { code: 'A', name: 'UOM Errors',            color: '#D14B3D' },
  { code: 'E', name: 'Price Marked Products', color: '#4C6EF5' },
  { code: 'F', name: 'DRS Errors',            color: '#8A6D3B' },
  { code: 'I', name: 'Miscellaneous',         color: '#8896A5' },
]

// A store's per-task-type counts (keyed by code) + total across those tasks.
function storeCounts(store) {
  const byCode = {}
  for (const t of (store.types || [])) byCode[t.code] = (byCode[t.code] || 0) + t.count
  const total = STORE_BAR_TASKS.reduce((a, t) => a + (byCode[t.code] || 0), 0)
  return { byCode, total }
}

// Chart + export order: active stores worst-first (fewest transactions),
// inactive stores last. Rows must already carry a numeric `_total`.
function sortStoresWorstFirst(rows) {
  return rows.slice().sort((a, b) => {
    const ai = a.is_active === false, bi = b.is_active === false
    if (ai !== bi) return ai ? 1 : -1
    return a._total - b._total
  })
}

function StoreBarList({ display }) {
  const rows = sortStoresWorstFirst((display || []).map(s => {
    const { byCode, total } = storeCounts(s)
    return { ...s, _byCode: byCode, _total: total }
  }))
  const maxTotal = Math.max(1, ...rows.map(r => r._total))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'flex-end', marginBottom: 12, fontSize: 11.5, color: 'var(--text-muted)' }}>
        {STORE_BAR_TASKS.map(t => (
          <span key={t.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: t.color, flexShrink: 0 }} /> {t.name}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(s => <StoreBarRow key={s.id} store={s} maxTotal={maxTotal} />)}
      </div>
    </div>
  )
}

function StoreBarRow({ store, maxTotal }) {
  const inactive = store.is_active === false
  const byCode = store._byCode, total = store._total
  return (
    <div style={{ opacity: inactive ? 0.5 : 1 }}>
      <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: 1, gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {store.store_name}{inactive && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (inactive)</span>}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {total} total
        </span>
      </div>
      <div style={{ height: 18, borderRadius: 999, background: 'var(--bg-soft, #E9ECF1)', overflow: 'hidden', display: 'flex' }}>
        {STORE_BAR_TASKS.map(t => {
          const c = byCode[t.code] || 0
          if (!c) return null
          const share = c / maxTotal
          return (
            <div key={t.code} title={`${t.name}: ${c}`} style={{
              width: `${share * 100}%`, background: t.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden'
            }}>{share >= 0.06 ? c : ''}</div>
          )
        })}
      </div>
    </div>
  )
}

function StoreDualDonut({ store, inactive }) {
  const hoTypes  = (store.types || []).filter(t => !CHECK_CODES.has(t.code))
  const opsTypes = (store.types || []).filter(t =>  CHECK_CODES.has(t.code))
  const hoTotal  = hoTypes.reduce((s, t) => s + t.count, 0)
  const opsTotal = opsTypes.reduce((s, t) => s + t.count, 0)
  return (
    <div className={`store-donut-card${inactive ? ' inactive' : ''}`} style={{
      borderRadius: 12,
      background: 'var(--glass-strong)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      opacity: inactive ? 0.42 : 1,
      filter: inactive ? 'grayscale(70%)' : 'none',
    }}>
      <div style={{
        padding: '7px 10px',
        borderBottom: '1px solid var(--border-soft)',
        background: inactive
          ? 'var(--bg-soft)'
          : 'linear-gradient(135deg, var(--hs-head-1) 0%, var(--hs-head-2) 100%)',
        fontSize: 11.5, fontWeight: 600,
        color: inactive ? 'var(--text-muted)' : 'var(--hs-green-dark)',
        textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {store.store_name}
        {inactive && <span style={{ fontWeight: 400, fontSize: 9.5, marginLeft: 4, opacity: 0.8 }}>(inactive)</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: '12px 10px' }}>
        <MiniDonutSvg types={hoTypes}  total={hoTotal}  label="HO" />
        <MiniDonutSvg types={opsTypes} total={opsTotal} label="Ops" />
      </div>
    </div>
  )
}

function MiniDonutSvg({ types, total, label }) {
  const cx = 42, cy = 42, r = 30, sw = 11
  const circ = 2 * Math.PI * r
  let offset = 0
  const segs = types.map(t => {
    const len = total ? (t.count / total) * circ : 0
    const seg = { ...t, len, off: offset, color: TYPE_COLORS[t.code] || '#8C8779' }
    offset += len
    return seg
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}
      title={types.map(t => `${t.name || t.code}: ${t.count}`).join('\n')}>
      <svg viewBox="0 0 84 84" style={{ width: 78, height: 78 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={sw} />
        {total > 0 && segs.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={sw}
            strokeDasharray={`${s.len} ${circ - s.len}`}
            strokeDashoffset={-s.off}
            transform={`rotate(-90 ${cx} ${cy})`} />
        ))}
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text)">{total}</text>
      </svg>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
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
              <div style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--primary-tint)', color: 'var(--primary-dark)', fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{TASK_FORMS[r.task_type]?.name || r.task_type}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.product || '—'} {isBO && r.store_name && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>· {r.store_name}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
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
