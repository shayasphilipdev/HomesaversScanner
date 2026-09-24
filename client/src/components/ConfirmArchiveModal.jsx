import { useEffect } from 'react'

// Confirmation for ARCHIVE — the action that replaced both "Clear" and, for
// everyone but an admin, "Delete".
//
// Deliberately NOT styled like ConfirmDeleteModal. That one is red, alarming and
// says "this cannot be undone", because it is true there. Archiving is
// reversible and keeps the record readable for the rest of its retention
// window, so dressing it in the same red would train people to click through
// warnings — and the next warning they click through is the permanent one.
//
// Its whole job is to answer the two questions a store actually has: how long
// will this be kept, and how do I get it back.
//
// Props:
//   open        — show/hide
//   count       — how many records (defaults to 1)
//   busy        — disables buttons and shows a spinner while the request runs
//   totalDays   — full retention window, live + archive, from /app-config
//   liveDays    — the live half, used for the detail line
//   onConfirm / onCancel
export default function ConfirmArchiveModal({
  open, count = 1, busy = false, totalDays, liveDays, onConfirm, onCancel,
}) {
  // Esc closes (but never confirms).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  const many = count > 1

  // Phrased in whole weeks when it divides cleanly, because "7 weeks" is the
  // number the business uses and the one a store will remember. Falls back to
  // days rather than rounding to a week that is not true.
  const period = (() => {
    if (!totalDays || totalDays < 1) return null
    if (totalDays % 7 === 0) {
      const w = totalDays / 7
      return w === 1 ? '1 week' : `${w} weeks`
    }
    return `${totalDays} days`
  })()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm archive"
      onMouseDown={() => { if (!busy) onCancel?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(17, 27, 51, .55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--surface, #fff)',
          border: '2px solid #2E78D6',
          borderRadius: 14,
          boxShadow: '0 20px 50px rgba(0,0,0,.35)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          background: 'linear-gradient(135deg, #2E78D6 0%, #1c5196 100%)',
          color: '#fff', padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 22 }} aria-hidden>📦</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            Archive {many ? `${count} records` : 'this record'}?
          </span>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 14, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
            {many ? `These ${count} records` : 'This record'} will move out of your
            everyday lists{period ? <> and be kept for <strong>{period}</strong></> : ''}.
          </p>

          <div style={{
            fontSize: 13, margin: '12px 0 0', padding: '10px 12px',
            background: 'rgba(46,120,214,.07)', border: '1px solid rgba(46,120,214,.25)',
            borderRadius: 8, color: 'var(--text)', lineHeight: 1.5,
          }}>
            To see {many ? 'them' : 'it'} again, go to <strong>Reports</strong> and
            tick <strong>Archived</strong>.
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
            Nothing is lost — archiving can be undone from the record itself.
            {liveDays ? ` Records stay in your live lists for ${liveDays} days before this happens automatically.` : ''}
          </p>

          <div className="flex-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{
                background: '#2E78D6', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 16px', fontWeight: 700,
                fontSize: 14, cursor: busy ? 'default' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, opacity: busy ? .75 : 1,
              }}
            >
              {busy ? <><span className="spinner" /> Archiving…</> : `📦 Archive${many ? ` ${count}` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
