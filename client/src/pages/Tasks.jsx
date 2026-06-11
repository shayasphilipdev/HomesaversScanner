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
import { failedCount } from '../lib/outbox.js'

export default function Tasks() {
  const { session } = useStore()
  const toast = useToast()
  const { currentStoreId } = useCurrentStore()
  const [outboxFailed, setOutboxFailed] = useState(0)

  // M14: show a persistent warning when records are stuck in the failed outbox.
  useEffect(() => {
    const check = () => failedCount().then(setOutboxFailed).catch(() => {})
    check()
    window.addEventListener('hs:outbox-changed', check)
    return () => window.removeEventListener('hs:outbox-changed', check)
  }, [])
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
        // Store users default to Department Check (J); back office defaults to
        // the first daily task type, then whatever is first.
        const first = !isBO
          ? (rows.find(t => t.code === 'J') || rows.find(t => t.frequency === 'daily') || rows[0])
          : (rows.find(t => t.frequency === 'daily') || rows[0])
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
        status:   filter !== 'all' ? filter : undefined,
        limit:    500   // a store + task-type pair is normally tiny; one page is plenty
      })
      // Backend returns { records, total, ... }; older responses were a bare
      // array, so tolerate both for a clean rolling deploy.
      setRecords(Array.isArray(data) ? data : (data?.records || []))
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
      {/* M14: failed outbox warning — visible until the user goes to Sync and resolves them */}
      {outboxFailed > 0 && (
        <div style={{
          background: '#FFF3CD', border: '1px solid #E0A03A', borderRadius: 8,
          padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center'
        }}>
          <span>⚠️</span>
          <span style={{ flex: 1, fontSize: 13 }}>
            <strong>{outboxFailed} record{outboxFailed !== 1 ? 's' : ''} failed to sync</strong> and need attention.{' '}
            <a href="/sync" style={{ color: 'var(--primary-dark)', fontWeight: 600 }}>Go to Sync →</a>
          </span>
        </div>
      )}

      {/* Compact top: store name (left) + small title, so the form fields
          sit high on a phone screen instead of below the fold. */}
      <CurrentStorePicker subject="task" />

      <div className="flex-row" style={{ alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div className="page-title" style={{ fontSize: 22 }}>HO Tasks</div>
        <span className="note" style={{ fontSize: 12 }}>
          {records.length} record{records.length !== 1 ? 's' : ''}
        </span>
      </div>

      <TaskTypePicker taskTypes={taskTypes} selected={selectedType} onSelect={setSelectedType} />

      {selectedType && !isBO && currentStoreId && (
        <TaskForm
          taskType={selectedType}
          storeId={currentStoreId}
          onSaved={(info) => {
            if (info?.queued) toast.info("Saved offline — will sync when you're back online.")
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

      {/* Quick guide moved to the bottom — reference material, not something
          that should push the scan field down the screen. */}
      <div style={{ marginTop: 20 }}>
        <HoTasksHelp />
      </div>
    </div>
  )
}
