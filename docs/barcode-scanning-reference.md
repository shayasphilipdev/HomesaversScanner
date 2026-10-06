# Barcode Scanning Reference

Precise implementation notes for the `ScannerInput` component — useful as a
reference when building barcode scanning into another React app.

---

## Camera scanning

### Library and lazy-loading

```js
// Loaded only when the user taps the camera button — kept out of the main bundle
const mod = await import('html5-qrcode')
const Html5Qrcode = mod.Html5Qrcode || mod.default?.Html5Qrcode
const Formats     = mod.Html5QrcodeSupportedFormats || mod.default?.Html5QrcodeSupportedFormats || {}
```

The `|| mod.default?.…` guards handle both CJS and ESM builds of the library.

### Native BarcodeDetector preference

Delegated to html5-qrcode via a constructor flag — no manual detection needed:

```js
const ctorConfig = {
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  verbose: false
}
```

The library checks `'BarcodeDetector' in window` and uses the native API when
available (Chrome on Android, Edge). Falls through to its JS decoder automatically.

### Format restriction

```js
const formatsToSupport = [
  Formats.EAN_13, Formats.EAN_8, Formats.UPC_A, Formats.UPC_E,
  Formats.CODE_128, Formats.CODE_39, Formats.ITF
].filter(f => f !== undefined)

// Guard required — passing an empty array to the constructor throws
if (formatsToSupport.length) ctorConfig.formatsToSupport = formatsToSupport
```

Restricting to retail 1-D formats reduces work per frame and lowers the misread rate.

### Start config

```js
await scanner.start(
  { facingMode: 'environment' },
  {
    fps: 10,
    // qrbox as a FUNCTION — required (see lesson below)
    qrbox: (vw, vh) => {
      const w = Math.floor(Math.min(vw * 0.92, 260))
      const h = Math.floor(Math.min(vh * 0.7,  120))
      return { width: w, height: h }
    },
    aspectRatio: 1.333
  },
  onDecode,
  () => {}   // per-frame errors are not fatal; ignore them
)
```

`qrbox` must be a **function**, not a fixed size. A fixed pixel size is centred
in the full-resolution video stream, which the CSS-cropped viewfinder band then
hides — the scan box appears off-screen below the visible area. The callback
receives the actual rendered dimensions and sizes relative to them.

### Same-code-3-times confirmation

```js
const CAMERA_CONFIRM_COUNT = 3
const CAMERA_MIN_LENGTH    = 4
const CAMERA_MAX_LENGTH    = 80

let candidate = '', candidateN = 0

// inside the onDecode callback:
const code = String(decoded || '').trim()
if (code.length < CAMERA_MIN_LENGTH || code.length > CAMERA_MAX_LENGTH) return

if (code === candidate) candidateN += 1
else { candidate = code; candidateN = 1 }

if (candidateN >= CAMERA_CONFIRM_COUNT) {
  onChangeRef.current(code)
  confirmRef.current(code)
  if (navigator.vibrate) navigator.vibrate(60)   // 60 ms haptic pulse (Android only)
  candidate = ''; candidateN = 0   // reset — camera stays open for next scan
}
```

The camera stays open after a confirm. The user closes it manually.

### Haptics

```js
if (navigator.vibrate) navigator.vibrate(60)   // single 60 ms pulse
```

iOS Safari has never supported `navigator.vibrate`; the call is silently ignored.

### Zoom and torch via MediaStreamTrack

Applied **after** `scanner.start()` resolves, with a 600 ms delay to let the
video attach (applying constraints before the track is live throws a DOMException):

```js
setTimeout(async () => {
  const video = document.getElementById(readerId)?.querySelector('video')
  const track = video?.srcObject?.getVideoTracks?.()[0]
  if (!track) return

  const caps = track.getCapabilities?.() || {}

  // Autofocus — Android only; iOS Safari does not expose focusMode
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
  }

  // Zoom
  if (caps.zoom) {
    const { min = 1, max = 5, step = 0.1 } = caps.zoom
    const z = Math.min(Math.max(2, min), max)   // default 2×, clamped to device range
    await track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
  }

  // Torch
  if (caps.torch) { /* expose UI toggle */ }

}, 600)
```

Zoom slider and torch toggle at runtime:

```js
await track.applyConstraints({ advanced: [{ zoom: newValue }] }).catch(() => {})
await track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {})
```

**iOS Safari** does not expose `zoom`, `torch`, or `focusMode` via
`getCapabilities()`. All three `if` branches silently do nothing — no errors,
no controls shown.

### Cleanup on unmount / route change

```js
return () => {
  cancelled = true
  const scanner = scannerRef.current
  scannerRef.current = null
  if (scanner) {
    const done = () => { try { scanner.clear() } catch {} }
    try {
      const stopping = scanner.stop()
      if (stopping?.then) stopping.catch(() => {}).finally(done)
      else done()
    } catch { done() }
  }
}
```

`scanner.stop()` **throws synchronously** (not a rejected promise) when the
scanner never started — permission denied, no camera, or the user toggled it
open and immediately closed it. A `.catch()` alone does not catch a synchronous
throw. The outer `try/catch` is required; without it an ErrorBoundary catches
it and blanks the whole page.

### Permission-denied error messages

```js
function cameraErrorMessage(error) {
  const text = String((error && (error.name || error.message)) || error || '')
  if (/NotAllowed|Permission|denied/i.test(text))
    return 'Camera permission denied. Allow camera for this site in your browser.'
  if (/NotFound|DevicesNotFound|no camera/i.test(text))
    return 'No camera found on this device.'
  if (/NotReadable|TrackStart|busy/i.test(text))
    return 'Camera is busy. Close other apps using the camera.'
  if (/Overconstrained|Constraint/i.test(text))
    return 'Back camera could not start — try refreshing.'
  return 'Camera could not start: ' + text
}
```

---

## Bluetooth HID scanner gun

The gun is a Bluetooth keyboard. It types the barcode digits very fast then
sends Enter — no special driver or Web Bluetooth needed.

### Global keydown handler

```js
window.addEventListener('keydown', onKey, true)   // capture phase = true
```

Capture phase fires before any focused input sees the event, allowing intercept
and redirect.

### Timing thresholds

| Threshold | Value | Purpose |
|---|---|---|
| Per-char gap | < 60 ms | Identifies gun vs. human typing (human ≥ 120 ms) |
| Buffer reset timer | 300 ms | Clears buffer if scan stalls mid-barcode |
| Auto-trigger fallback | 250 ms | Fires lookup for guns that send no Enter terminator |
| Minimum barcode length | 4 chars | Ignores single stray keystrokes |

```js
let buffer = '', lastCharMs = 0, scanSpeed = false

const gap = performance.now() - lastCharMs
lastCharMs = performance.now()
if (buffer.length >= 1 && gap < 60) scanSpeed = true

// 300 ms silence → reset
clearTimeout(timer)
timer = setTimeout(reset, 300)
```

### Keeping digits out of other inputs

```js
if (isBarcodeActive) return   // field is focused — handle normally

if (isOtherInputFocused && !scanSpeed) {
  // First char or slow typing in a non-barcode field:
  // buffer it but let it through (can't yet tell if it's a gun)
  buffer += ch
} else {
  // No input focused, OR scan speed confirmed — intercept
  e.preventDefault()
  buffer += ch
}
```

The first character of a gun scan may still land in the wrong field — the speed
check needs at least one prior character to compare. That's a one-digit artefact,
far better than all 13 digits appearing in a notes box.

### 800 ms Android IME duplicate guard

Android's on-screen keyboard re-injects the previous barcode into the field
immediately after a save. Detect and discard it:

```js
// On save, record what was in the field and when
lastSavedRef.current   = previousBarcode
lastSavedAtRef.current = performance.now()

// When the field value changes:
if (
  code &&
  code === lastSavedRef.current &&
  (performance.now() - lastSavedAtRef.current) < 800
) {
  onChange('')   // echo — clear silently, do not look up
  return
}
```

### Auto-focus retries

```js
// Fires whenever the field value becomes empty (after save, on mount)
const doFocus = () => {
  try { el.focus({ preventScroll: true }) } catch { el.focus() }
}
requestAnimationFrame(doFocus)
setTimeout(doFocus, 150)
setTimeout(doFocus, 400)
```

Three attempts because React re-renders, success toasts, and route transitions
can steal focus between them. Does not fire while the field holds a value, so
the user can tap Notes/Description freely.

### lastConfirmedRef gate

Enter, blur, and the 250 ms auto-settle timer can all fire for the same scan.
Only the first reaches the API:

```js
const confirmRef = (code) => {
  const c = (code || '').trim()
  if (c && c === lastConfirmedRef.current) return   // already handled
  lastConfirmedRef.current = c
  onConfirm(code)
}
```

`lastConfirmedRef` is cleared when the field empties, so a deliberate re-scan
of the same barcode after a save still works.

---

## EAN-13 / EAN-8 / UPC-A validation

This app does **not** implement client-side check-digit validation. The scanned
code is sent to the server as-is and resolved against the product database; a
misread returns "not found". If your app needs offline validation, the standard
modulo-10 check-digit algorithm is straightforward to implement separately.

---

## Real-device lessons

| Device / browser | Bug | Fix |
|---|---|---|
| Zebra / Honeywell / generic BT gun | Enter arrives as `e.key === 'Unidentified'`, `keyCode 13` | Check `e.keyCode === 13` as well as `e.key === 'Enter'` |
| Android Chrome | After save, IME re-injects the previous barcode within ~300 ms | 800 ms timestamp guard |
| Android Chrome | Focused input shows keyboard over the camera viewfinder | Blur the field when camera opens; refocus when it closes |
| html5-qrcode (any) | Fixed-pixel `qrbox` centres in the full-res stream, not the visible band | Use the `qrbox` callback form to size relative to rendered dimensions |
| html5-qrcode (any) | `scanner.stop()` throws synchronously when scanner never started | Wrap in `try/catch`, not just `.catch()` |
| iOS Safari | `navigator.vibrate` silently does nothing | Guard with `if (navigator.vibrate)` |
| iOS Safari | `getCapabilities()` returns `{}` — no zoom, torch, or focusMode | Guard every constraint block with `if (caps.zoom)` / `if (caps.torch)` etc. |
| Some BT guns | No Enter terminator sent at end of scan | 250 ms silence fallback fires the lookup |
| Some BT guns | Passing focusMode in `scanner.start()` videoConstraints throws TypeError | Apply focus/zoom/torch via `applyConstraints` on the live track after start, not as start config |
