import { useEffect, useRef, useState } from 'react'
import { getRecordMessages, postRecordMessage, markRecordMessagesRead } from '../lib/api.js'
import { useStore } from '../App.jsx'

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

const TYPE_LABEL = { information: 'Info', query: 'Query', action: 'Action' }
const TYPE_COLOR = { information: '#3B82F6', query: '#D97706', action: '#DC2626' }

// Per-record expandable message thread.
export default function RecordMessages({ recordId, onUnreadChange }) {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [msgs, setMsgs]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [draft, setDraft]       = useState('')
  const [priority, setPriority] = useState('normal')
  const [msgType, setMsgType]   = useState('query')
  const [sending, setSending]   = useState(false)
  const bottomRef = useRef(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const rows = await getRecordMessages(recordId)
      setMsgs(rows)
      // Mark as read so the nav unread badge decreases.
      await markRecordMessagesRead(recordId).catch(() => {})
      window.dispatchEvent(new Event('hs:messages-read'))
      onUnreadChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [recordId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [msgs])

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    try {
      const msg = await postRecordMessage(recordId, text, priority, msgType)
      setMsgs(prev => [...(prev || []), msg])
      setDraft('')
      setPriority('normal')
      setMsgType('query')
      onUnreadChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const isOwnMessage = (msg) => {
    if (isBO) return ['area_manager','support_admin','buying_manager','buying_head','admin'].includes(msg.author_role)
    return ['sales_assistant','supervisor','assistant_store_manager','store_manager'].includes(msg.author_role)
  }

  return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-soft)', borderTop: '1px solid var(--border)' }}>
      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading messages…</div>}
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}

      {msgs !== null && (
        <>
          {msgs.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
              No messages yet. Start the conversation below.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 260, overflowY: 'auto' }}>
            {msgs.map(msg => {
              const mine     = isOwnMessage(msg)
              const hiPri    = msg.priority === 'high'
              const typColor = TYPE_COLOR[msg.msg_type] || TYPE_COLOR.query
              return (
                <div key={msg.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  {(hiPri || (msg.msg_type && msg.msg_type !== 'query')) && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 3, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      {hiPri && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', background: '#FEE2E2', borderRadius: 4, padding: '1px 6px' }}>HIGH</span>
                      )}
                      {msg.msg_type && msg.msg_type !== 'query' && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: typColor, background: `${typColor}18`, borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase' }}>
                          {TYPE_LABEL[msg.msg_type] || msg.msg_type}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{
                    background: mine ? 'var(--primary, #2563eb)' : 'var(--surface)',
                    color: mine ? '#fff' : 'inherit',
                    borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    padding: '7px 12px',
                    fontSize: 13.5,
                    boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                    border: hiPri ? '1.5px solid #FCA5A5' : undefined
                  }}>
                    {msg.body}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
                    {msg.author_name} · {formatTime(msg.created_at)}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        </>
      )}

      {/* Compose area */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Priority</span>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            disabled={sending}
            style={{ fontSize: 12, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)', background: priority === 'high' ? '#FEF2F2' : 'var(--surface)', cursor: 'pointer' }}
          >
            <option value="normal">Normal</option>
            <option value="high">🔴 High</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 6 }}>Type</span>
          <select
            value={msgType}
            onChange={e => setMsgType(e.target.value)}
            disabled={sending}
            style={{ fontSize: 12, padding: '2px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
          >
            <option value="query">Query</option>
            <option value="information">Information</option>
            <option value="action">Action required</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea
            rows={2}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            style={{ flex: 1, resize: 'vertical', fontSize: 13, borderRadius: 6, padding: '6px 10px', border: '1px solid var(--border)' }}
            disabled={sending}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={send}
            disabled={sending || !draft.trim()}
            style={{ alignSelf: 'flex-end' }}
          >
            {sending ? <span className="spinner" /> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
