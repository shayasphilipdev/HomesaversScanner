import { useState, useEffect, useCallback } from 'react'
import { getProductRecords } from '../lib/api.js'
import { useStore } from '../App.jsx'
import ProductForm from '../components/ProductForm.jsx'
import ProductList from '../components/ProductList.jsx'

export default function ProductData() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')  // all | pending | completed | store_completed

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getProductRecords({
        storeId: session.storeId,
        filters: filter !== 'all' ? { status: filter } : {}
      })
      setRecords(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [session, filter])

  useEffect(() => { load() }, [load])

  const filterCounts = {
    all:             records.length,
    pending:         records.filter(r => r.status === 'pending').length,
    completed:       records.filter(r => r.status === 'completed').length,
    store_completed: records.filter(r => r.status === 'store_completed').length,
  }

  const displayed = filter === 'all' ? records : records.filter(r => r.status === filter)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Product Data</div>
          <div className="page-subtitle">
            {isBO ? 'All stores' : session.storeName} · {records.length} record{records.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Only store users and back office in store context can add records */}
      {!isBO && <ProductForm onSaved={load} />}

      {/* Filter tabs */}
      <div className="flex-row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 6 }}>
        {[
          { key: 'all',             label: 'All' },
          { key: 'pending',         label: 'Pending' },
          { key: 'completed',       label: 'HQ completed' },
          { key: 'store_completed', label: 'Store confirmed' },
        ].map(tab => (
          <button
            key={tab.key}
            className={`btn btn-sm ${filter === tab.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            <span style={{
              marginLeft: 4,
              background: filter === tab.key ? 'rgba(255,255,255,.25)' : 'var(--gray-200)',
              color: filter === tab.key ? '#fff' : 'var(--text-muted)',
              borderRadius: 20,
              padding: '0 7px',
              fontSize: 11
            }}>
              {filterCounts[tab.key]}
            </span>
          </button>
        ))}

        <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={load}>
          ↻ Refresh
        </button>
      </div>

      <ProductList records={displayed} loading={loading} onRefresh={load} />
    </div>
  )
}
