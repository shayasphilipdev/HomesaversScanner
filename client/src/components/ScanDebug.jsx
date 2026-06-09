import { useEffect, useState } from 'react'

// TEMPORARY diagnostic. Shows the raw key events the scanner emits and which
// element is focused at scan time. Hidden unless the URL has ?scandebug=1.
// Open HO Tasks as  …/tasks?scandebug=1  , scan once, screenshot the black box.
export default function ScanDebug() {
  const on = typeof window !== 'undefined' &&
             new URLSearchParams(window.location.search).has('scandebug')
  const [log, setLog] = useState([])

  useEffect(() => {
    if (!on) return
    const onKey = (e) => {
      const el  = document.activeElement
      const tag = el?.tagName || 'BODY'
      const id  = el?.id ? `#${el.id}` : ''
      setLog(l => [
        ...l.slice(-30),
        `key="${e.key}" kc=${e.keyCode} code="${e.code}" focus=${tag}${id}`
      ])
    }
    // Capture phase so we see every event, even if something else stops it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [on])

  if (!on) return null

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: 180,
      overflowY: 'auto', background: '#111', color: '#0f0',
      fontFamily: 'monospace', fontSize: 12, lineHeight: 1.4, padding: 8, zIndex: 99999
    }}>
      <div style={{ color: '#fff', marginBottom: 4 }}>
        SCAN DEBUG — scan once, then screenshot this box:
      </div>
      {log.length === 0
        ? <div style={{ color: '#888' }}>(waiting for a scan…)</div>
        : log.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}
