import { useState } from 'react'
import { useStore } from '../App.jsx'

export default function Reports() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const today = new Date().toISOString().split('T')[0]
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [storeFilter, setStoreFilter] = useState(isBO ? 'all' : session.storeId)

  const downloadCSV = async () => {
    const params = new URLSearchParams({
      from,
      to,
      storeId: storeFilter,
      mode: session.mode,
      format: 'csv'
    })
    const url = `/api/reports/product-records?${params}`
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `product-records-${from}-to-${to}.csv`
    a.click()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">Download product records for a date range</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Product Records Report</div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-group">
              <label>From date</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label>To date</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>

          {isBO && (
            <div className="form-group mt-12">
              <label>Store</label>
              <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
                <option value="all">All stores</option>
              </select>
            </div>
          )}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-primary" onClick={downloadCSV}>
              ↓ Download CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
