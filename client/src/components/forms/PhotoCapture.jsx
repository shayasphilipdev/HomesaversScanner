import { useRef, useState } from 'react'
import { compressImage } from '../../lib/photos.js'

// Photo capture widget.
// - Click "Take or upload" → native file picker (camera OR gallery on phones).
// - Shows a thumbnail preview once captured.
// - Compresses to max 1600px wide JPEG on capture (client-side) to keep
//   uploads small and storage usage low.
// - Returns a Blob (image/jpeg) via onChange. Parent decides when to upload.
export default function PhotoCapture({ label, value, onChange, required }) {
  const fileRef = useRef(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')

  const pick = () => fileRef.current?.click()

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError('')
    try {
      const blob = await compressImage(file, 1600, 0.8)
      const url  = URL.createObjectURL(blob)
      // Free previous preview if any
      if (preview) URL.revokeObjectURL(preview)
      setPreview(url)
      onChange(blob)
    } catch (err) {
      setError(err.message || 'Could not process image')
    } finally {
      setBusy(false)
      // Allow re-picking the same file
      e.target.value = ''
    }
  }

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview)
    setPreview('')
    onChange(null)
  }

  return (
    <div className="form-group">
      <label>{label}{required && ' *'}</label>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      {!value && (
        <button type="button" className="btn btn-outline" onClick={pick} disabled={busy}>
          {busy ? <><span className="spinner spinner-dark" /> Processing…</> : '📷 Take photo or upload'}
        </button>
      )}
      {value && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <img src={preview} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="note" style={{ fontSize: 12 }}>Captured ({Math.round(value.size / 1024)} KB)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-sm btn-outline" onClick={pick}>Retake</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={clear}>Remove</button>
            </div>
          </div>
        </div>
      )}
      {error && <div className="note" style={{ color: 'var(--danger, #b00020)', fontSize: 12 }}>{error}</div>}
    </div>
  )
}
