import { useEffect, useState } from 'react'
import { getTaskRecordEvents, getProductMaster } from '../lib/api.js'
import { TASK_FORMS } from '../lib/taskTypes.js'

// Everything known about one task record, in one place.
//
// The report grid can only show a handful of columns, and the Excel export is
// the only other way to see the rest — which means opening a spreadsheet to
// answer "what else do we know about this one?". This shows the full record,
// its task-specific details blob, the live Product Master entry for the same
// barcode, and the audit history.
//
// Props: record (a row already loaded by the report), storeName, open, onClose.

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
      ['review_notes',        'HO Notes'],
      ['source',              'Source'],
      ['marked_for_deletion', 'Marked for deletion'],
    ],
  },
  {
    title: 'Timestamps',
    fields: [
      ['created_at',         'Created'],
      ['updated_at',         'Updated'],
      ['reviewed_at',        'Reviewed'],
      ['completed_at',       'Completed by HO'],
      ['store_completed_at', 'Store confirmed'],
      ['cleared_at',         'Cleared'],
      ['priced_at',          'Priced'],
      ['pricing_removed_at', 'Pricing removed'],
    ],
  },
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
      <div className="note" style={{ flex: '0 0 42%', fontSize: 12.5 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, wordBreak: 'break-word', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>
        {value}
      </div>
    </div>
  )
}

export default function RecordDetailModal({ record, storeName, open, onClose }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const [events, setEvents]       = useState(null)
  const [pm, setPm]               = useState(null)
  const [pmErr, setPmErr]         = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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

  return (
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
        style={{ width: '100%', maxWidth: 760, marginBottom: 40 }}
      >
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>{TASK_FORMS[record.task_type]?.name || record.task_type}</strong>
          <span className="note" style={{ fontSize: 12.5 }}>
            {record.item_name || record.description || record.product_name_label || '(no description)'}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <label className="note" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} />
            Show empty fields
          </label>
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕ Close</button>
        </div>

        <div className="card-body" style={{ paddingTop: 10 }}>
          {storeName && <Row label="Store" value={storeName} />}

          {GROUPS.map(g => {
            const rows = g.fields
              .map(([k, label]) => [k, label, fmt(k, record[k])])
              .filter(([, , v]) => showEmpty || v !== null)
            if (!rows.length) return null
            return (
              <div key={g.title} style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {g.title}
                </div>
                {rows.map(([k, label, v]) => (
                  <Row key={k} label={label} value={v ?? <span className="td-muted">—</span>}
                       mono={k === 'barcode_no' || k === 'product_barcode' || k === 'product_code'} />
                ))}
              </div>
            )
          })}

          {/* Task-specific payload — shape varies by task type. */}
          {(detailKeys.length > 0 || showEmpty) && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 4 }}>
                Task details
              </div>
              {detailKeys.length === 0
                ? <div className="note" style={{ fontSize: 12.5 }}>None recorded.</div>
                : detailKeys.map(k => (
                    <Row key={k} label={prettyKey(k)}
                         value={typeof details[k] === 'object' ? JSON.stringify(details[k]) : String(details[k])} />
                  ))}
            </div>
          )}

          {/* Photos */}
          {(record.photo_product_url || record.photo_barcode_url) && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 6 }}>
                Photos
              </div>
              <div className="flex-row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {[['Product', record.photo_product_url], ['Barcode', record.photo_barcode_url]]
                  .filter(([, u]) => u)
                  .map(([lbl, u]) => (
                    <a key={lbl} href={u} target="_blank" rel="noopener noreferrer" title={`Open ${lbl} photo`}>
                      <img src={u} alt={lbl} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                      <span className="note" style={{ fontSize: 12 }}>{lbl}</span>
                    </a>
                  ))}
              </div>
            </div>
          )}

          {/* Live Product Master — not stored on the record. */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 4 }}>
              Product Master <span className="note" style={{ textTransform: 'none', letterSpacing: 0 }}>(current, not a snapshot)</span>
            </div>
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

          {/* Audit history */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 4 }}>
              History
            </div>
            {events === null ? <div className="note" style={{ fontSize: 12.5 }}><span className="spinner spinner-dark" /> Loading…</div>
             : !events.length ? <div className="note" style={{ fontSize: 12.5 }}>No history yet.</div>
             : (
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {events.map(ev => (
                  <li key={ev.id} style={{ marginBottom: 4 }}>
                    <strong>{ev.from_status || '—'} → {ev.to_status}</strong>
                    <span className="td-muted" style={{ marginLeft: 6 }}>
                      by {ev.by_user_name} · {new Date(ev.at).toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {ev.note && <div className="note" style={{ fontSize: 12.5 }}>“{ev.note}”</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
