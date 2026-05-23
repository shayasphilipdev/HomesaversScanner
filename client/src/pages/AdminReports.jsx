import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  adminListStores, adminListAreas, adminListUsers,
  adminListLookups, adminListTemplates,
  adminListActivity, getTaskRecords
} from '../lib/api.js'
import AdminNav from '../components/AdminNav.jsx'
import { useToast } from '../components/Toast.jsx'
import MultiSelectDropdown from '../components/forms/MultiSelectDropdown.jsx'
import { canAccessAdmin } from '../lib/roles.js'

// One page · 8 sub-tabs · same shape per tab:
//   filters → table → "↓ CSV" → optional stats tile.
// CSV is generated client-side from the loaded rows.

const TABS = [
  { key: 'employees', label: 'Employees' },
  { key: 'activity',  label: 'Activity' },
  { key: 'stores',    label: 'Stores' },
  { key: 'areas',     label: 'Areas' },
  { key: 'templates', label: 'Task templates' },
  { key: 'lookups',   label: 'Lookups' }
]

export default function AdminReports() {
  const { session } = useStore()
  const [tab, setTab] = useState('employees')

  if (!canAccessAdmin(session)) {
    return <div className="card"><div className="empty-state"><p>Admin-only page.</p></div></div>
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Admin Reports</div>
          <div className="page-subtitle">Full visibility into the master tables behind every admin page.</div>
        </div>
      </div>

      <AdminNav />

      <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'employees' && <EmployeesReport />}
      {tab === 'activity'  && <ActivityReport />}
      {tab === 'stores'    && <StoresReport />}
      {tab === 'areas'     && <AreasReport />}
      {tab === 'templates' && <TemplatesReport />}
      {tab === 'lookups'   && <LookupsReport />}
    </div>
  )
}

// ── Shared utilities ──────────────────────────────────────────────────
const csvEscape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
function downloadCSV(name, columns, rows) {
  const header = columns.map(c => csvEscape(c.label)).join(',')
  const body   = rows.map(r => columns.map(c => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')).join('\n')
  const blob   = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(a.href)
}

function ReportShell({ title, filters, columns, rows, loading, error, csvName, stats }) {
  return (
    <>
      {stats && <div className="card" style={{ marginBottom: 12 }}><div className="card-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '10px 14px' }}>{stats}</div></div>}

      {filters && <div className="card" style={{ marginBottom: 12 }}><div className="card-body"><div className="filter-row" style={{ marginBottom: 0 }}>
        {filters}
        <div className="filter-actions">
          <button className="btn btn-sm btn-outline" onClick={() => downloadCSV(csvName, columns, rows)} disabled={!rows.length}>↓ CSV</button>
        </div>
      </div></div></div>}

      {error && <div className="login-error mt-12">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !rows.length ? (
        <div className="card"><div className="empty-state"><p>No rows match the filters.</p></div></div>
      ) : (
        <div className="card">
          <div className="card-header">{title} · {rows.length.toLocaleString('en-IE')} row{rows.length === 1 ? '' : 's'}</div>
          <div className="table-wrap">
            <table>
              <thead><tr>{columns.map(c => <th key={c.key} className={c.right ? 'td-right' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id || i}>
                    {columns.map(c => <td key={c.key} className={c.right ? 'td-right' : ''}>{c.render ? c.render(r) : (typeof c.get === 'function' ? c.get(r) : r[c.key]) || <span className="td-muted">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

const Stat = ({ label, value }) => (
  <div><div className="kpi-label" style={{ fontSize: 11 }}>{label}</div><div style={{ fontWeight: 700, fontSize: 18 }}>{value}</div></div>
)

// ── Employees ─────────────────────────────────────────────────────────
function EmployeesReport() {
  const [data, setData]   = useState([])
  const [stores, setStores] = useState([])
  const [areas,  setAreas]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [roles, setRoles] = useState([])
  const [active, setActive] = useState(['active'])  // 'active' | 'inactive'

  useEffect(() => { (async () => {
    setLoading(true); setError('')
    try {
      const [u, s, a] = await Promise.all([adminListUsers(), adminListStores(), adminListAreas()])
      setData(u); setStores(s); setAreas(a)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  })() }, [])

  const nameStores = (ids = []) => ids.map(id => stores.find(s => s.id === id)?.store_code).filter(Boolean).join(', ')
  const nameAreas  = (ids = []) => ids.map(id => areas .find(s => s.id === id)?.area_name ).filter(Boolean).join(', ')
  const scopeOf = (u) => u.all_stores ? 'All stores'
    : u.area_ids?.length  ? `Areas: ${nameAreas(u.area_ids)}`
    : u.store_ids?.length ? `Stores: ${nameStores(u.store_ids)}`
    : '—'

  const rows = useMemo(() => data.filter(u => {
    if (roles.length && !roles.includes(u.role)) return false
    if (active.length === 1 && active[0] === 'active'   && !u.is_active) return false
    if (active.length === 1 && active[0] === 'inactive' &&  u.is_active) return false
    return true
  }), [data, roles, active])

  const roleOptions = useMemo(() => Array.from(new Set(data.map(u => u.role))).sort().map(r => ({ id: r, label: r })), [data])

  const columns = [
    { key: 'username',      label: 'Username' },
    { key: 'display_name',  label: 'Name' },
    { key: 'role',          label: 'Role' },
    { key: 'scope',         label: 'Scope', get: u => scopeOf(u) },
    { key: 'ho',            label: 'HO',     get: u => u.can_access_hq_tasks    !== false ? 'yes' : 'no' },
    { key: 'st',            label: 'Store',  get: u => u.can_access_store_tasks !== false ? 'yes' : 'no' },
    { key: 'email',         label: 'Email' },
    { key: 'phone',         label: 'Phone' },
    { key: 'department',    label: 'Dept' },
    { key: 'employee_code', label: 'Empl code' },
    { key: 'start_date',    label: 'Start',     get: u => u.start_date || '' },
    { key: 'is_active',     label: 'Active',    get: u => u.is_active ? 'yes' : 'no' },
    { key: 'created_at',    label: 'Created',   get: u => (u.created_at || '').slice(0, 10) }
  ]

  return (
    <ReportShell
      title="Employees"
      csvName="employees"
      loading={loading} error={error} rows={rows} columns={columns}
      stats={<>
        <Stat label="Total"       value={data.length} />
        <Stat label="Active"      value={data.filter(u => u.is_active).length} />
        <Stat label="Roles"       value={roleOptions.length} />
        <Stat label="All-stores"  value={data.filter(u => u.all_stores).length} />
      </>}
      filters={<>
        <div className="filter-field filter-field--wide">
          <label>Role</label>
          <MultiSelectDropdown value={roles} onChange={setRoles} options={roleOptions} placeholder="All roles" />
        </div>
        <div className="filter-field">
          <label>Status</label>
          <MultiSelectDropdown single value={active} onChange={setActive}
            options={[{ id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }]}
            placeholder="Any" />
        </div>
      </>}
    />
  )
}

// ── Activity (audit ledger) ───────────────────────────────────────────
function ActivityReport() {
  const today    = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(monthAgo)
  const [to,   setTo]   = useState(today)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)

  const load = async (offset = 0, append = false) => {
    setLoading(true); setError('')
    try {
      const res = await adminListActivity({ from: from + 'T00:00:00Z', to: to + 'T23:59:59Z', limit: 500, offset })
      const next = append ? [...data, ...(res.events || [])] : (res.events || [])
      setData(next); setHasMore(!!res.has_more)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load(0, false) /* eslint-disable-next-line */ }, [])

  const userCounts = useMemo(() => {
    const m = {}; for (const e of data) m[e.by_user_name] = (m[e.by_user_name] || 0) + 1
    return Object.entries(m).sort((a,b) => b[1] - a[1])
  }, [data])

  const columns = [
    { key: 'at',           label: 'When',      get: e => new Date(e.at).toLocaleString('en-IE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) },
    { key: 'by_user_name', label: 'Who' },
    { key: 'from_status',  label: 'From' },
    { key: 'to_status',    label: 'To' },
    { key: 'record_id',    label: 'Record',    render: e => <code style={{ fontSize: 11 }}>{e.record_id.slice(0,8)}…</code> },
    { key: 'note',         label: 'Note' }
  ]

  return (
    <ReportShell
      title="Activity"
      csvName="activity"
      loading={loading} error={error} rows={data} columns={columns}
      stats={<>
        <Stat label="Events shown" value={data.length} />
        <Stat label="Distinct users" value={userCounts.length} />
        <Stat label="Most active" value={userCounts[0]?.[0] || '—'} />
      </>}
      filters={<>
        <div className="filter-field"><label>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="filter-field"><label>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="filter-field">
          <label>&nbsp;</label>
          <button className="btn btn-sm btn-primary" onClick={() => load(0, false)} disabled={loading}>Run</button>
        </div>
        {hasMore && (
          <div className="filter-field">
            <label>&nbsp;</label>
            <button className="btn btn-sm btn-outline" onClick={() => load(data.length, true)} disabled={loading}>Load more</button>
          </div>
        )}
      </>}
    />
  )
}


// ── Stores ────────────────────────────────────────────────────────────
function StoresReport() {
  const [data, setData] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [areaIds, setAreaIds] = useState([])
  const [active, setActive] = useState(['active'])

  useEffect(() => { (async () => {
    setLoading(true); setError('')
    try {
      const [s, a] = await Promise.all([adminListStores(), adminListAreas()])
      setData(s); setAreas(a)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  })() }, [])

  const areaName = (id) => areas.find(a => a.id === id)?.area_name || '—'
  const rows = useMemo(() => data.filter(s => {
    if (areaIds.length && !areaIds.includes(s.area_id)) return false
    if (active.length === 1 && active[0] === 'active'   && !s.is_active) return false
    if (active.length === 1 && active[0] === 'inactive' &&  s.is_active) return false
    return true
  }), [data, areaIds, active])

  const columns = [
    { key: 'store_code', label: 'Code' },
    { key: 'store_name', label: 'Name' },
    { key: 'area_id',    label: 'Area',    get: s => areaName(s.area_id) },
    { key: 'is_active',  label: 'Active',  get: s => s.is_active ? 'yes' : 'no' },
    { key: 'created_at', label: 'Created', get: s => (s.created_at || '').slice(0, 10) }
  ]

  return (
    <ReportShell
      title="Stores" csvName="stores"
      loading={loading} error={error} rows={rows} columns={columns}
      stats={<>
        <Stat label="Total"  value={data.length} />
        <Stat label="Active" value={data.filter(s => s.is_active).length} />
        <Stat label="Areas covered" value={new Set(data.map(s => s.area_id)).size} />
      </>}
      filters={<>
        <div className="filter-field filter-field--wide">
          <label>Area</label>
          <MultiSelectDropdown value={areaIds} onChange={setAreaIds}
            options={areas.map(a => ({ id: a.id, label: a.area_name }))} placeholder="All areas" />
        </div>
        <div className="filter-field">
          <label>Status</label>
          <MultiSelectDropdown single value={active} onChange={setActive}
            options={[{ id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }]} placeholder="Any" />
        </div>
      </>}
    />
  )
}

// ── Areas ─────────────────────────────────────────────────────────────
function AreasReport() {
  const [data, setData] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    setLoading(true); setError('')
    try {
      const [a, s] = await Promise.all([adminListAreas(), adminListStores()])
      setData(a); setStores(s)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  })() }, [])

  const storeCount = (areaId) => stores.filter(s => s.area_id === areaId && s.is_active).length

  const columns = [
    { key: 'area_code',   label: 'Code' },
    { key: 'area_name',   label: 'Name' },
    { key: 'stores',      label: 'Stores', right: true, get: a => storeCount(a.id) },
    { key: 'is_active',   label: 'Active', get: a => a.is_active ? 'yes' : 'no' },
    { key: 'created_at',  label: 'Created', get: a => (a.created_at || '').slice(0, 10) }
  ]

  return (
    <ReportShell
      title="Areas" csvName="areas"
      loading={loading} error={error} rows={data} columns={columns}
      stats={<>
        <Stat label="Total areas" value={data.length} />
        <Stat label="Active"      value={data.filter(a => a.is_active).length} />
        <Stat label="Biggest" value={data.map(a => ({ name: a.area_name, n: storeCount(a.id) })).sort((x,y) => y.n - x.n)[0]?.name || '—'} />
      </>}
    />
  )
}

// ── Task templates ────────────────────────────────────────────────────
function TemplatesReport() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [freq, setFreq] = useState([])
  const [active, setActive] = useState(['active'])

  useEffect(() => { (async () => {
    setLoading(true); setError('')
    try { setData(await adminListTemplates()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  })() }, [])

  const rows = useMemo(() => data.filter(t => {
    if (freq.length && !freq.includes(t.frequency)) return false
    if (active.length === 1 && active[0] === 'active'   && !t.is_active) return false
    if (active.length === 1 && active[0] === 'inactive' &&  t.is_active) return false
    return true
  }), [data, freq, active])

  const freqOptions = ['daily','weekly','monthly','yearly','once_off'].map(f => ({ id: f, label: f }))

  const columns = [
    { key: 'title',            label: 'Title' },
    { key: 'category',         label: 'Category' },
    { key: 'frequency',        label: 'Frequency' },
    { key: 'applies_to',       label: 'Scope' },
    { key: 'assigned_to_role', label: 'Role' },
    { key: 'blocks',           label: 'Blocks', right: true, get: t => (t.blocks || []).length },
    { key: 'is_active',        label: 'Active', get: t => t.is_active ? 'yes' : 'no' },
    { key: 'updated_at',       label: 'Updated', get: t => (t.updated_at || '').slice(0, 10) }
  ]

  return (
    <ReportShell
      title="Task templates" csvName="task-templates"
      loading={loading} error={error} rows={rows} columns={columns}
      stats={<>
        <Stat label="Total"  value={data.length} />
        <Stat label="Active" value={data.filter(t => t.is_active).length} />
      </>}
      filters={<>
        <div className="filter-field filter-field--wide">
          <label>Frequency</label>
          <MultiSelectDropdown value={freq} onChange={setFreq} options={freqOptions} placeholder="Any" />
        </div>
        <div className="filter-field">
          <label>Status</label>
          <MultiSelectDropdown single value={active} onChange={setActive}
            options={[{ id: 'active', label: 'Active' }, { id: 'inactive', label: 'Inactive' }]} placeholder="Any" />
        </div>
      </>}
    />
  )
}

// ── Lookups ───────────────────────────────────────────────────────────
function LookupsReport() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kinds, setKinds] = useState([])

  useEffect(() => { (async () => {
    setLoading(true); setError('')
    try { setData(await adminListLookups()) } catch (e) { setError(e.message) } finally { setLoading(false) }
  })() }, [])

  const kindOptions = useMemo(() => Array.from(new Set(data.map(l => l.kind))).sort().map(k => ({ id: k, label: k })), [data])
  const rows = useMemo(() => data.filter(l => !kinds.length || kinds.includes(l.kind)), [data, kinds])

  const columns = [
    { key: 'kind',       label: 'Kind' },
    { key: 'label',      label: 'Label' },
    { key: 'sort_order', label: 'Order', right: true },
    { key: 'task_types', label: 'Task types', get: l => (l.task_types || []).join(', ') },
    { key: 'is_active',  label: 'Active', get: l => l.is_active ? 'yes' : 'no' }
  ]

  return (
    <ReportShell
      title="Lookups" csvName="lookups"
      loading={loading} error={error} rows={rows} columns={columns}
      stats={<>
        <Stat label="Total"    value={data.length} />
        <Stat label="Distinct kinds" value={kindOptions.length} />
      </>}
      filters={<>
        <div className="filter-field filter-field--wide">
          <label>Kind</label>
          <MultiSelectDropdown value={kinds} onChange={setKinds} options={kindOptions} placeholder="All kinds" />
        </div>
      </>}
    />
  )
}
