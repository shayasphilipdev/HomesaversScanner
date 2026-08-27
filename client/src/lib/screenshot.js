// Desktop screenshot support for the photo fields.
//
// On a PC the plain <input type="file" accept="image/*"> only opens a file
// picker — there is no camera, so a back-office user has no way to attach what
// is on their screen. These helpers add two routes:
//
//   A. Paste / drop — the user snips with Win+Shift+S (or PrtScn) and pastes.
//      This is the nicest option because the crop is done by the tool they
//      already know, and it needs no permission prompt.
//   B. Capture screen — the browser's own screen-capture picker; we grab a
//      single frame. Discoverable, but it captures a whole screen/window/tab
//      rather than a dragged region.
//
// Both are desktop-only by design; phones keep the existing camera behaviour.
// The barcode scanner's camera (ScannerInput) is deliberately untouched.

// A real pointer means a desktop/laptop. Phones report 'coarse', so the
// screenshot affordances stay hidden there rather than showing controls that
// cannot work.
export function isDesktopPointer() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: fine)').matches
}

// True when this browser can capture the screen at all. Chrome/Edge/Firefox on
// desktop support it; mobile browsers do not expose getDisplayMedia.
export function canCaptureScreen() {
  return typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    isDesktopPointer()
}

// Paste and drop both carry a DataTransfer. Pull the first image out of it,
// or null when the payload has no image (e.g. plain text was pasted).
export function imageFromDataTransfer(dt) {
  if (!dt) return null
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file' && String(item.type).startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return Array.from(dt.files || []).find(f => String(f.type).startsWith('image/')) || null
}

// Capture one frame of whatever screen / window / tab the user picks.
// Returns a PNG Blob, or null if they dismissed the picker (a cancel is not an
// error — callers should stay silent rather than showing a failure message).
export async function captureScreen() {
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  } catch (e) {
    // NotAllowedError / AbortError = the user closed the picker or declined.
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return null
    throw new Error('Could not start screen capture — ' + (e?.message || 'unknown error'))
  }

  const video = document.createElement('video')
  try {
    video.srcObject = stream
    video.muted = true
    video.playsInline = true

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('Could not read the screen image.'))
    })
    await video.play()

    // Wait for a painted frame — without this the first frame can be blank.
    if (typeof video.requestVideoFrameCallback === 'function') {
      await new Promise(resolve => video.requestVideoFrameCallback(() => resolve()))
    } else {
      await new Promise(resolve => setTimeout(resolve, 150))
    }

    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) throw new Error('The captured screen image was empty.')

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Could not create the image.')),
        'image/png'
      )
    })
  } finally {
    // Always release the capture, otherwise the browser keeps showing the
    // "sharing your screen" indicator.
    video.pause()
    video.srcObject = null
    stream.getTracks().forEach(t => t.stop())
  }
}
