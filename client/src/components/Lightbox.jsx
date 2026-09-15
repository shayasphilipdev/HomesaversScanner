import { useEffect, useState } from 'react'

// Full-screen photo viewer, in-app — a popup within the page itself rather
// than a new browser tab showing the bare image with no chrome. Zoom in/out,
// and slide between every photo in the current set (a record's Product +
// Barcode photos, or the attachments on one message) with the same viewer
// staying open. Shared by RecordDetailModal (record photos) and
// RecordMessages (message attachments).
//
// Props: images [{url,label}], index (current position in that array),
// onClose, onIndexChange(nextIndex).
export default function Lightbox({ images, index, onClose, onIndexChange }) {
  const [zoom, setZoom] = useState(1)
  const img = images?.[index]

  // Fresh zoom on every photo, not just on open.
  useEffect(() => { setZoom(1) }, [index])

  useEffect(() => {
    if (!img) return
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft'  && index > 0)                 { e.preventDefault(); onIndexChange(index - 1) }
      if (e.key === 'ArrowRight' && index < images.length - 1) { e.preventDefault(); onIndexChange(index + 1) }
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))
      if (e.key === '-')                  setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [img, index, images, onClose, onIndexChange])

  if (!img) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={img.label || 'Photo'}
      data-lightbox="true"
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,12,16,.88)',
        zIndex: 1200, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '4vh 3vw',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '100%', maxHeight: '100%' }}
      >
        <div className="flex-row" style={{ gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
            {img.label}{images.length > 1 ? ` · ${index + 1} of ${images.length}` : ''}
          </span>
          <button className="btn btn-sm btn-outline" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out (-)">−</button>
          <button className="btn btn-sm btn-outline" onClick={() => setZoom(1)} title="Reset zoom" style={{ minWidth: 54 }}>{Math.round(zoom * 100)}%</button>
          <button className="btn btn-sm btn-outline" onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))} title="Zoom in (+)">+</button>
          <button className="btn btn-sm btn-outline" onClick={onClose} title="Close (Esc)">✕ Close</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {images.length > 1 && (
            <button className="btn btn-sm btn-icon btn-outline" onClick={() => onIndexChange(index - 1)} disabled={index === 0} title="Previous photo (←)">‹</button>
          )}
          <div style={{ overflow: 'auto', maxWidth: '80vw', maxHeight: '74vh', borderRadius: 8, background: '#000' }}>
            <img
              src={img.url}
              alt={img.label || 'Photo'}
              style={{
                display: 'block', transform: `scale(${zoom})`, transformOrigin: 'center',
                transition: 'transform .12s',
                maxWidth:  zoom <= 1 ? '80vw' : 'none',
                maxHeight: zoom <= 1 ? '74vh' : 'none',
              }}
            />
          </div>
          {images.length > 1 && (
            <button className="btn btn-sm btn-icon btn-outline" onClick={() => onIndexChange(index + 1)} disabled={index === images.length - 1} title="Next photo (→)">›</button>
          )}
        </div>
      </div>
    </div>
  )
}
