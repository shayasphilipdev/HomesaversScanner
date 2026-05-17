import { useState } from 'react'
import { uploadPhoto } from '../../lib/api.js'
import { compressImage, newPhotoNamespace } from '../../lib/photos.js'

// Renders the inputs for a single completion form built from `blocks`.
// Parent owns the `answers` object; this component just calls onAnswer(id, value).
//
// Validation is done server-side on submit, but we mark required blocks
// visually here so the user knows what's missing.
export default function BlockRenderer({ blocks = [], answers = {}, onAnswer }) {
  return (
    <div>
      {blocks.map(b => (
        <div className="form-group full" key={b.id} style={{ marginBottom: 14 }}>
          <label>
            {b.label || '(unlabelled)'}{b.required && <span style={{ color: 'var(--red)' }}> *</span>}
          </label>
          <BlockInput block={b} value={answers[b.id]} onChange={v => onAnswer(b.id, v)} />
        </div>
      ))}
    </div>
  )
}

function BlockInput({ block, value, onChange }) {
  switch (block.type) {
    case 'text':
      return <input type="text" value={value || ''} placeholder={block.placeholder || ''} onChange={e => onChange(e.target.value)} />
    case 'textarea':
      return <textarea rows={3} value={value || ''} placeholder={block.placeholder || ''} onChange={e => onChange(e.target.value)} />
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
      return <PhotoBlock value={value} onChange={onChange} />
    default:
      return <div className="note">Unknown block type: {block.type}</div>
  }
}

function PhotoBlock({ value, onChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const pick = async (file) => {
    if (!file) return
    setBusy(true); setErr('')
    try {
      const blob = await compressImage(file, 1600, 0.8)
      const r = await uploadPhoto({ file: blob, slot: 'store_task', tempId: newPhotoNamespace() })
      onChange(r.url)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      {value && <img src={value} alt="" style={{ display: 'block', maxWidth: 160, borderRadius: 8, marginBottom: 8 }} />}
      <input type="file" accept="image/*" capture="environment" onChange={e => pick(e.target.files?.[0])} disabled={busy} />
      {busy && <span className="note" style={{ marginLeft: 8 }}><span className="spinner spinner-dark" /> Uploading…</span>}
      {err && <div className="login-error mt-12">{err}</div>}
    </div>
  )
}
