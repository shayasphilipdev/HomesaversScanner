import { useState } from 'react'
import { uploadPhoto } from '../../lib/api.js'
import { compressImage, newPhotoNamespace } from '../../lib/photos.js'
import { isDisplayBlock, computeCalc } from '../../lib/taskBlocks.js'

// Renders the inputs for a single completion form built from `blocks`.
// Parent owns the `answers` object; this component just calls onAnswer(id, value).
//
// Validation is done server-side on submit, but we mark required blocks
// visually here so the user knows what's missing.
export default function BlockRenderer({ blocks = [], answers = {}, onAnswer }) {
  return (
    <div>
      {blocks.map(b => {
        // Display blocks render full-bleed, no label row, no answer wiring.
        if (isDisplayBlock(b)) return <DisplayBlock key={b.id} block={b} />

        return (
          <div className="form-group full" key={b.id} style={{ marginBottom: 14 }}>
            <label>
              {b.label || '(unlabelled)'}{b.required && <span style={{ color: 'var(--red)' }}> *</span>}
            </label>
            <BlockInput block={b} answers={answers} value={answers[b.id]} onChange={v => onAnswer(b.id, v)} />
          </div>
        )
      })}
    </div>
  )
}

function DisplayBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return (
        <h3 style={{ marginTop: 18, marginBottom: 8, fontSize: 16, fontWeight: 600, borderBottom: '1px solid var(--border-soft)', paddingBottom: 4 }}>
          {block.label || '(untitled section)'}
        </h3>
      )
    case 'divider':
      return <hr style={{ border: 0, borderTop: '1px solid var(--border-soft)', margin: '16px 0' }} />
    case 'instruction':
      return (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--surface-warm)', borderLeft: '3px solid var(--border)', borderRadius: 4 }}>
          {block.label && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{block.label}</div>}
          <div className="note" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{block.text || ''}</div>
        </div>
      )
    case 'alert': {
      // Map variant -> colour + icon. Falls back to warning.
      const styles = {
        info:    { bg: '#E8F1FB', border: '#5B8DEF', icon: 'ℹ️' },
        warning: { bg: '#FFF7E0', border: '#E0A03A', icon: '⚠️' },
        danger:  { bg: '#FCE7E5', border: '#D14B3D', icon: '🔴' },
        success: { bg: '#E6F5E8', border: '#3E9F4B', icon: '✅' }
      }
      const v = styles[block.variant] || styles.warning
      return (
        <div style={{
          marginBottom: 12, padding: '10px 14px',
          background: v.bg, borderLeft: `4px solid ${v.border}`, borderRadius: 6,
          display: 'flex', gap: 10, alignItems: 'flex-start'
        }}>
          <span aria-hidden style={{ fontSize: 18 }}>{v.icon}</span>
          <div style={{ fontSize: 13 }}>
            {block.label && <div style={{ fontWeight: 600, marginBottom: 2 }}>{block.label}</div>}
            <div style={{ whiteSpace: 'pre-wrap' }}>{block.text || ''}</div>
          </div>
        </div>
      )
    }
    default:
      return null
  }
}

function BlockInput({ block, answers, value, onChange }) {
  switch (block.type) {
    case 'text':
      return <input type="text" value={value || ''} placeholder={block.placeholder || ''} onChange={e => onChange(e.target.value)} />
    case 'textarea':
      return <textarea rows={3} value={value || ''} placeholder={block.placeholder || ''} onChange={e => onChange(e.target.value)} />
    case 'signature':
      return <input type="text" value={value || ''} placeholder={block.placeholder || 'Type your name'} onChange={e => onChange(e.target.value)} />
    case 'number':
      return (
        <div className="flex-row" style={{ gap: 6 }}>
          <input
            type="number"
            value={value ?? ''}
            min={block.min ?? undefined}
            max={block.max ?? undefined}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{ flex: 1 }}
          />
          {block.unit && <span className="note" style={{ fontSize: 13 }}>{block.unit}</span>}
        </div>
      )
    case 'percentage':
      return (
        <div className="flex-row" style={{ gap: 6 }}>
          <input
            type="number"
            value={value ?? ''}
            min={block.min ?? 0}
            max={block.max ?? 100}
            step="0.1"
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span className="note" style={{ fontSize: 13 }}>%</span>
        </div>
      )
    case 'temperature':
      return (
        <div className="flex-row" style={{ gap: 6 }}>
          <input
            type="number"
            value={value ?? ''}
            min={block.min ?? undefined}
            max={block.max ?? undefined}
            step="0.1"
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span className="note" style={{ fontSize: 13 }}>{block.unit || '°C'}</span>
        </div>
      )
    case 'amount':
      return (
        <div className="flex-row" style={{ gap: 6 }}>
          <span className="note" style={{ fontSize: 14 }}>{block.currency || '€'}</span>
          <input
            type="number" step="0.01" min="0"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>
      )
    case 'rating': {
      const scale = block.scale ?? 5
      return (
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {Array.from({ length: scale }, (_, i) => i + 1).map(n => (
            <button
              type="button"
              key={n}
              className={`btn btn-sm ${value === n ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onChange(n)}
              title={`${n} / ${scale}`}
              style={{ minWidth: 36 }}
            >
              {n}
            </button>
          ))}
        </div>
      )
    }
    case 'date':
      return <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} />
    case 'time':
      return <input type="time" value={value || ''} onChange={e => onChange(e.target.value)} />
    case 'yes_no':
      return (
        <div className="flex-row" style={{ gap: 8 }}>
          {['yes', 'no'].map(opt => (
            <button
              type="button"
              key={opt}
              className={`btn btn-sm ${value === opt ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onChange(opt)}
            >
              {opt === 'yes' ? '✓ Yes' : '✕ No'}
            </button>
          ))}
        </div>
      )
    case 'choice_single':
      return (
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(block.options || []).map(opt => (
            <button
              type="button"
              key={opt}
              className={`btn btn-sm ${value === opt ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onChange(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )
    case 'choice_multi': {
      const arr = Array.isArray(value) ? value : []
      const toggle = (opt) => onChange(arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt])
      return (
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(block.options || []).map(opt => (
            <button
              type="button"
              key={opt}
              className={`btn btn-sm ${arr.includes(opt) ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => toggle(opt)}
            >
              {arr.includes(opt) ? '✓ ' : ''}{opt}
            </button>
          ))}
        </div>
      )
    }
    case 'photo':
      return <UploadBlock value={value} onChange={onChange} accept="image/*" capture="environment" isImage />
    case 'file':
      return <UploadBlock value={value} onChange={onChange} accept={block.accept || '*/*'} />
    case 'calc': {
      const computed = computeCalc(block, answers)
      const display  = computed === null || !Number.isFinite(computed)
        ? '—'
        : (Number.isInteger(computed) ? String(computed) : computed.toFixed(2))
      // Auto-sync the computed value into answers so the saved record carries
      // the final number (parent receives it via onChange).
      if (computed !== null && computed !== value) {
        // Defer so we don't update state during render.
        queueMicrotask(() => onChange(computed))
      }
      return (
        <div className="flex-row" style={{ gap: 8, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 18 }}>{display}</strong>
          <span className="note" style={{ fontSize: 12 }}>
            (auto-calculated · {block.operation || 'sum'} of {(block.source_block_ids || []).length} block(s))
          </span>
        </div>
      )
    }
    default:
      return <div className="note">Unknown block type: {block.type}</div>
  }
}

// Shared uploader for photos and any-file blocks. Photos go through the
// compress step before upload to keep payloads under control on phones.
function UploadBlock({ value, onChange, accept, capture, isImage = false }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const pick = async (file) => {
    if (!file) return
    setBusy(true); setErr('')
    try {
      const blob = isImage ? await compressImage(file, 1600, 0.8) : file
      const r = await uploadPhoto({ file: blob, slot: 'store_task', tempId: newPhotoNamespace() })
      onChange(r.url)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      {value && (
        isImage
          ? <img src={value} alt="" style={{ display: 'block', maxWidth: 160, borderRadius: 8, marginBottom: 8 }} />
          : <a href={value} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginBottom: 8 }}>📎 View attached file</a>
      )}
      <input
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        onChange={e => pick(e.target.files?.[0])}
        disabled={busy}
      />
      {busy && <span className="note" style={{ marginLeft: 8 }}><span className="spinner spinner-dark" /> Uploading…</span>}
      {err && <div className="login-error mt-12">{err}</div>}
    </div>
  )
}
