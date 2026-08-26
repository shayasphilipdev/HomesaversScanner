import { useEffect } from 'react'
import RecordMessages from './RecordMessages.jsx'

// Wide modal wrapper for the per-record message thread.
// Replaces the old inline table-row expansion so messages have room to breathe.
//
// Props:
//   record          — the full task record object (for the header)
//   onClose         — called on × / backdrop / Escape
//   onUnreadChange  — forwarded to RecordMessages

const TASK_NAMES = {
  A: 'UOM Errors', B: 'Non-Scans', C: 'Wrong Prices', D: 'Wrong Description',
  E: 'Price Marked Products', F: 'DRS Errors', G: 'Promotion Error',
  H: 'Stock Count', I: 'Miscellaneous', J: 'Department Check',
  K: 'Price Check', L: 'Expiry Date Check'
}

export default function MessagesModal({ record, onClose, onUnreadChange }) {
  // Esc closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!record) return null

  const taskName   = TASK_NAMES[record.task_type] || record.task_type || 'Task'
  const barcode    = record.barcode_no || record.product_code || '—'
  const desc       = record.item_name || record.description || record.product_name_label || ''
  const msgCount   = record.message_count || 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Record messages"
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(17, 27, 51, .50)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 760,
          maxHeight: '92vh',
          background: 'var(--surface, #fff)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          background: 'var(--primary, #2563eb)',
          color: '#fff',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0
        }}>
          <span style={{ fontSize: 18 }}>💬</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {taskName} · <span style={{ fontFamily: 'monospace', fontSize: 14 }}>{barcode}</span>
            </div>
            {desc && (
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {desc}
              </div>
            )}
            {msgCount > 0 && (
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 1 }}>
                {msgCount} message{msgCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'rgba(255,255,255,.18)', border: 'none',
              color: '#fff', borderRadius: 8, width: 32, height: 32,
              fontSize: 18, cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >×</button>
        </div>

        {/* Message thread — scrollable, fills available height */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <RecordMessages
            recordId={record.id}
            onUnreadChange={onUnreadChange}
            listMaxHeight={440}
          />
        </div>
      </div>
    </div>
  )
}
