import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../App.jsx'
import { getTaskRecords, getTaskTypes } from '../lib/api.js'
import { useCurrentStore } from '../lib/currentStore.jsx'
import TaskTypePicker from '../components/TaskTypePicker.jsx'
import TaskForm from '../components/TaskForm.jsx'
import TaskRecordList from '../components/TaskRecordList.jsx'
import CurrentStorePicker from '../components/CurrentStorePicker.jsx'
import HoTasksHelp from '../components/HoTasksHelp.jsx'
import { useToast } from '../components/Toast.jsx'

export default function Tasks() {
  const { session } = useStore()
  const toast = useToast()
  const { currentStoreId } = useCurrentStore()
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
        storeId:  currentStoreId,
        taskType: selectedType,
        status:   filter !== 'all' ? filter : undefined
      })
      setRecords(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [currentStoreId, selectedType, filter])

  useEffect(() => { if (selectedType && currentStoreId) load() }, [load, selectedType, currentStoreId])

  const filterCounts = {
    all:              records.length,
    pending:          records.filter(r => r.status === 'pending').length,
    completed:        records.filter(r => r.status === 'completed').length,
    no_change_needed: records.filter(r => r.status === 'no_change_needed').length,
    store_completed:  records.filter(r => r.status === 'store_completed').length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">HO Tasks</div>
          <div className="page-subtitle">
            {records.length} record{records.length !== 1 ? 's' : ''} shown
          </div>
        </div>
      </div>

      <HoTasksHelp />

      <CurrentStorePicker subject="task" />

      <TaskTypePicker taskTypes={taskTypes} selected={selectedType} onSelect={setSelectedType} />

      {selectedType && !isBO && currentStoreId && (
        <TaskForm
          taskType={selectedType}
          storeId={currentStoreId}
          onSaved={(info) => {
            if (info?.queued) toast.info('Saved offline — will sync when you’re back online.')
            else              toast.success('Record saved.')
            load()
          }}
        />
      )}

      {selectedType && !isBO && !currentStoreId && (
        <div className="card mb-12"><div className="card-body" style={{ padding: 14 }}>
          <span className="note">Pick a store at the top of the page before recording.</span>
        </div></div>
      )}

      <div className="flex-row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 6 }}>
        {[
          { key: 'all',              label: 'All' },
          { key: 'pending',          label: 'Pending' },
          { key: 'completed',        label: 'HO completed' },
          { key: 'no_change_needed', label: 'No change needed' },
          { key: 'store_completed',  label: 'Store confirmed' },
        ].map(tab => (
          <button
            key={tab.key}
            className={`btn btn-sm ${filter === tab.key ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            <span style={{
              marginLeft: 4,
              background: filter === tab.key ? 'rgba(255,255,255,.22)' : 'var(--bg-soft)',
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

      <TaskRecordList
        records={records}
        loading={loading}
        onRefresh={load}
        onOptimisticRemove={(id) => setRecords(rs => rs.filter(r => r.id !== id))}
      />
    </div>
  )
}
