import { useEffect, useState } from 'react'
import { useStore } from '../App.jsx'
import {
  listProductQuestions, getProductQuestion, createProductQuestion,
  answerProductQuestion, closeProductQuestion, uploadPhoto
} from '../lib/api.js'
import { compressImage, newPhotoNamespace } from '../lib/photos.js'
import { useToast } from '../components/Toast.jsx'

// Chain-wide Product Query board.
//   - Any signed-in user can post a question (photo + notes) or an answer.
//   - Only the asker can close their own thread.
//   - Closed threads are invisible to every user (server filters on status='open').
export default function ProductQuery() {
  const { session } = useStore()
  const toast = useToast()

  const [questions, setQuestions] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [composing, setComposing] = useState(false)
  const [openId, setOpenId]       = useState(null)   // currently expanded thread

  const load = async () => {
    setLoading(true); setError('')
    try { setQuestions(await listProductQuestions()) }
    catch (e) { setError(e.message); toast.error(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Product Query</div>
          <div className="page-subtitle">
            {questions.length} open thread{questions.length === 1 ? '' : 's'} · ask other stores about an unknown product
          </div>
        </div>
        <div className="flex-row" style={{ gap: 6 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setComposing(true)}>+ Ask all stores</button>
          <button className="btn btn-outline btn-sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {error && <div className="login-error mt-12">{error}</div>}

      {composing && (
        <NewQuestionCard
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load() }}
          toast={toast}
        />
      )}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !questions.length ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">🤔</div>
          <p>No open product questions.</p>
          <p className="note" style={{ marginTop: 6 }}>Tap <strong>+ Ask all stores</strong> if you've got a product without a barcode and want help.</p>
        </div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {questions.map(q => (
            <QuestionCard
              key={q.id}
              q={q}
              isMine={q.created_by === session.user_id}
              expanded={openId === q.id}
              onToggle={() => setOpenId(openId === q.id ? null : q.id)}
              onChanged={load}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NewQuestionCard({ onClose, onSaved, toast }) {
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoUrl,  setPhotoUrl]  = useState('')   // local preview
  const [notes, setNotes]         = useState('')
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState('')

  const pickPhoto = async (file) => {
    if (!file) return
    try {
      const blob = await compressImage(file, 1600, 0.8)
      setPhotoBlob(blob)
      setPhotoUrl(URL.createObjectURL(blob))
      setErr('')
    } catch (e) { setErr(e.message) }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!photoBlob) return setErr('A photo of the product is required.')
    setBusy(true); setErr('')
    try {
      const up = await uploadPhoto({ file: photoBlob, slot: 'store_task', tempId: newPhotoNamespace() })
      await createProductQuestion({ photo_url: up.url, notes: notes.trim() || null })
      toast.success('Question posted to all stores.')
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">Ask all stores</div>
      <div className="card-body">
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Photo of the product *</label>
            {photoUrl && <img src={photoUrl} alt="" style={{ maxWidth: 200, borderRadius: 8, marginBottom: 8, display: 'block' }} />}
            <input type="file" accept="image/*" capture="environment" onChange={e => pickPhoto(e.target.files?.[0])} />
          </div>
          <div className="form-group">
            <label>Notes (optional — what do you want to know?)</label>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. No barcode on this product — anyone know the code or supplier?" />
          </div>
          {err && <div className="login-error mt-12">{err}</div>}
          <div className="flex-row mt-12" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? <><span className="spinner" /> Posting…</> : 'Post question'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function QuestionCard({ q, isMine, expanded, onToggle, onChanged, toast }) {
  const [full, setFull]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [closing, setClosing]   = useState(false)

  useEffect(() => {
    if (!expanded) { setFull(null); setReplyOpen(false); return }
    setLoading(true)
    getProductQuestion(q.id)
      .then(setFull)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [expanded, q.id])

  const close = async () => {
    if (!confirm('Close this thread? It will disappear from everyone\'s view (the data is kept in the database).')) return
    setClosing(true)
    try { await closeProductQuestion(q.id); toast.success('Thread closed.'); onChanged() }
    catch (e) { toast.error(e.message) } finally { setClosing(false) }
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent',
          border: 0, cursor: 'pointer', padding: 0
        }}
      >
        <img src={q.photo_url} alt="Product" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block', background: 'var(--bg-soft)' }} />
        <div style={{ padding: 12 }}>
          {q.notes && <div style={{ fontSize: 13.5, marginBottom: 6, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{q.notes}</div>}
          <div className="note" style={{ fontSize: 12 }}>
            Asked by <strong>{q.created_by_name}</strong>
            {' · '}
            {new Date(q.created_at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}
            {q.answer_count || 0} answer{q.answer_count === 1 ? '' : 's'}
            {isMine && <span className="chip" style={{ marginLeft: 6 }}>yours</span>}
          </div>
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-soft)', padding: 12 }}>
          {loading || !full ? (
            <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner spinner-dark" /></div>
          ) : (
            <>
              <div style={{ marginBottom: 10, fontWeight: 600, fontSize: 13 }}>
                Answers ({full.answers?.length || 0})
              </div>
              {!full.answers?.length && (
                <div className="note" style={{ fontSize: 12.5, marginBottom: 10 }}>No answers yet — be the first.</div>
              )}
              {full.answers?.map(a => (
                <div key={a.id} style={{ background: 'var(--surface-warm)', padding: 8, borderRadius: 6, marginBottom: 6 }}>
                  {a.photo_url && <img src={a.photo_url} alt="" style={{ maxWidth: 120, borderRadius: 6, marginBottom: 6, display: 'block' }} />}
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{a.notes}</div>
                  <div className="note" style={{ fontSize: 11, marginTop: 4 }}>
                    {a.by_user_name} · {new Date(a.at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}

              <div className="flex-row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={() => setReplyOpen(true)}>+ Add answer</button>
                {isMine && (
                  <button className="btn btn-outline btn-sm" onClick={close} disabled={closing} title="Close this thread once you have the answer you need">
                    {closing ? <span className="spinner" /> : '✓ Close thread'}
                  </button>
                )}
              </div>

              {replyOpen && (
                <AnswerForm
                  questionId={q.id}
                  onClose={() => setReplyOpen(false)}
                  onSaved={() => {
                    setReplyOpen(false)
                    setFull(null)
                    getProductQuestion(q.id).then(setFull)
                    onChanged()
                  }}
                  toast={toast}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AnswerForm({ questionId, onClose, onSaved, toast }) {
  const [photoBlob, setPhotoBlob] = useState(null)
  const [photoUrl, setPhotoUrl]   = useState('')
  const [notes, setNotes]         = useState('')
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState('')

  const pickPhoto = async (file) => {
    if (!file) return
    try {
      const blob = await compressImage(file, 1600, 0.8)
      setPhotoBlob(blob); setPhotoUrl(URL.createObjectURL(blob)); setErr('')
    } catch (e) { setErr(e.message) }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!notes.trim()) return setErr('Notes are required for an answer.')
    setBusy(true); setErr('')
    try {
      let photo_url = null
      if (photoBlob) {
        const up = await uploadPhoto({ file: photoBlob, slot: 'store_task', tempId: newPhotoNamespace() })
        photo_url = up.url
      }
      await answerProductQuestion(questionId, { photo_url, notes: notes.trim() })
      toast.success('Answer posted.')
      onSaved()
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 8, padding: 8, background: 'var(--surface-warm)', borderRadius: 6 }}>
      <div className="form-group">
        <label>Your answer *</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. We had this — the barcode is 5012345…" />
      </div>
      <div className="form-group">
        <label>Photo (optional)</label>
        {photoUrl && <img src={photoUrl} alt="" style={{ maxWidth: 120, borderRadius: 6, marginBottom: 6, display: 'block' }} />}
        <input type="file" accept="image/*" capture="environment" onChange={e => pickPhoto(e.target.files?.[0])} />
      </div>
      {err && <div className="login-error">{err}</div>}
      <div className="flex-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? <><span className="spinner" /> Posting…</> : 'Post answer'}
        </button>
      </div>
    </form>
  )
}
