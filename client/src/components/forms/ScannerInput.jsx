import { useEffect, useRef, useState } from 'react'

const CAMERA_CONFIRM_COUNT = 3
const CAMERA_MIN_LENGTH    = 4
const CAMERA_MAX_LENGTH    = 80

// A reusable barcode / code input.
// - Captures rapid keystrokes from an HID scanner gun (when no input focused)
// - Optional camera scan (lazy-loads html5-qrcode)
// - Optional onConfirm callback (called on Enter or camera confirmation)
// - Optional lookupLoading flag shows a spinner inside the input
//
// Props:
//   value, onChange, label, placeholder
//   onConfirm(value)       — fired by Enter, scanner gun, or camera confirm
//   lookupLoading          — show a spinner inside the input
//   readerId               — DOM id for the camera reader div (unique per form)
export default function ScannerInput({
  value, onChange, label, placeholder = 'Scan or type…',
  onConfirm, lookupLoading,
  readerId = 'reader'
}) {
  const inputRef   = useRef(null)
  const scannerRef = useRef(null)
  const [cameraOn, setCameraOn]         = useState(false)
  const [cameraStatus, setCameraStatus] = useState('')

  // Scanner gun keystroke buffer — global
  useEffect(() => {
    let buffer = '', timer = null
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          onChange(buffer)
          onConfirm?.(buffer)
          inputRef.current?.focus()
        }
        buffer = ''
        clearTimeout(timer)
      } else if (e.key.length === 1) {
        buffer += e.key
        clearTimeout(timer)
        timer = setTimeout(() => { buffer = '' }, 300)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onChange, onConfirm])

  // Camera scanner — lazy-loaded
  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false, candidate = '', candidateN = 0
    ;(async () => {
      try {
        setCameraStatus('Loading camera library…')
        const mod = await import('html5-qrcode')
        if (cancelled) return
        const Html5Qrcode = mod.Html5Qrcode || mod.default?.Html5Qrcode
        const scanner = new Html5Qrcode(readerId)
        scannerRef.current = scanner
        setCameraStatus('Requesting camera permission…')
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 5, qrbox: { width: 260, height: 140 } },
          (decoded) => {
            const code = String(decoded || '').trim()
            if (code.length < CAMERA_MIN_LENGTH || code.length > CAMERA_MAX_LENGTH) return
            if (code === candidate) candidateN += 1
            else { candidate = code; candidateN = 1 }
            setCameraStatus(`Reading: ${code} (${candidateN}/${CAMERA_CONFIRM_COUNT})`)
            if (candidateN >= CAMERA_CONFIRM_COUNT) {
              onChange(code)
              onConfirm?.(code)
              setCameraStatus('Saved code — close camera or scan another.')
              candidate = ''
              candidateN = 0
            }
          },
          () => {}
        )
        setCameraStatus('Point the box at a barcode.')
      } catch (e) {
        setCameraStatus(cameraErrorMessage(e))
      }
    })()
    return () => {
      cancelled = true
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          try { scannerRef.current.clear() } catch {}
          scannerRef.current = null
        })
      }
    }
  }, [cameraOn, onChange, onConfirm, readerId])

  return (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text" className="scan-input" autoComplete="off" spellCheck={false}
          value={value} onChange={e => onChange(e.target.value)}
          onBlur={() => onConfirm?.(value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onConfirm?.(value) } }}
          placeholder={placeholder}
        />
        {lookupLoading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
            <span className="spinner spinner-dark" />
          </span>
        )}
      </div>
      <div className="flex-row" style={{ gap: 8, marginTop: 6 }}>
        <button
          type="button"
          className={`btn btn-sm ${cameraOn ? 'btn-danger' : 'btn-outline'}`}
          onClick={() => setCameraOn(v => !v)}
        >
          {cameraOn ? '✕ Stop camera' : '📷 Use camera'}
        </button>
        <span className="note" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Scanner gun and typing work without enabling the camera.
        </span>
      </div>
      {cameraOn && (
        <div className="mt-12">
          <div id={readerId} style={{ width: '100%', maxWidth: 480, minHeight: 240, background: '#eee', borderRadius: 10, overflow: 'hidden' }} />
          <div className="note mt-12" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {cameraStatus || 'Starting camera…'}
          </div>
        </div>
      )}
    </div>
  )
}

function cameraErrorMessage(error) {
  const text = String((error && (error.name || error.message)) || error || 'Unknown error')
  if (/NotAllowed|Permission|denied/i.test(text))       return 'Camera permission denied. Allow camera for this site in your browser.'
  if (/NotFound|DevicesNotFound|no camera/i.test(text)) return 'No camera found on this device.'
  if (/NotReadable|TrackStart|busy/i.test(text))        return 'Camera is busy. Close other apps using the camera.'
  if (/Overconstrained|Constraint/i.test(text))         return 'Back camera could not start — try refreshing.'
  return 'Camera could not start: ' + text
}
