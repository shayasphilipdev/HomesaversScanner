import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { getStoreTasksToday, completeStoreTask, reopenStoreTask, getStoreTaskStats, uploadPhoto } from '../lib/api.js'
import { compressImage, newPhotoNamespace } from '../lib/photos.js'
import { useCurrentStore } from '../lib/currentStore.jsx'
import { useToast } from '../components/Toast.jsx'
import BlockRenderer from '../components/forms/BlockRenderer.jsx'
import ScreenshotInput from '../components/forms/ScreenshotInput.jsx'
import CurrentStorePicker from '../components/CurrentStorePicker.jsx'
import { STORE_ROLE_KEYS, canAccessTemplates, canSeeManagerDashboard } from '../lib/roles.js'
import { readDraft, writeDraft, clearDraft, pruneDrafts } from '../lib/storeTaskDraft.js'

// Quick link to the Task Templates editor — shown to template-capable roles
// (store managers, area managers, buying roles, admin) so they can reach it
// without the admin nav.
function TemplatesButton() {
  const { session } = useStore()
  if (!canAccessTemplates(session)) return null
  return <Link to="/admin/task-templates" className="btn btn-outline btn-sm">📋 Task Templates</Link>
}

// Store tasks (Phase 9E). Two views by role:
// - Store roles (sales_assistant, supervisor, assistant_store_manager, store_manager):
//   today's checklist for their store.
// - HQ roles (area_manager and above): compliance overview across stores.

export default function StoreTasks() {
  const { session } = useStore()
  const isStoreRole    = STORE_ROLE_KEYS.includes(session.role)
  const isStoreManager = session.role === 'store_manager'
  const isAreaManager  = session.role === 'area_manager'
  // Area managers keep landing on the compliance rollup they see today; the
  // per-store checklist is an opt-in tab. Store managers keep 'today'.
  const [view, setView] = useState(session.role === 'area_manager' ? 'perf' : 'today')

  // Area managers: the same two-tab layout as a store manager, but the store
  // picker inside StoreTodayView lets them switch between the stores in their
  // area. The compliance rollup stays the default so their existing landing
  // view is unchanged; the checklist is the new tab. The API already allowed
  // this — scopedStoreIds() expands their area into store ids, so
  // /store-tasks/today has always accepted one of their stores.
  if (isAreaManager) {
    return (
      <div>
        <div className="flex-row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${view === 'perf'  ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('perf')}>Store performance</button>
          <button className={`btn btn-sm ${view === 'today' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('today')}>Store tasks</button>
        </div>
        {view === 'today' ? <StoreTodayView /> : <ManagerView />}
      </div>
    )
  }

  // Everyone else above shop-floor level: store-wide compliance overview.
  if (!isStoreRole) return <ManagerView />

  // Store managers: their store's daily tasks (default) + a performance view.
  if (isStoreManager) {
    return (
      <div>
        <div className="flex-row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${view === 'today' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('today')}>Today's tasks</button>
          <button className={`btn btn-sm ${view === 'perf'  ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView('perf')}>Store performance</button>
        </div>
        {view === 'today' ? <StoreTodayView /> : <ManagerView />}
      </div>
    )
  }

  // Other store staff: just the daily checklist.
  return <StoreTodayView />
}

// ── Store view ───────────────────────────────────────────────────────────
function StoreTodayView() {
  const { session } = useStore()
  const { currentStoreId } = useCurrentStore()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    if (!currentStoreId) { setItems([]); setLoading(false); return }
    setLoading(true); setError('')
    try { setItems(await getStoreTasksToday({ storeId: currentStoreId })) }
    catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [currentStoreId])

  // Drop expired drafts once per visit so a shared tablet doesn't accumulate
  // months of abandoned sweeps.
  useEffect(() => { pruneDrafts() }, [])

  const onCompleted = (id, patch) => setItems(its => its.map(i => i.id === id ? { ...i, ...patch } : i))

  const remaining = items.filter(i => i.status === 'pending')
  const done      = items.filter(i => i.status === 'completed')

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Today's tasks</div>
          <div className="page-subtitle">
            {done.length} of {items.length} complete
          </div>
        </div>
        <TemplatesButton />
      </div>

      <CurrentStorePicker subject="store task" />

      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !items.length ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <p>Nothing assigned today.</p>
          <p className="note" style={{ marginTop: 6 }}>Head Office creates tasks centrally — when one is due here, it'll appear in this list.</p>
        </div></div>
      ) : (
        <>
          {!!remaining.length && (
            <div style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>To do</h3>
              {remaining.map(it => <TaskCard key={it.id} item={it} toast={toast} onCompleted={onCompleted} />)}
            </div>
          )}
          {!!done.length && (
            <div>
              <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>Done today</h3>
              {done.map(it => <TaskCard key={it.id} item={it} toast={toast} onCompleted={onCompleted} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TaskCard({ item, toast, onCompleted }) {
  const { session } = useStore()
  const t = item.store_task_templates || {}
  const done = item.status === 'completed'
  const blocks = Array.isArray(t.blocks) ? t.blocks : []
  const hasBlocks = blocks.length > 0

  // A part-finished sweep is worth protecting: answers are only persisted by the
  // submit below, so without this a reload loses every scan. Only ever seed from
  // a draft for a still-pending block task — the server copy is authoritative
  // for anything already completed.
  const userId = session?.userId || null
  const [answers, setAnswers] = useState(() => {
    if (done || !hasBlocks) return item.answers || {}
    const draft = readDraft(userId, item.id)
    return draft || item.answers || {}
  })
  const [restored, setRestored] = useState(
    () => !done && hasBlocks && !!readDraft(userId, item.id)
  )
  const [draftFailed, setDraftFailed] = useState(false)

  const [expanded, setExpanded] = useState(!done && (hasBlocks || t.requires_photo || t.requires_notes))
  const [photo, setPhoto]       = useState(null)
  const [photoUrl, setPhotoUrl] = useState(item.photo_url || '')
  const [notes, setNotes]       = useState(item.notes || '')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')

  // Save as the operator works. Skipped once completed so submitting does not
  // immediately write the draft back.
  useEffect(() => {
    if (done || !hasBlocks) return
    if (!answers || Object.keys(answers).length === 0) return
    if (!writeDraft(userId, item.id, answers)) setDraftFailed(true)
  }, [answers, done, hasBlocks, userId, item.id])

  const discardDraft = () => {
    clearDraft(userId, item.id)
    setAnswers(item.answers || {})
    setRestored(false)
  }

  // Reopen is offered to a manager, or to whoever completed it — otherwise a
  // lone assistant is stranded by their own mis-tap. The server enforces this
  // properly; this only decides whether to show the button.
  // canSeeManagerDashboard uses the same role set as the server's isManagerRole,
  // so the button and the server gate cannot drift apart.
  const canReopen = done && (
    canSeeManagerDashboard(session) ||
    (!!userId && userId === item.completed_by)
  )

  const reopen = async () => {
    if (!confirm('Reopen this task?\n\nYour entries are kept — the task just goes back to not-done so you can finish it.')) return
    setBusy(true); setErr('')
    try {
      await reopenStoreTask(item.id)
      toast.success('Task reopened.')
      onCompleted(item.id, { status: 'pending', completed_at: null, completed_by: null })
      setExpanded(true)
    } catch (e) {
      setErr(e.message); toast.error(e.message)
    } finally { setBusy(false) }
  }

  const pickPhoto = async (file) => {
    if (!file) return
    setErr('')
    try {
      const blob = await compressImage(file, 1600, 0.8)
      setPhoto(blob)
      setPhotoUrl(URL.createObjectURL(blob))
    } catch (e) { setErr(e.message) }
  }

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      let url = item.photo_url || null
      // Legacy single photo (only when not using blocks).
      if (!hasBlocks && photo && !item.photo_url) {
        const tempId = newPhotoNamespace()
        const r = await uploadPhoto({ file: photo, slot: 'store_task', tempId })
        url = r.url
      }
      const updated = await completeStoreTask(item.id, {
        photo_url: url,
        notes:     notes.trim() || null,
        answers:   hasBlocks ? answers : undefined
      })
      // Submitted — the server now holds the answers, so drop the local copy.
      clearDraft(userId, item.id)
      setRestored(false)
      toast.success('Task completed.')
      onCompleted(item.id, { status: 'completed', completed_at: updated.completed_at, photo_url: url, notes, answers })
    } catch (e) { setErr(e.message); toast.error(e.message) } finally { setBusy(false) }
  }

  const showActions = !done && expanded

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-body" style={{ padding: 14 }}>
        <div className="flex-row" style={{ alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 20, marginTop: 2 }} aria-hidden>
            {done ? '✅' : t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{t.title || '(untitled)'}</div>
            {t.description && <div className="note" style={{ fontSize: 12.5, marginTop: 2 }}>{t.description}</div>}
            {t.category && <span className="chip" style={{ marginTop: 4 }}>{t.category}</span>}
            {t.due_window && !done && <span className="note" style={{ marginLeft: 6, fontSize: 12 }}>Due by {t.due_window}</span>}
            {done && item.completed_at && (
              <div className="note" style={{ fontSize: 12, marginTop: 4 }}>
                Completed {new Date(item.completed_at).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          {!done && (
            <button className="btn btn-sm btn-outline" onClick={() => setExpanded(v => !v)}>
              {expanded ? 'Close' : 'Complete'}
            </button>
          )}
          {canReopen && (
            <button
              className="btn btn-sm btn-outline"
              onClick={reopen}
              disabled={busy}
              title="Marked complete by mistake? Your entries are kept."
            >
              {busy ? <span className="spinner spinner-dark" /> : '↩ Reopen'}
            </button>
          )}
        </div>

        {showActions && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
            {t.instructions && (
              <p className="note" style={{ marginBottom: 10 }}>{t.instructions}</p>
            )}

            {/* Say so when work has been brought back — seeing unexplained lines
                appear, with no way to tell whether they are genuine, is worse
                than losing them. */}
            {restored && (
              <div style={{
                marginBottom: 10, padding: '8px 12px', borderRadius: 6,
                background: '#E8F1FB', border: '1px solid #5B8DEF',
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'
              }}>
                <span aria-hidden>↩️</span>
                <span style={{ flex: 1, fontSize: 13, minWidth: 180 }}>
                  Unfinished work from this device was restored. Carry on, or start again.
                </span>
                <button type="button" className="btn btn-sm btn-outline" onClick={discardDraft}>
                  Start over
                </button>
              </div>
            )}

            {/* Storage unavailable (private window, storage disabled, full). The
                task still submits — but progress is not being protected, and the
                operator should know that before scanning 40 products. */}
            {draftFailed && (
              <div style={{
                marginBottom: 10, padding: '8px 12px', borderRadius: 6,
                background: '#FFF7E0', border: '1px solid #E0A03A', fontSize: 13
              }}>
                ⚠️ This device won’t save progress — finish the task in one go, or your entries could be lost.
              </div>
            )}

            {hasBlocks ? (
              <BlockRenderer
                blocks={blocks}
                answers={answers}
                onAnswer={(id, v) => setAnswers(a => ({ ...a, [id]: v }))}
              />
            ) : (
              <>
                {t.requires_photo && (
                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label>Photo <span style={{ color: 'var(--red)' }}>*</span></label>
                    {photoUrl && <img src={photoUrl} alt="" style={{ maxWidth: 160, borderRadius: 8, marginBottom: 8, display: 'block' }} />}
                    <input type="file" accept="image/*" capture="environment" onChange={e => pickPhoto(e.target.files?.[0])} />
                    <ScreenshotInput compact onImage={pickPhoto} disabled={busy} />
                  </div>
                )}
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label>Notes {t.requires_notes && <span style={{ color: 'var(--red)' }}>*</span>}</label>
                  <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.requires_notes ? 'What did you do / what did you find?' : 'Anything to add? (optional)'} />
                </div>
              </>
            )}

            {err && <div className="login-error mt-12">{err}</div>}
            <div className="flex-row mt-12" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? <><span className="spinner" /> Saving…</> : '✓ Mark complete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Manager / HQ view — compliance overview ──────────────────────────────
function ManagerView() {
  const { session } = useStore()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(weekAgo)
  const [to, setTo]     = useState(today)

  const load = async () => {
    setLoading(true); setError('')
    try { setStats(await getStoreTaskStats({ from, to })) }
    catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [from, to])

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Store tasks — compliance</div>
          <div className="page-subtitle">
            {stats?.overall.total ?? '—'} instances · {stats?.overall.completion_pct ?? 0}% complete
          </div>
        </div>
        <div className="flex-row" style={{ gap: 8, alignItems: 'center' }}>
          <TemplatesButton />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" value={to}   onChange={e => setTo(e.target.value)} />
          <button className="btn btn-outline btn-sm" onClick={load}>Refresh</button>
        </div>
      </div>

      {error && <div className="login-error">{error}</div>}

      {loading ? (
        <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: 40 }}><span className="spinner spinner-dark" /></div></div>
      ) : !stats?.per_store?.length ? (
        <div className="card"><div className="empty-state"><p>No store tasks in this range yet.</p></div></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th className="td-right">Total</th>
                  <th className="td-right">Completed</th>
                  <th className="td-right">Pending</th>
                  <th className="td-right">Missed</th>
                  <th className="td-right">% complete</th>
                </tr>
              </thead>
              <tbody>
                {stats.per_store.map(s => (
                  <tr key={s.store_id}>
                    <td>{s.store_name || s.store_id}</td>
                    <td className="td-right">{s.total}</td>
                    <td className="td-right">{s.completed || 0}</td>
                    <td className="td-right">{s.pending || 0}</td>
                    <td className="td-right">{s.missed || 0}</td>
                    <td className="td-right"><strong>{s.completion_pct}%</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
