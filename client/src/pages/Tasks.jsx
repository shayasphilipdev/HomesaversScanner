import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../App.jsx'
import { getTaskRecords, getTaskTypes } from '../lib/api.js'
import TaskTypePicker from '../components/TaskTypePicker.jsx'
import TaskForm from '../components/TaskForm.jsx'
import TaskRecordList from '../components/TaskRecordList.jsx'

export default function Tasks() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [taskTypes, setTaskTypes] = useState([])
  const [selectedType, setSelectedType] = useState(null)
  const [filter, setFilter] = useState('all')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTaskTypes()
      .then(rows => {
        setTaskTypes(rows)
        // Default selection: first daily, first available type
        const first = rows.find(t => t.frequency === 'daily') || rows[0]
        if (first && !selectedType) setSelectedType(first.code)
      })
      .catch(() => setTaskTypes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getTaskRecords({
        storeId:  session.storeId,
        taskType: selectedType,
        status:   filter !== 'all' ? filter : undefined
      })
      setRecords(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [session, selectedType, filter])

  useEffect(() => { if (selectedType) load() }, [load, selectedType])

  const filterCounts = {
    all:             records.length,
    pending:         records.filter(r => r.status === 'pending').length,
    completed:       records.filter(r => r.status === 'completed').length,
    store_completed: records.filter(r => r.status === 'store_completed').length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Tasks</div>
          <div className="page-subtitle">
            {isBO ? 'All stores' : session.storeName} · {records.length} record{records.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      <TaskTypePicker taskTypes={taskTypes} selected={selectedType} onSelect={setSelectedType} />

      {selectedType && !isBO && <TaskForm taskType={selectedType} onSaved={load} />}

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
              borderRadius: 20, padding: '0 7px', fontSize: 11
            }}>
              {filterCounts[tab.key]}
            </span>
          </button>
        ))}

        <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={load}>
          ↻ Refresh
        </button>
      </div>

      <TaskRecordList records={records} loading={loading} onRefresh={load} />
    </div>
  )
}
