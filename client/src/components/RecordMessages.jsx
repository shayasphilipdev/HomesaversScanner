import { useEffect, useRef, useState } from 'react'
import { getRecordMessages, postRecordMessage, markRecordMessagesRead } from '../lib/api.js'
import { useStore } from '../App.jsx'

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

// Per-record expandable message thread.
// Loads messages when first opened, marks them as read on open, lets users reply.
export default function RecordMessages({ recordId, onUnreadChange }) {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const [msgs, setMsgs] = useState(null)    // null = not loaded yet
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const rows = await getRecordMessages(recordId)
      setMsgs(rows)
      // Mark all messages as read for our side, then signal the nav badge.
      await markRecordMessagesRead(recordId).catch(() => {})
      window.dispatchEvent(new Event('hs:messages-read'))
      onUnreadChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [recordId])

  useEffect(() => {
    // Scroll to the bottom when messages load or a new one is added.
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [msgs])

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setSending(true)
    try {
      const msg = await postRecordMessage(recordId, text)
      setMsgs(prev => [...(prev || []), msg])
      setDraft('')
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
              const mine = isOwnMessage(msg)
              return (
                <div key={msg.id} style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '80%'
                }}>
                  <div style={{
                    background: mine ? 'var(--primary, #2563eb)' : 'var(--surface)',
                    color: mine ? '#fff' : 'inherit',
                    borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    padding: '7px 12px',
                    fontSize: 13.5,
                    boxShadow: '0 1px 2px rgba(0,0,0,.08)'
                  }}>
                    {msg.body}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
                    {msg.author_name} · {formatTime(msg.created_at)}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        </>
      )}

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
  )
}
