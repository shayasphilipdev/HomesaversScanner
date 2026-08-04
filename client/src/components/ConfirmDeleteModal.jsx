import { useEffect } from 'react'

// Strong, deliberately alarming confirmation for a PERMANENT delete.
// Unlike "Clear" (a reversible soft-archive), delete removes the record from the
// database for good — so this modal is red, spells out that it cannot be undone,
// and never auto-focuses the destructive button.
//
// Props:
//   open      — show/hide
//   count     — how many records will be deleted (defaults to 1)
//   busy      — disables buttons + shows a spinner while the request runs
//   onConfirm — called when the user confirms the permanent delete
//   onCancel  — called on Cancel / backdrop click / Esc
export default function ConfirmDeleteModal({ open, count = 1, busy = false, onConfirm, onCancel }) {
  // Esc closes (but never confirms).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  const many = count > 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm permanent delete"
      onMouseDown={() => { if (!busy) onCancel?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(17, 27, 51, .55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--surface, #fff)',
          border: '2px solid #C0392B',
          borderRadius: 14,
          boxShadow: '0 20px 50px rgba(0,0,0,.35)',
          overflow: 'hidden'
        }}
      >
        {/* Red header */}
        <div style={{
          background: 'linear-gradient(135deg, #C0392B 0%, #96271b 100%)',
          color: '#fff', padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span style={{ fontSize: 22 }} aria-hidden>⚠️</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            Permanently delete {many ? `${count} records` : 'this record'}?
          </span>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 14, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
            This will <strong style={{ color: '#C0392B' }}>permanently delete</strong>{' '}
            {many ? `these ${count} records` : 'this record'} from the database.
          </p>
          <p style={{
            fontSize: 13.5, margin: '10px 0 0', lineHeight: 1.5,
            color: '#C0392B', fontWeight: 600
          }}>
            This cannot be undone — there is no way to get {many ? 'them' : 'it'} back.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
            This is different from <strong>Clear</strong>, which only archives the record. Delete removes it for good.
          </p>

          <div style={{
            fontSize: 12.5, margin: '12px 0 0', padding: '8px 10px',
            background: 'rgba(192,57,43,.07)', border: '1px solid rgba(192,57,43,.25)',
            borderRadius: 8, color: 'var(--text)'
          }}>
            Date of deletion: <strong>{new Date().toLocaleString('en-IE', {
              day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            })}</strong>
          </div>

          <div className="flex-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{
                background: '#C0392B', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 16px', fontWeight: 700,
                fontSize: 14, cursor: busy ? 'default' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, opacity: busy ? .75 : 1
              }}
            >
              {busy ? <><span className="spinner" /> Deleting…</> : `🗑 Delete ${many ? `${count} ` : ''}permanently`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
