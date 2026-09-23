import { useEffect, useState } from 'react'
import { getTaskRecordEvents, getProductMaster, updateTaskRecord, reverseTaskRecordStatus } from '../lib/api.js'
import { TASK_FORMS } from '../lib/taskTypes.js'
import { useToast } from './Toast.jsx'
import { useStore } from '../App.jsx'
import RecordMessages from './RecordMessages.jsx'
import AgeClock from './AgeClock.jsx'
import Lightbox from './Lightbox.jsx'

// Everything known about one task record, in one place.
//
// The report grid can only show a handful of columns, and the Excel export is
// the only other way to see the rest — which means opening a spreadsheet to
// answer "what else do we know about this one?". This shows the full record,
// its task-specific details blob, the live Product Master entry for the same
// barcode, and the audit history.
//
// Props: record (a row already loaded by the report), storeName, open, onClose,
// showInternal (default true; pass false for a store-side user to drop the
// head-office-only fields - see isInternal below).

// Field label + optional formatter, grouped the way someone reads a record
// rather than the order the columns happen to sit in the table.
const GROUPS = [
  {
    title: 'Product',
    fields: [
      ['barcode_no',          'Product Barcode'],
      ['product_barcode',     'Product Code (EAN)'],
      ['product_code',        'Scanned Code'],
      ['item_name',           'Product Description'],
      ['description',         'Description (entered)'],
      ['product_name_label',  'Name as printed'],
      ['actual_product_name', 'Actual Product Name'],
      ['uom',                 'UOM'],
      ['quantity',            'Quantity'],
    ],
  },
  {
    title: 'Supplier & status',
    fields: [
      ['supl_id',            'Supplier'],
      ['supplier_code',      'Supplier Code'],
      ['supplier_name_text', 'Supplier (free text)'],
      ['item_status',        'Item Status'],
      ['barcode_status',     'Barcode Status'],
    ],
  },
  {
    title: 'Record',
    fields: [
      ['status',              'Status'],
      ['notes',               'Notes'],
      ['source',              'Source',              true],
      ['marked_for_deletion', 'Marked for deletion', true],
    ],
  },
]

// Third element of a field tuple = head-office only. Source and
// marked_for_deletion are internal plumbing, and are the only fields left in
// this generic list a store has never been shown anywhere else in the app.
// review_notes (Backoffice Comments) used to be a third read-only entry here
// too, but it's now the one field on this record someone actually writes to,
// so it gets its own editable section below instead of a plain Row - see
// BackofficeComments.
const isInternal = (f) => f[2] === true

// The same HO review action available per-row in Reports (Complete / No
// change needed), offered here too so a reviewer who opened Details to check
// something doesn't have to close the modal and go back to the row just to
// act on it. Back-office only (showInternal), only while still Pending, and
// only where the caller opts in (allowReview) — Pricing.jsx's copy of this
// modal is about pricing a record, not reviewing it, so it opts out.
// ReverseStatusButton takes over this slot once the record's been reviewed.
function ReviewButtons({ record, showInternal, allowReview, onUpdated }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!showInternal || !allowReview || record.status !== 'pending') return null

  const review = async (status) => {
    setBusy(true)
    try {
      const now   = new Date().toISOString()
      const patch = { status, ...(status === 'completed' ? { completed_at: now } : {}) }
      await updateTaskRecord(record.id, patch)
      // The server auto-stamps reviewed_at for a BO session moving to
      // completed/no_change_needed (see PATCH /task-records/:id) — mirror
      // that locally so "Reviewed" shows immediately without a re-fetch.
      onUpdated?.(record.id, { ...patch, reviewed_at: now })
      toast.success(status === 'completed' ? 'Marked complete.' : 'Marked “no change needed”.')
    } catch (e) {
      toast.error(e.message || 'Could not update this record')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-row" style={{ gap: 6, marginTop: 6 }}>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => review('completed')}>
        {busy ? <span className="spinner" /> : 'Complete'}
      </button>
      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => review('no_change_needed')}>
        No change
      </button>
    </div>
  )
}

// Undo the record's current status back to Pending (e.g. "Completed by HO"
// or "Cleared" -> Pending). Shown only when this session could plausibly do
// it — admin always; otherwise only if they're the one who set the CURRENT
// status, read off the already-loaded event history (the most recent
// task_record_events row whose to_status matches — events is ascending by
// `at`, so the last match is the most recent). The server re-checks this
// independently on the actual request; this is accurate UI, not the real
// gate, and fails safe (hides the button) while `events` is still loading.
function ReverseStatusButton({ record, events, onUpdated }) {
  const { session } = useStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  if (record.status === 'pending') return null
  const isAdmin = session.role === 'admin'
  const statusEvents    = (events || []).filter(e => e.to_status === record.status)
  const lastStatusEvent = statusEvents[statusEvents.length - 1]
  const canReverse = isAdmin || (!!session.userId && lastStatusEvent?.by_user_id === session.userId)
  if (!canReverse) return null

  const run = async () => {
    setBusy(true)
    try {
      await reverseTaskRecordStatus(record.id)
      onUpdated?.(record.id, {
        status: 'pending', reviewed_at: null, completed_at: null,
        store_completed_at: null, cleared_at: null, marked_for_deletion: false
      })
      toast.success('Reversed to Pending.')
    } catch (e) {
      toast.error(e.message || 'Could not reverse this status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn btn-sm btn-outline" disabled={busy} onClick={run}
      title="Undo this status back to Pending" style={{ marginTop: 6 }}>
      {busy ? <span className="spinner spinner-dark" /> : '↩ Reverse to Pending'}
    </button>
  )
}

// Backoffice Comments (task_records.review_notes) — an internal note a
// back-office user can leave on a record; a store login never sees this
// section exist (showInternal is false for them, same flag that already hid
// the field when it was read-only) and the server enforces the same rule
// independently on both the read and the write side, so this isn't the only
// thing standing between a store login and the field.
//
// Explicit Save rather than the debounced autosave Pricing's grid uses: this
// sits inside a modal someone can close mid-thought, and a save firing after
// the popup is already gone would silently lose or misattribute the edit.
function BackofficeComments({ record, onUpdated }) {
  const toast = useToast()
  const [value, setValue]     = useState(record.review_notes || '')
  const [saving, setSaving]   = useState(false)
  const dirty = value !== (record.review_notes || '')

  // The modal is reused across records without unmounting (Reports/Pricing
  // just swap the `record` prop), so the draft has to reset per record.
  useEffect(() => { setValue(record.review_notes || '') }, [record.id])

  const save = async () => {
    setSaving(true)
    try {
      await updateTaskRecord(record.id, { review_notes: value || null })
      onUpdated?.(record.id, { review_notes: value || null })
      toast.success('Comment saved.')
    } catch (e) {
      toast.error(e.message || 'Could not save the comment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
      <div className="note" style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        Backoffice Comments
      </div>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Internal note for back office — never shown to the store…"
        rows={3}
        style={{ width: '100%', resize: 'vertical', fontSize: 13, fontFamily: 'inherit' }}
      />
      <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={save}>
          {saving ? <><span className="spinner" /> Saving…</> : 'Save comment'}
        </button>
      </div>
    </div>
  )
}

// Rendered last, just before the history, and without a heading.
const TIME_FIELDS = [
  ['created_at',         'Created'],
  ['updated_at',         'Updated'],
  ['reviewed_at',        'Reviewed'],
  ['completed_at',       'Completed by HO'],
  ['store_completed_at', 'Store confirmed'],
  ['cleared_at',         'Archived'],
  ['priced_at',          'Priced'],
  ['pricing_removed_at', 'Pricing removed'],
]

const DATE_KEYS = new Set([
  'created_at', 'updated_at', 'reviewed_at', 'completed_at',
  'store_completed_at', 'cleared_at', 'priced_at', 'pricing_removed_at',
])

function fmt(key, v) {
  if (v === null || v === undefined || v === '') return null
  if (DATE_KEYS.has(key)) {
    const d = new Date(v)
    return isNaN(d) ? String(v) : d.toLocaleString('en-IE', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

// The details blob is task-type specific, so render whatever keys it has rather
// than guessing at a fixed shape.
function prettyKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <div className="note" style={{ flex: '0 0 135px', fontSize: 12.5 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, wordBreak: 'break-word', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>
        {value}
      </div>
    </div>
  )
}

export default function RecordDetailModal({ record, storeName, open, onClose, showInternal = true, allowReview = true, onUpdated, onPrev, onNext }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const [events, setEvents]       = useState(null)
  const [pm, setPm]               = useState(null)
  const [pmErr, setPmErr]         = useState('')
  // { images:[{url,label}], index } | null — the record's own Product/Barcode
  // photos, opened in-app instead of a new browser tab (see Lightbox.jsx).
  const [lightbox, setLightbox]   = useState(null)

  // Escape closes (the lightbox first, if it's open, then the modal itself);
  // Left/Right move to the previous/next record — but only when focus isn't
  // inside a text field (so arrow-key editing in Backoffice Comments or the
  // message composer isn't hijacked) and no lightbox is open, since it has
  // its own key handler for sliding/closing itself. Checked via the DOM
  // (data-lightbox) rather than the local `lightbox` state, because a photo
  // viewer can also be open one level down — RecordMessages opens its own
  // Lightbox for message attachments, and this modal has no state for that.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      const lightboxOpen = document.querySelector('[data-lightbox]')
      if (e.key === 'Escape') {
        if (lightboxOpen) return   // Lightbox's own handler closes just the photo viewer
        onClose?.()
        return
      }
      if (lightboxOpen) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft'  && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, onPrev, onNext])

  // A stale photo from the previous record must never carry over when
  // sliding to the next one via onPrev/onNext.
  useEffect(() => { setLightbox(null) }, [record?.id])

  useEffect(() => {
    if (!open || !record?.id) return
    let alive = true
    setEvents(null); setPm(null); setPmErr('')

    getTaskRecordEvents(record.id)
      .then(e => { if (alive) setEvents(e || []) })
      .catch(() => { if (alive) setEvents([]) })

    // Live Product Master entry for this barcode — category, selling price and
    // product type live there, not on the record.
    const code = record.product_barcode || record.barcode_no || record.product_code
    if (code) {
      getProductMaster({ q: String(code).trim(), page: 1 })
        .then(d => { if (alive) setPm(d?.rows?.[0] || null) })
        .catch(e => { if (alive) setPmErr(e.message) })
    }
    return () => { alive = false }
  }, [open, record?.id])

  if (!open || !record) return null

  const details = record.details && typeof record.details === 'object' ? record.details : {}
  const detailKeys = Object.keys(details).filter(k => details[k] !== null && details[k] !== '')

  const recordPhotos = [
    ['Product', record.photo_product_url],
    ['Barcode', record.photo_barcode_url],
  ].filter(([, u]) => u).map(([label, url]) => ({ label, url }))

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record details"
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,16,22,.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '4vh 12px', zIndex: 1000, overflowY: 'auto',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        className="card"
        style={{ width: '100%', maxWidth: 1520, marginBottom: 40 }}
      >
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>{TASK_FORMS[record.task_type]?.name || record.task_type}</strong>
          <span className="note" style={{ fontSize: 12.5 }}>
            {record.item_name || record.description || record.product_name_label || '(no description)'}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {(onPrev || onNext) && (
            <span className="flex-row" style={{ gap: 4 }}>
              <button className="btn btn-sm btn-outline" onClick={onPrev} disabled={!onPrev} title="Previous record (←)">‹ Prev</button>
              <button className="btn btn-sm btn-outline" onClick={onNext} disabled={!onNext} title="Next record (→)">Next ›</button>
            </span>
          )}
          <label className="note" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} />
            Show empty fields
          </label>
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕ Close</button>
        </div>

        <div className="card-body" style={{ paddingTop: 10 }}>
          {/* Left: the static record itself. Right: status actions, the
              back-office note, the conversation, and the audit trail — what's
              happening with it rather than what it is. Wraps back to one
              column on a narrow (phone) screen — see .rdm-cols in App.css. */}
          <div className="rdm-cols">
            <div className="rdm-left">
              {/* Was rendered full-width above the two-column split, so its
                  42%-of-row label boundary landed in a different spot than
                  every row below it once those moved into the narrower left
                  column — moved in here to line up with the rest. */}
              {storeName && <Row label="Store" value={storeName} />}

              {GROUPS.map(g => {
                const rows = g.fields
                  .filter(f => showInternal || !isInternal(f))
                  .map(([k, label]) => [k, label, fmt(k, record[k])])
                  .filter(([, , v]) => showEmpty || v !== null)
                if (!rows.length) return null
                return (
                  <div key={g.title}>
                    {rows.map(([k, label, v]) => (
                      <Row key={k} label={label} value={v ?? <span className="td-muted">—</span>}
                           mono={k === 'barcode_no' || k === 'product_barcode' || k === 'product_code'} />
                    ))}
                  </div>
                )
              })}

              {/* Task-specific payload — shape varies by task type. */}
              {(detailKeys.length > 0 || showEmpty) && (
                <div>
                  {detailKeys.length === 0
                    ? <div className="note" style={{ fontSize: 12.5 }}>None recorded.</div>
                    : detailKeys.map(k => (
                        <Row key={k} label={prettyKey(k)}
                             value={typeof details[k] === 'object' ? JSON.stringify(details[k]) : String(details[k])} />
                      ))}
                </div>
              )}

              {/* Photos — open in the in-app Lightbox instead of a new browser
                  tab, so zoom and sliding between the two are available and
                  the record detail underneath stays open. */}
              {recordPhotos.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="flex-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                    {recordPhotos.map((p, i) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setLightbox({ images: recordPhotos, index: i })}
                        title={`View ${p.label} photo`}
                        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'center' }}
                      >
                        <img src={p.url} alt={p.label} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                        <span className="note" style={{ fontSize: 12 }}>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Product Master — not stored on the record. */}
              <div>
                {pmErr ? <div className="note" style={{ fontSize: 12.5 }}>Could not load — {pmErr}</div>
                 : pm === null ? <div className="note" style={{ fontSize: 12.5 }}>No matching Product Master entry.</div>
                 : (
                  <>
                    <Row label="Selling Price" value={pm.selling_price != null && pm.selling_price !== '' ? `€${Number(pm.selling_price).toFixed(2)}` : '—'} />
                    <Row label="Category"      value={pm.category || '—'} />
                    <Row label="Subcategory"   value={pm.subcategory || '—'} />
                    <Row label="Product Type"  value={pm.product_type || '—'} />
                    <Row label="Product Status" value={pm.product_status || '—'} />
                    <Row label="Supplier"      value={pm.supplier || '—'} />
                  </>
                )}
              </div>
            </div>

            <div className="rdm-right">
              <ReviewButtons record={record} showInternal={showInternal} allowReview={allowReview} onUpdated={onUpdated} />
              <ReverseStatusButton record={record} events={events} onUpdated={onUpdated} />

              {showInternal && <BackofficeComments record={record} onUpdated={onUpdated} />}

              {/* The conversation on this record — same thread as the 💬 toggle
                  in the grid, so a reply can be read and written without
                  leaving the popup. No longer bleeds to the card's outer edge
                  (it used to, when this sat in a single full-width column) —
                  a bordered panel reads better as a sidebar block. */}
              <div style={{ marginTop: 14, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-soft)' }}>
                <RecordMessages
                  recordId={record.id}
                  resolvedAt={record.messages_resolved_at}
                  resolvedByName={record.messages_resolved_by_name}
                />
              </div>

              {/* Timestamps, unlabelled, immediately before the history they explain. */}
              <div style={{ marginTop: 14 }}>
                {TIME_FIELDS
                  .map(([k, label]) => [k, label, fmt(k, record[k])])
                  .filter(([, , v]) => showEmpty || v !== null)
                  .map(([k, label, v]) => (
                    <Row
                      key={k}
                      label={label}
                      value={
                        <>
                          {v ?? <span className="td-muted">—</span>}
                          {k === 'created_at' && record.status === 'pending' && (
                            <AgeClock at={record.created_at} style={{ marginLeft: 8 }} />
                          )}
                        </>
                      }
                    />
                  ))}
              </div>

              {/* Audit history — background detail, so it gets a quiet heading
                  and the smallest type in the popup. */}
              <div style={{ marginTop: 14, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
                <div className="note" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>History</div>
                {events === null ? <div className="note" style={{ fontSize: 11 }}><span className="spinner spinner-dark" /> Loading…</div>
                 : !events.length ? <div className="note" style={{ fontSize: 11 }}>No history yet.</div>
                 : (
                  <ol style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {events.map(ev => (
                      <li key={ev.id} style={{ marginBottom: 2 }}>
                        {ev.from_status || '—'} → <strong>{ev.to_status}</strong>
                        {' · '}{ev.by_user_name}
                        {' · '}{new Date(ev.at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {ev.note && <span> · “{ev.note}”</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
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
