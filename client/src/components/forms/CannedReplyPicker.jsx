import { useEffect, useRef, useState } from 'react'
import { getLookupOptions } from '../../lib/api.js'

// A dropdown of reusable reply text ("canned replies") that inserts the chosen
// line at the caret position of a given textarea — replacing the current
// selection if there is one, otherwise inserting at the cursor. Matches the
// standard "insert snippet" behaviour rather than always appending to the end,
// so a reply can be built up from more than one canned line.
//
// Backed by lookup_options (kind='canned_reply') — the same admin-editable
// pick-list mechanism the app already uses for reason codes / categories, so
// no new table and no new admin screen are needed; HQ can add/retire replies
// from Admin → Lookups like any other list.
//
// Props:
//   textareaRef — ref to the <textarea> the picker inserts into
//   value       — the textarea's current value (controlled)
//   onChange    — (nextValue) => void, called with the value after insertion
export default function CannedReplyPicker({ textareaRef, value, onChange, disabled }) {
  const [open, setOpen]     = useState(false)
  const [items, setItems]   = useState(null)   // null = not loaded yet
  const [err, setErr]       = useState('')
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open || items !== null) return
    getLookupOptions({ kind: 'canned_reply' })
      .then(rows => setItems(rows.map(r => r.label)))
      .catch(e => setErr(e.message || 'Could not load canned replies'))
  }, [open, items])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const insert = (text) => {
    const el = textareaRef?.current
    if (!el) { onChange((value ? value + ' ' : '') + text); setOpen(false); return }

    const start = el.selectionStart ?? value.length
    const end   = el.selectionEnd   ?? value.length
    // A tidy join: don't glue the snippet onto an existing word with no space,
    // and don't leave a double space either.
    const before = value.slice(0, start)
    const after  = value.slice(end)
    const needsSpaceBefore = before.length > 0 && !/\s$/.test(before)
    const needsSpaceAfter  = after.length  > 0 && !/^\s/.test(after)
    const insertion = (needsSpaceBefore ? ' ' : '') + text + (needsSpaceAfter ? ' ' : '')
    const next = before + insertion + after
    onChange(next)
    setOpen(false)

    // Put the caret right after the inserted text, on the next paint (the
    // textarea's value has to update first or the browser clamps the
    // selection to the old, shorter string).
    const caret = before.length + insertion.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', alignSelf: 'flex-end' }}>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title="Insert a canned reply at the cursor"
      >
        📋 Canned ▾
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Canned replies"
          style={{
            position: 'absolute', bottom: '110%', right: 0, zIndex: 40,
            width: 300, maxHeight: 260, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)', padding: 4,
          }}
        >
          {items === null && !err && (
            <div className="note" style={{ padding: 10, fontSize: 12.5 }}><span className="spinner spinner-dark" /> Loading…</div>
          )}
          {err && <div className="login-error" style={{ margin: 6, fontSize: 12.5 }}>{err}</div>}
          {items !== null && items.length === 0 && (
            <div className="note" style={{ padding: 10, fontSize: 12.5 }}>
              No canned replies yet. Add some in Admin → Lookups (kind: canned_reply).
            </div>
          )}
          {items?.map((text, i) => (
            <button
              key={i}
              type="button"
              role="option"
              onClick={() => insert(text)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: 'transparent', border: 'none', borderRadius: 6,
                padding: '7px 9px', fontSize: 12.5, lineHeight: 1.4,
                cursor: 'pointer', color: 'var(--text)',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-soft)'}
              onMouseOut={e  => e.currentTarget.style.background = 'transparent'}
              title="Click to insert at the cursor"
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
