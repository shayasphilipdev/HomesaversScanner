import { useState, useEffect } from 'react'
import { useStore } from '../App.jsx'
import { getStores, getTaskTypes, getToken } from '../lib/api.js'

function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Reports() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const now      = new Date()
  const monthAgo = new Date(now.getTime() - 30 * 86400000)
  monthAgo.setHours(0, 0, 0, 0)

  const [from, setFrom]               = useState(toLocalInput(monthAgo))
  const [to, setTo]                   = useState(toLocalInput(now))
  const [storeFilter, setStoreFilter] = useState(isBO ? 'all' : session.storeId)
  const [taskFilter, setTaskFilter]   = useState('all')
  const [stores, setStores]           = useState([])
  const [taskTypes, setTaskTypes]     = useState([])
  const [downloading, setDownloading] = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    getTaskTypes().then(setTaskTypes).catch(() => setTaskTypes([]))
    if (isBO) getStores().then(setStores).catch(e => setError('Could not load stores: ' + e.message))
  }, [isBO])

  const downloadCSV = async () => {
    setDownloading(true); setError('')
    try {
      const params = new URLSearchParams({ from, to, storeId: storeFilter, task_type: taskFilter })
      const res = await fetch(`/api/reports/task-records?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const blob = await res.blob()
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      const taskLabel = taskFilter === 'all' ? 'all' : taskFilter
      a.download = `task-records-${taskLabel}-${from.slice(0,10)}-to-${to.slice(0,10)}.csv`
      document.body.appendChild(a)
      a.click(); a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">Download task records as CSV — filter by store, task type and date range</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Task Records Report</div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-group">
              <label>From (date &amp; time)</label>
              <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label>To (date &amp; time)</label>
              <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
            </div>

            {isBO && (
              <div className="form-group">
                <label>Store</label>
                <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
                  <option value="all">All stores</option>
                  {stores.filter(s => s.is_active).map(s => (
                    <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label>Task Type</label>
              <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)}>
                <option value="all">All task types</option>
                {taskTypes.map(t => (
                  <option key={t.code} value={t.code}>{t.code} — {t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <div className="login-error mt-12">{error}</div>}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-primary" onClick={downloadCSV} disabled={downloading}>
              {downloading ? <><span className="spinner" /> Preparing…</> : '↓ Download CSV'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
