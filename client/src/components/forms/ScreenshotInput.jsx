import { useState } from 'react'
import { canCaptureScreen, captureScreen, imageFromDataTransfer, isDesktopPointer } from '../../lib/screenshot.js'

// Desktop-only strip that sits under a photo field and adds two ways to attach
// what is on screen — pasting a snip, or capturing a screen directly.
// Renders nothing on phones, where the camera already covers this.
//
// onImage(fileOrBlob) receives the picture; the caller compresses and uploads it
// exactly as it would a file chosen from disk.
export default function ScreenshotInput({ onImage, disabled, compact }) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [armed, setArmed] = useState(false)   // zone focused → ready for Ctrl+V
  const [hover, setHover] = useState(false)

  // Phones keep the camera; nothing here would work for them.
  if (!isDesktopPointer()) return null

  const showCapture = canCaptureScreen()

  const hand = (file) => {
    if (!file) return
    setError('')
    onImage(file)
  }

  const onPaste = (e) => {
    const file = imageFromDataTransfer(e.clipboardData)
    if (!file) { setError('That clipboard item is not an image.'); return }
    e.preventDefault()
    hand(file)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setHover(false)
    const file = imageFromDataTransfer(e.dataTransfer)
    if (!file) { setError('That file is not an image.'); return }
    hand(file)
  }

  const doCapture = async () => {
    setBusy(true); setError('')
    try {
      const blob = await captureScreen()
      if (blob) hand(blob)          // null = user cancelled the picker; stay quiet
    } catch (e) {
      setError(e.message || 'Screen capture failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div
        tabIndex={0}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setHover(true) }}
        onDragLeave={() => setHover(false)}
        onFocus={() => setArmed(true)}
        onBlur={() => setArmed(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: compact ? '6px 9px' : '8px 11px',
          border: `1px dashed ${armed || hover ? 'var(--primary, #2563eb)' : 'var(--border)'}`,
          background: armed || hover ? 'var(--surface-warm)' : 'transparent',
          borderRadius: 8, cursor: 'text', outline: 'none',
          transition: 'border-color .12s, background .12s'
        }}
        title="Click here, then press Ctrl+V to paste a screenshot"
      >
        <span aria-hidden style={{ fontSize: 14 }}>🖼️</span>
        <span className="note" style={{ fontSize: 12, flex: 1, minWidth: 150, lineHeight: 1.4 }}>
          {armed
            ? <>Ready — press <strong>Ctrl+V</strong> to paste your screenshot.</>
            : <>Snip with <strong>Win+Shift+S</strong>, click here and press <strong>Ctrl+V</strong> — or drop an image.</>}
        </span>

        {showCapture && (
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={doCapture}
            disabled={disabled || busy}
            style={{ whiteSpace: 'nowrap' }}
            title="Pick a screen or window to capture"
          >
            {busy ? <><span className="spinner spinner-dark" /> Capturing…</> : '🖥 Capture screen'}
          </button>
        )}
      </div>

      {error && (
        <div className="note" style={{ fontSize: 12, marginTop: 4, color: 'var(--red, #c0392b)' }}>{error}</div>
      )}
    </div>
  )
}
