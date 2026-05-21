import { useEffect, useRef, useState } from 'react'

// Plain checkbox dropdown.
//   * Trigger button with current selection summary.
//   * Open: "Select all" + "Clear all" buttons on top, optional search,
//     then a flat list of options with a checkbox on the LEFT of each row.
//   * Empty selection means nothing is selected -- the caller decides how
//     to interpret that (e.g., "no filter applied", "require at least one
//     before submit").
//   * Closes on outside click. List is internally scrollable when long.
//
// Props:
//   value:        string[] of selected ids
//   onChange:     (next: string[]) => void
//   options:      [{ id, label, subLabel? }]
//   placeholder:  text when nothing selected (default "Nothing selected")
//   searchable:   force search input on/off (default: auto when 8+ options)
export default function MultiSelectDropdown({
  value, onChange, options,
  placeholder = 'Nothing selected',
  searchable
}) {
  const ids = Array.isArray(value) ? value : []
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState('')
  const [rect, setRect] = useState(null)   // trigger position for the fixed panel
  const wrapRef = useRef(null)
  const btnRef  = useRef(null)

  // Recompute the panel's screen position from the trigger button. Using
  // position:fixed means no ancestor's overflow:hidden/auto can clip the
  // panel (which is what was locking it inside the Reports card).
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width })
  }

  useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onMove = () => place()   // keep it anchored while scrolling / resizing
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const showSearch = searchable ?? options.length >= 8
  const filtered = q
    ? options.filter(o => (o.label + ' ' + (o.subLabel || '')).toLowerCase().includes(q.toLowerCase()))
    : options

  const toggle = (id) => {
    onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }
  // When a search filter is active, "Select all" only picks the visible
  // (filtered) rows -- the user should still be able to grab every option
  // in one click. selectEvery clears the search effect.
  const selectAll   = () => onChange(filtered.map(o => o.id))
  const selectEvery = () => onChange(options.map(o => o.id))
  const clearAll    = () => onChange([])

  const summary = ids.length === 0
    ? placeholder
    : ids.length === options.length
      ? `All ${options.length} selected`
      : ids.length === 1
        ? (options.find(o => o.id === ids[0])?.label || '1 selected')
        : `${ids.length} of ${options.length} selected`

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="btn btn-outline btn-sm"
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 8,
          textAlign: 'left', minHeight: 38, paddingRight: 12, paddingLeft: 12
        }}
        aria-expanded={open}
      >
        <span style={{
          color: ids.length === 0 ? 'var(--text-muted)' : 'var(--text)',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {summary}
        </span>
        <span aria-hidden style={{ fontSize: 12 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && rect && (
        <div style={{
          // Fixed + screen coordinates from the trigger: floats above the
          // page so no card overflow can clip or "lock" it.
          position: 'fixed', top: rect.top, left: rect.left,
          width: Math.max(rect.width, 220),
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-md)',
          maxHeight: 'min(360px, 60vh)', overflow: 'auto',
          zIndex: 1000
        }}>
          {/* Toolbar */}
          <div style={{
            display: 'flex', gap: 6, padding: 8,
            borderBottom: '1px solid var(--border-soft)', position: 'sticky', top: 0,
            background: 'var(--surface)'
          }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={selectAll}>
              ✓ Select all{q ? ` (filtered, ${filtered.length})` : ''}
            </button>
            {q && (
              <button type="button" className="btn btn-sm btn-outline" onClick={selectEvery} title="Select every option, including those hidden by the search filter">
                ✓ Select every ({options.length})
              </button>
            )}
            <button type="button" className="btn btn-sm btn-outline" onClick={clearAll}>
              ✕ Clear all
            </button>
          </div>

          {showSearch && (
            <div style={{ padding: 8, borderBottom: '1px solid var(--border-soft)' }}>
              <input
                autoFocus
                type="text"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
              />
            </div>
          )}

          {filtered.length === 0 && (
            <div className="note" style={{ padding: '10px 12px', fontSize: 12.5 }}>
              No matches.
            </div>
          )}

          {filtered.map(o => {
            const on = ids.includes(o.id)
            return (
              <label
                key={o.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                  background: on ? 'var(--bg-soft)' : 'transparent'
                }}
                onMouseOver={e => { if (!on) e.currentTarget.style.background = 'var(--bg-soft)' }}
                onMouseOut={e  => { if (!on) e.currentTarget.style.background = 'transparent' }}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(o.id)} />
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.subLabel && <span className="note" style={{ fontSize: 11 }}>{o.subLabel}</span>}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
