import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { getAwaitingReplyThreads, resolveRecordMessages } from '../lib/api.js'
import { TASK_FORMS } from '../lib/taskTypes.js'
import { useToast } from '../components/Toast.jsx'
import AgeClock from '../components/AgeClock.jsx'

// Every open task-record conversation, oldest last-message first. A thread's
// "whose turn" is derived server-side from who sent the last message (see
// awaiting_reply_threads() in supabase-migration-awaiting-reply.sql) — there
// is no separate read/unread bookkeeping to get right here, just: did the
// other side speak last, and how long ago.
//
// Same screen for HQ and store logins. Scope is enforced server-side exactly
// like every other /task-messages/* endpoint, so a store only ever sees its
// own records here; back office sees everything it's allowed to see.
export default function AwaitingReply() {
  const { session } = useStore()
  const navigate = useNavigate()
  const toast = useToast()
  const mySide = session.mode === 'backoffice' ? 'bo' : 'store'

  const [threads, setThreads]   = useState(null)
  const [error, setError]       = useState('')
  const [filter, setFilter]     = useState('mine') // 'mine' | 'all'
  const [busyId, setBusyId]     = useState(null)

  const load = () => {
    setError('')
    getAwaitingReplyThreads()
      // Oldest-waiting first is the point of this screen — sort here too
      // rather than trusting the RPC's ORDER BY alone, so a future change
      // on the server side can't silently break the one thing this page
      // promises.
      .then(d => setThreads([...(d?.threads || [])].sort(
        (a, b) => String(a.last_message_at || '').localeCompare(String(b.last_message_at || ''))
      )))
      .catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [])

  const mineCount = useMemo(
    () => (threads || []).filter(t => t.waiting_on === mySide).length,
    [threads, mySide]
  )
  const visible = useMemo(() => {
    if (!threads) return []
    return filter === 'mine' ? threads.filter(t => t.waiting_on === mySide) : threads
  }, [threads, filter, mySide])

  const openThread = (t) => {
    // Same deep-link the header message dropdown uses — jumps to /tasks,
    // switches to the record's store, and auto-expands its thread.
    navigate('/tasks', { state: { openRecordId: t.record_id, taskType: t.task_type, storeId: t.store_id } })
  }

  const resolve = async (e, t) => {
    e.stopPropagation()
    setBusyId(t.record_id)
    try {
      await resolveRecordMessages(t.record_id, true)
      setThreads(prev => prev.filter(x => x.record_id !== t.record_id))
      toast.success('Marked resolved.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Awaiting Reply</div>
          <div className="page-subtitle">Open conversations on product records, oldest first</div>
        </div>
        <div className="flex-row" style={{ gap: 6 }}>
          <button className={`btn btn-sm ${filter === 'mine' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('mine')}>
            My turn{threads ? ` (${mineCount})` : ''}
          </button>
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter('all')}>
            All open{threads ? ` (${threads.length})` : ''}
          </button>
        </div>
      </div>

      {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}
      {threads === null && !error && <div className="note">Loading…</div>}

      {threads !== null && visible.length === 0 && !error && (
        <div className="card" style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 26 }}>✅</div>
          <div className="note" style={{ marginTop: 6 }}>
            {filter === 'mine' ? "Nothing waiting on you." : 'No open conversations.'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(t => {
          const myTurn = t.waiting_on === mySide
          return (
            <div
              key={t.record_id}
              className="card"
              style={{ padding: 12, cursor: 'pointer' }}
              onClick={() => openThread(t)}
            >
              <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="chip" style={{ fontWeight: 700, color: myTurn ? 'var(--amber)' : 'var(--text-muted)' }}>
                      {t.waiting_on === 'bo' ? 'Waiting on HO' : 'Waiting on store'}
                    </span>
                    <AgeClock at={t.last_message_at} />
                    <strong style={{ fontSize: 13.5 }}>{TASK_FORMS[t.task_type]?.name || t.task_type}</strong>
                    <span className="note" style={{ fontSize: 12.5 }}>
                      {t.store_name}{t.message_count > 1 ? ` · ${t.message_count} messages` : ''}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 4, fontSize: 13.5 }}>{t.label}</div>
                  <div className="note" style={{ fontSize: 12.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.last_author_name}: {t.preview || '(photo only)'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={busyId === t.record_id}
                  onClick={(e) => resolve(e, t)}
                  title="Mark this conversation resolved"
                  style={{ flexShrink: 0 }}
                >
                  {busyId === t.record_id ? <span className="spinner spinner-dark" /> : '✓ Resolve'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
