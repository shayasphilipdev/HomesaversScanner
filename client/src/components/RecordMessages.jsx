import { useEffect, useRef, useState } from 'react'
import { getRecordMessages, postRecordMessage, markRecordMessagesRead, uploadMessagePhoto, deletePhoto, resolveRecordMessages, getMessageRecipients, deleteRecordMessage } from '../lib/api.js'
import { compressImage } from '../lib/photos.js'
import { imageFromDataTransfer } from '../lib/screenshot.js'
import ScreenshotInput from './forms/ScreenshotInput.jsx'
import CannedReplyPicker from './forms/CannedReplyPicker.jsx'
import Lightbox from './Lightbox.jsx'
import { useStore } from '../App.jsx'
import { canReviewHQRecords } from '../lib/roles.js'

// Restricted message audiences. 'all' = the normal store <-> back-office thread.
const REVIEWER_ROLES = ['admin', 'buying_manager', 'buying_head', 'support_admin']
const AUDIENCE_LABEL  = { all: 'Store (everyone)', backoffice: 'Back office', area_managers: 'Area managers' }
const audienceOfRole  = (role) =>
  role === 'area_manager' ? 'area_managers'
    : REVIEWER_ROLES.includes(role) ? 'backoffice'
    : null

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
}

const TYPE_LABEL = { information: 'Info', query: 'Query', action: 'Action' }
const TYPE_COLOR = { information: '#3B82F6', query: '#D97706', action: '#DC2626' }

// Per-record expandable message thread.
//
// resolvedAt/resolvedByName: the parent record's current resolved state (it
// lives on task_records, not per-message — see supabase-migration-awaiting-reply.sql)
// so the caller passes it in from the row it already has. onResolvedChange
// lets the caller update that row locally instead of re-fetching the list.
export default function RecordMessages({ recordId, onUnreadChange, resolvedAt, resolvedByName, onResolvedChange }) {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'
  // Deleting a message is a moderation action, not something an author gets
  // for their own messages — strict admin only, matching the server guard.
  const isAdmin = session.role === 'admin'
  // Canned replies are head-office reply templates ("VRS is investigating…"),
  // so the picker is limited to the roles that actually answer these threads.
  // Deliberately NOT `isBO`: area_manager logs in with mode 'backoffice' too
  // (see STORE_ROLES/BO_ROLES in functions/api/[[route]].js), so isBO would
  // still hand the list to an area manager. canReviewHQRecords is the HQ
  // reviewer set - support_admin, buying_manager, buying_head, admin - which
  // is exactly who is meant to have it.
  const showCanned = canReviewHQRecords(session)

  const [msgs, setMsgs]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [draft, setDraft]       = useState('')
  const [priority, setPriority] = useState('normal')
  const [msgType, setMsgType]   = useState('query')
  const [sending, setSending]   = useState(false)
  const [photos, setPhotos]     = useState([])     // pending attachments: [{ url, path }]
  const [uploading, setUploading] = useState(false)
  const [resolvedState, setResolvedState] = useState({ at: resolvedAt || null, by: resolvedByName || null })
  const [resolving, setResolving] = useState(false)
  // { images:[{url,label}], index } | null — one message's attachments,
  // opened in-app instead of a new browser tab. See Lightbox.jsx.
  const [lightbox, setLightbox] = useState(null)
  // Restricted-audience compose (back-office logins only). 'all' = normal thread.
  const [audience, setAudience]     = useState('all')
  const [recipientId, setRecipientId] = useState('')
  const [recipients, setRecipients]   = useState([])
  const bottomRef   = useRef(null)
  const fileRef     = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    setResolvedState({ at: resolvedAt || null, by: resolvedByName || null })
  }, [recordId, resolvedAt, resolvedByName])

  // Load the HQ people list once, for the "To:" person picker.
  useEffect(() => {
    if (!isBO) return
    getMessageRecipients().then(setRecipients).catch(() => setRecipients([]))
  }, [isBO])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const rows = await getRecordMessages(recordId)
      setMsgs(rows)
      // Default the compose target to the last message's audience, so a
      // back-and-forth in a restricted thread stays in that channel by default
      // (an 'all' last message resets it to Store).
      const lastAud = Array.isArray(rows) && rows.length ? (rows[rows.length - 1].audience || 'all') : 'all'
      setAudience(isBO ? lastAud : 'all')
      setRecipientId('')
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
    if (!text && !photos.length) return
    const aud = isBO ? audience : 'all'
    setSending(true)
    try {
      const msg = await postRecordMessage(
        recordId, text, priority, msgType, photos.map(p => p.url),
        aud, aud !== 'all' && recipientId ? recipientId : null
      )
      setMsgs(prev => [...(prev || []), msg])
      setDraft('')
      setPriority('normal')
      setMsgType('query')
      setPhotos([])
      setRecipientId('')
      // Keep `audience` as-is so a restricted back-and-forth stays in channel.
      // Only an 'all' message can reopen a resolved (store) thread.
      if (aud === 'all' && resolvedState.at) {
        setResolvedState({ at: null, by: null })
        onResolvedChange?.(null, null)
      }
      onUnreadChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  // Permanent — no undo, so a native confirm rather than an optimistic
  // remove. Admin only; the server re-checks this independently.
  const removeMessage = async (msg) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return
    try {
      await deleteRecordMessage(recordId, msg.id)
      setMsgs(prev => (prev || []).filter(m => m.id !== msg.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const toggleResolved = async () => {
    const next = !resolvedState.at
    setResolving(true)
    try {
      await resolveRecordMessages(recordId, next)
      const at = next ? new Date().toISOString() : null
      const by = next ? (session.display_name || session.username || 'You') : null
      setResolvedState({ at, by })
      onResolvedChange?.(at, by)
    } catch (e) {
      setError(e.message)
    } finally {
      setResolving(false)
    }
  }

  // Attach photos — compress client-side, upload to the shared task-photos
  // bucket (messages/ prefix), cap at 3 per message.
  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true); setError('')
    try {
      for (const f of files) {
        if (photos.length >= 3) break
        const blob = await compressImage(f, 1600, 0.8)
        const up   = await uploadMessagePhoto(blob)
        setPhotos(prev => (prev.length < 3 ? [...prev, { url: up.url, path: up.path }] : prev))
      }
    } catch (e) {
      setError(e.message || 'Photo upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = (p) => {
    setPhotos(prev => prev.filter(x => x.url !== p.url))
    deletePhoto(p.path).catch(() => {})
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const isOwnMessage = (msg) => {
    if (isBO) return ['area_manager','support_admin','buying_manager','buying_head','admin'].includes(msg.author_role)
    return ['sales_assistant','supervisor','assistant_store_manager','store_manager'].includes(msg.author_role)
  }

  return (
    <>
    <div style={{ padding: '10px 14px', background: 'var(--bg-soft)', borderTop: '1px solid var(--border)' }}>
      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading messages…</div>}
      {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}

      {/* "Resolved" is the store-thread SLA state — only offer it when there's
          an actual store-visible conversation, not on a restricted-only thread. */}
      {msgs !== null && msgs.some(m => (m.audience || 'all') === 'all') && (
        <div className="flex-row" style={{
          justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8,
          padding: '5px 10px', borderRadius: 6,
          background: resolvedState.at ? 'var(--green-soft)' : 'transparent',
        }}>
          <span className="note" style={{ fontSize: 12, color: resolvedState.at ? 'var(--green)' : 'var(--text-muted)' }}>
            {resolvedState.at
              ? `✓ Resolved by ${resolvedState.by || 'someone'} · ${formatTime(resolvedState.at)}`
              : 'No further reply needed?'}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={toggleResolved}
            disabled={resolving}
            style={{ fontSize: 11.5, padding: '2px 8px' }}
          >
            {resolving ? <span className="spinner spinner-dark" /> : (resolvedState.at ? 'Reopen' : 'Mark resolved')}
          </button>
        </div>
      )}

      {msgs !== null && (
        <>
          {msgs.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
              No messages yet. Start the conversation below.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 260, overflowY: 'auto' }}>
            {msgs.map(msg => {
              const mine       = isOwnMessage(msg)
              const hiPri      = msg.priority === 'high'
              const restricted = msg.audience && msg.audience !== 'all'
              const typColor   = TYPE_COLOR[msg.msg_type] || TYPE_COLOR.query
              return (
                <div key={msg.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                  {(hiPri || restricted || (msg.msg_type && msg.msg_type !== 'query')) && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      {restricted && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#6D28D9', background: '#EDE9FE', borderRadius: 4, padding: '1px 6px' }}>
                          🔒 {AUDIENCE_LABEL[msg.audience] || msg.audience}{msg.recipient_name ? ` · ${msg.recipient_name}` : ''}
                        </span>
                      )}
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
                    background: mine ? 'var(--primary, #2563eb)' : (restricted ? '#F5F3FF' : 'var(--surface)'),
                    color: mine ? '#fff' : 'inherit',
                    borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    padding: '7px 12px',
                    fontSize: 13.5,
                    boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                    border: restricted ? '1.5px dashed #A78BFA' : (hiPri ? '1.5px solid #FCA5A5' : undefined)
                  }}>
                    {msg.body && <div style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</div>}
                    {Array.isArray(msg.photo_urls) && msg.photo_urls.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: msg.body ? 6 : 0 }}>
                        {msg.photo_urls.map((u, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setLightbox({
                              images: msg.photo_urls.map((mu, mi) => ({ url: mu, label: `Attachment ${mi + 1}` })),
                              index: i,
                            })}
                            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
                          >
                            <img src={u} alt="attachment" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, textAlign: mine ? 'right' : 'left', display: 'flex', gap: 6, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <span>{msg.author_name} · {formatTime(msg.created_at)}</span>
                    {isAdmin && (
                      <button type="button" onClick={() => removeMessage(msg)} title="Delete this message (admin)"
                        style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}>
                        🗑
                      </button>
                    )}
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
        {/* All the pickers on one wrapping row — To (back office only) · Priority · Type. */}
        <div style={{ display: 'flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {isBO && (
            <>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>To</label>
              <select
                value={audience}
                onChange={e => { setAudience(e.target.value); setRecipientId('') }}
                disabled={sending}
                style={{ width: 148, fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: audience !== 'all' ? '#F5F3FF' : 'var(--surface)', color: audience !== 'all' ? '#6D28D9' : 'inherit', fontWeight: audience !== 'all' ? 700 : 400, cursor: 'pointer' }}
              >
                <option value="all">Store (everyone)</option>
                <option value="backoffice">Back office</option>
                <option value="area_managers">Area managers</option>
              </select>
              {audience !== 'all' && (
                <select
                  value={recipientId}
                  onChange={e => setRecipientId(e.target.value)}
                  disabled={sending}
                  style={{ minWidth: 130, fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
                >
                  <option value="">— Anyone —</option>
                  {recipients
                    .filter(u => audienceOfRole(u.role) === audience)
                    .map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
                </select>
              )}
            </>
          )}
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Priority</label>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            disabled={sending}
            style={{ width: 104, fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: priority === 'high' ? '#FEF2F2' : 'var(--surface)', cursor: 'pointer' }}
          >
            <option value="normal">Normal</option>
            <option value="high">🔴 High</option>
          </select>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Type</label>
          <select
            value={msgType}
            onChange={e => setMsgType(e.target.value)}
            disabled={sending}
            style={{ width: 132, fontSize: 12, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
          >
            <option value="query">Query</option>
            <option value="information">Information</option>
            <option value="action">Action required</option>
          </select>
          {isBO && audience !== 'all' && (
            <span style={{ fontSize: 11, color: '#6D28D9', whiteSpace: 'nowrap' }}>
              🔒 hidden from stores {audience === 'backoffice' ? '& area managers' : '& back office'}
            </span>
          )}
        </div>

        {photos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {photos.map(p => (
              <div key={p.url} style={{ position: 'relative' }}>
                <img src={p.url} alt="attachment" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                <button type="button" onClick={() => removePhoto(p)} title="Remove"
                  style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#DC2626', color: '#fff', fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Attach + snip tools on one slim line, in order: file · paste-snip · capture. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => addPhotos(e.target.files)} />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={sending || uploading || photos.length >= 3}
            title={photos.length >= 3 ? 'Up to 3 photos' : 'Attach a photo'}
            style={{ whiteSpace: 'nowrap' }}
          >
            {uploading ? <span className="spinner spinner-dark" /> : '📷 Attach'}
          </button>
          <ScreenshotInput
            inline
            disabled={sending || uploading || photos.length >= 3}
            onImage={file => addPhotos([file])}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            rows={2}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={e => {
              // Pasting a screenshot straight into the message box is the most
              // natural route on a PC — attach it instead of pasting its name.
              const img = imageFromDataTransfer(e.clipboardData)
              if (img) { e.preventDefault(); addPhotos([img]) }
            }}
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            style={{ flex: 1, resize: 'vertical', fontSize: 13, borderRadius: 6, padding: '6px 10px', border: '1px solid var(--border)' }}
            disabled={sending}
          />
          {showCanned && (
            <CannedReplyPicker
              textareaRef={textareaRef}
              value={draft}
              onChange={setDraft}
              disabled={sending}
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={send}
            disabled={sending || uploading || (!draft.trim() && !photos.length)}
            style={{ alignSelf: 'flex-end' }}
          >
            {sending ? <span className="spinner" /> : 'Send'}
          </button>
        </div>
      </div>
    </div>
    {lightbox && (
      <Lightbox
        images={lightbox.images}
        index={lightbox.index}
        onClose={() => setLightbox(null)}
        onIndexChange={i => setLightbox(l => ({ ...l, index: i }))}
      />
    )}
    </>
  )
}
