import { useEffect, useRef, useState } from 'react'

// Combo dropdown + checkbox list. Replaces large chip rows when there's
// more than a handful of options. Empty `value` means "no filter" — the
// "All …" toggle at the top simply clears the array.
//
// Props:
//   value:      string[] of selected ids
//   onChange:   (next: string[]) => void
//   options:    [{ id, label, subLabel? }]
//   allLabel:   text for the top "All" row (default "All")
//   searchable: show a quick-filter text input (default true if options >= 8)
//   placeholder string shown when value is empty
export default function MultiSelectDropdown({
  value, onChange, options,
  allLabel = 'All',
  searchable,
  placeholder = 'None selected'
}) {
  const ids = Array.isArray(value) ? value : []
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const showSearch = searchable ?? options.length >= 8
  const filtered = q
    ? options.filter(o => (o.label + ' ' + (o.subLabel || '')).toLowerCase().includes(q.toLowerCase()))
    : options

  const allOn = ids.length === 0
  const summary = allOn
    ? allLabel
    : ids.length === 1
      ? (options.find(o => o.id === ids[0])?.label || '1 selected')
      : `${ids.length} selected`

  const toggle = (id) => {
    onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="btn btn-outline btn-sm"
        style={{
          width: '100%', justifyContent: 'space-between',
          display: 'flex', alignItems: 'center', gap: 8,
          textAlign: 'left', minHeight: 38, paddingRight: 12
        }}
        aria-expanded={open}
      >
        <span style={{ color: allOn ? 'var(--text-muted)' : 'var(--text)' }}>
          {summary || placeholder}
        </span>
        <span aria-hidden style={{ marginLeft: 'auto', fontSize: 12 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div style={{
          marginTop: 6,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-md)',
          maxHeight: 320, overflow: 'auto', padding: 4
        }}>
          {showSearch && (
            <input
              autoFocus
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search…"
              style={{ width: '100%', marginBottom: 4, padding: '6px 8px', fontSize: 13 }}
            />
          )}

          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: allOn ? 'var(--bg-soft)' : 'transparent',
              fontSize: 13, fontWeight: 600
            }}
            onMouseOver={e => { if (!allOn) e.currentTarget.style.background = 'var(--bg-soft)' }}
            onMouseOut={e  => { if (!allOn) e.currentTarget.style.background = 'transparent' }}
          >
            <input
              type="checkbox"
              checked={allOn}
              onChange={() => onChange([])}
            />
            <span>{allLabel}</span>
          </label>

          <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }} />

          {filtered.length === 0 && (
            <div className="note" style={{ padding: '8px 10px', fontSize: 12.5 }}>
              No matches.
            </div>
          )}

          {filtered.map(o => {
            const on = ids.includes(o.id)
            return (
              <label
                key={o.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  background: on ? 'var(--bg-soft)' : 'transparent', fontSize: 13
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
