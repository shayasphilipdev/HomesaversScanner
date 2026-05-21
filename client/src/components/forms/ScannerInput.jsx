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
  // Keep the latest callbacks in refs. The parent passes new function
  // identities on every render (e.g. t.update('code')); without this the
  // camera effect below would tear down and restart the scanner on every
  // keystroke / state change — which crashes html5-qrcode mid-scan and
  // blanks the screen.
  const onChangeRef  = useRef(onChange)
  const onConfirmRef = useRef(onConfirm)
  onChangeRef.current  = onChange
  onConfirmRef.current = onConfirm

  const [cameraOn, setCameraOn]         = useState(false)
  const [cameraStatus, setCameraStatus] = useState('')
  const [zoom, setZoom]                 = useState(2)      // default 2× — barcodes are small
  const [zoomCaps, setZoomCaps]         = useState(null)   // {min,max,step} when supported
  const [torchOn, setTorchOn]           = useState(false)
  const [torchCap, setTorchCap]         = useState(false)
  // Chain-wide toggle (Admin → Settings). Stores use a scanner gun 99% of
  // the time, so the camera button is hidden unless an admin turns it on.
  const cameraEnabled = localStorage.getItem('hs_camera_enabled') === '1'

  // Scanner gun keystroke buffer — global
  useEffect(() => {
    let buffer = '', timer = null
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          onChangeRef.current(buffer)
          onConfirmRef.current?.(buffer)
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
    // Refs keep the latest callbacks; the listener attaches once.
  }, [])

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
        const Formats     = mod.Html5QrcodeSupportedFormats || mod.default?.Html5QrcodeSupportedFormats || {}

        // Restrict to the retail 1-D symbologies. Fewer formats = the decoder
        // does far less work per frame and is much less likely to misread.
        const formatsToSupport = [
          Formats.EAN_13, Formats.EAN_8, Formats.UPC_A, Formats.UPC_E,
          Formats.CODE_128, Formats.CODE_39, Formats.ITF
        ].filter(f => f !== undefined)

        // Constructor config — only pass formatsToSupport when we actually
        // resolved the enum (an empty array makes the constructor throw).
        const ctorConfig = {
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false
        }
        if (formatsToSupport.length) ctorConfig.formatsToSupport = formatsToSupport

        const scanner = new Html5Qrcode(readerId, ctorConfig)
        scannerRef.current = scanner
        setCameraStatus('Requesting camera permission…')

        // Minimal, widely-supported start config. The previous version passed
        // a videoConstraints object with focusMode keys that threw a
        // TypeError on some browsers; focus/zoom are now applied AFTER start
        // via the live track instead.
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            // Small, landscape "region of interest" — html5-qrcode only
            // decodes inside this box, so a barcode reads only when centred,
            // and the small box nudges users to hold the phone close.
            qrbox: { width: 240, height: 130 },
            aspectRatio: 1.777
          },
          (decoded) => {
            try {
              const code = String(decoded || '').trim()
              if (code.length < CAMERA_MIN_LENGTH || code.length > CAMERA_MAX_LENGTH) return
              if (code === candidate) candidateN += 1
              else { candidate = code; candidateN = 1 }
              setCameraStatus(`Reading: ${code} (${candidateN}/${CAMERA_CONFIRM_COUNT})`)
              if (candidateN >= CAMERA_CONFIRM_COUNT) {
                onChangeRef.current(code)
                onConfirmRef.current?.(code)
                if (navigator.vibrate) navigator.vibrate(60)   // haptic confirm
                setCameraStatus('Saved code — close camera or scan another.')
                candidate = ''
                candidateN = 0
              }
            } catch { /* never let a decode callback crash the app */ }
          },
          () => {}
        )
        setCameraStatus('Hold the barcode inside the box.')

        // Inspect the live track for zoom + torch capabilities and apply the
        // default zoom. Not all devices/browsers expose these (iOS Safari
        // notably does not support zoom), so guard everything.
        // Give the video a moment to attach, then read the track's
        // capabilities for zoom + torch and apply a sensible default zoom.
        setTimeout(async () => {
          const rawTrack = getRawTrack(readerId)
          if (!rawTrack) return
          const tcaps = rawTrack.getCapabilities?.() || {}
          // Continuous autofocus where the browser supports it (guarded — an
          // unsupported constraint here is what caused the original error).
          if (Array.isArray(tcaps.focusMode) && tcaps.focusMode.includes('continuous')) {
            await rawTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
          }
          if (tcaps.zoom) {
            const min = tcaps.zoom.min ?? 1, max = tcaps.zoom.max ?? 5, step = tcaps.zoom.step ?? 0.1
            setZoomCaps({ min, max, step })
            const z = Math.min(Math.max(2, min), max)   // default 2× (clamped)
            await rawTrack.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
            setZoom(z)
          }
          if (tcaps.torch) setTorchCap(true)
        }, 600)
      } catch (e) {
        setCameraStatus(cameraErrorMessage(e))
      }
    })()
    return () => {
      cancelled = true
      setTorchOn(false); setZoomCaps(null); setTorchCap(false)
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          try { scannerRef.current.clear() } catch {}
          scannerRef.current = null
        })
      }
    }
    // Only re-run when the camera is toggled — NOT when callback identities
    // change. The refs above always hold the latest onChange/onConfirm.
  }, [cameraOn, readerId])

  // Apply a zoom level to the live camera track.
  const applyZoom = async (z) => {
    setZoom(z)
    const track = getRawTrack(readerId)
    if (track) await track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
  }

  // Toggle the torch / flash if the device supports it.
  const toggleTorch = async () => {
    const track = getRawTrack(readerId)
    if (!track) return
    const next = !torchOn
    await track.applyConstraints({ advanced: [{ torch: next }] }).catch(() => {})
    setTorchOn(next)
  }

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
      {cameraEnabled && (
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
      )}
      {cameraEnabled && cameraOn && (
        <div className="mt-12">
          {/* Smaller viewport so the user holds the phone close → sharper focus. */}
          <div id={readerId} style={{ width: '100%', maxWidth: 320, minHeight: 200, background: '#eee', borderRadius: 10, overflow: 'hidden', margin: '0 auto' }} />

          <div className="flex-row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
            {zoomCaps && (
              <label className="flex-row" style={{ gap: 6, fontSize: 12, alignItems: 'center' }}>
                🔍
                <input
                  type="range"
                  min={zoomCaps.min} max={zoomCaps.max} step={zoomCaps.step}
                  value={zoom}
                  onChange={e => applyZoom(Number(e.target.value))}
                  style={{ width: 120 }}
                />
                <span style={{ width: 34 }}>{zoom.toFixed(1)}×</span>
              </label>
            )}
            {torchCap && (
              <button type="button" className={`btn btn-sm ${torchOn ? 'btn-primary' : 'btn-outline'}`} onClick={toggleTorch}>
                {torchOn ? '🔦 Light on' : '🔦 Light'}
              </button>
            )}
          </div>

          <div className="note mt-12" style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            {cameraStatus || 'Starting camera…'}
          </div>
        </div>
      )}
    </div>
  )
}

// html5-qrcode renders a <video> inside the reader div. Reach into it to get
// the live MediaStreamTrack so we can apply zoom / torch constraints, which
// the library doesn't expose a stable API for across versions.
function getRawTrack(readerId) {
  try {
    const video = document.getElementById(readerId)?.querySelector('video')
    const stream = video?.srcObject
    return stream?.getVideoTracks?.()[0] || null
  } catch { return null }
}

function cameraErrorMessage(error) {
  const text = String((error && (error.name || error.message)) || error || 'Unknown error')
  if (/NotAllowed|Permission|denied/i.test(text))       return 'Camera permission denied. Allow camera for this site in your browser.'
  if (/NotFound|DevicesNotFound|no camera/i.test(text)) return 'No camera found on this device.'
  if (/NotReadable|TrackStart|busy/i.test(text))        return 'Camera is busy. Close other apps using the camera.'
  if (/Overconstrained|Constraint/i.test(text))         return 'Back camera could not start — try refreshing.'
  return 'Camera could not start: ' + text
}
