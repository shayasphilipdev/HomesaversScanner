import { useEffect, useRef, useState } from 'react'
import { uploadPhoto, lookupAltBarcode } from '../../lib/api.js'
import { compressImage, newPhotoNamespace } from '../../lib/photos.js'
import { isDisplayBlock, computeCalc } from '../../lib/taskBlocks.js'
import {
  EXPIRY_ACTIONS, markdownPctFor, buildDate, daysUntil,
  suggestAction, expiryTone, formatDMY,
} from '../../lib/expiry.js'
import ScannerInput from './ScannerInput.jsx'

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
    case 'calc':
      return <CalcBlock block={block} answers={answers} value={value} onChange={onChange} />
    case 'expiry_sweep':
      return <ExpirySweepBlock block={block} value={value} onChange={onChange} />
    default:
      return <div className="note">Unknown block type: {block.type}</div>
  }
}

// Repeatable expiry-sweep input. Scan a product, enter its expiry date + units,
// pick a Reduce-to-Clear action (auto-suggested from days left), and add it as a
// line. The block's answer is an array of line objects. One scan input is live
// at a time (the add-line row), so a single camera readerId is enough.
function ExpirySweepBlock({ block, value, onChange }) {
  const lines    = Array.isArray(value) ? value : []
  const category = block.category || ''

  const [barcode, setBarcode]         = useState('')
  const [lookupInfo, setLookupInfo]   = useState(null)
  const [lookupLoading, setLoading]   = useState(false)
  const [d, setD] = useState('')
  const [m, setM] = useState('')
  const [y, setY] = useState('')
  const [units, setUnits]             = useState('')
  const [action, setAction]           = useState('')
  const [actionAuto, setActionAuto]   = useState(true)
  const [error, setError]             = useState('')

  const mRef = useRef(null)
  const yRef = useRef(null)

  const expiry    = buildDate(d, m, y)
  const dmyDone   = d && m && y
  const invalid   = dmyDone && !expiry
  const days      = daysUntil(expiry)
  const suggested = suggestAction(days, category)
  const tone      = expiryTone(days)

  useEffect(() => { if (actionAuto) setAction(suggested) }, [suggested, actionAuto])

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) { setLookupInfo(null); return }
    setLookupInfo(null); setLoading(true)
    try { setLookupInfo(await lookupAltBarcode(code) || null) }
    catch { /* offline / miss — the raw barcode still saves */ }
    finally { setLoading(false) }
  }

  const resetLine = () => {
    setBarcode(''); setLookupInfo(null)
    setD(''); setM(''); setY(''); setUnits('')
    setAction(''); setActionAuto(true); setError('')
  }

  const addLine = () => {
    if (!barcode.trim())  return setError('Scan or type a barcode first.')
    if (!expiry)          return setError(invalid ? 'That expiry date is not valid.' : 'Enter the expiry date.')
    if (units !== '' && (isNaN(Number(units)) || Number(units) < 0))
                          return setError('Units must be a number (0 or more).')
    const line = {
      barcode:        barcode.trim(),
      description:    lookupInfo?.item_name || '',
      item_status:    lookupInfo?.item_status || '',
      expiry_date:    expiry,
      days_to_expiry: days,
      units:          units === '' ? null : Number(units),
      action:         action || null,
      markdown_pct:   markdownPctFor(action),
    }
    onChange([...lines, line])
    resetLine()
  }

  const removeLine = (idx) => onChange(lines.filter((_, i) => i !== idx))

  const boxStyle = { fontSize: 20, textAlign: 'center', padding: '8px 4px', fontWeight: 600 }
  const onDigits = (setter, next, max) => (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, max)
    setter(v)
    if (error) setError('')
    if (v.length === max && next?.current) next.current.focus()
  }

  return (
    <div>
      {category && (
        <div className="note" style={{ fontSize: 12, marginBottom: 6 }}>
          Category: <strong>{category}</strong>
        </div>
      )}

      {/* Added lines */}
      {lines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {lines.map((ln, i) => {
            const lt = expiryTone(ln.days_to_expiry)
            return (
              <div key={i} className="flex-row" style={{
                gap: 8, alignItems: 'center', padding: '6px 10px',
                background: 'var(--surface-warm)', border: '1px solid var(--border)', borderRadius: 8
              }}>
                <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                  <strong>{ln.description || ln.barcode}</strong>
                  {ln.description && <span className="note" style={{ fontSize: 11 }}> · {ln.barcode}</span>}
                  <span className="note" style={{ fontSize: 12 }}>
                    {' '}· exp {formatDMY(ln.expiry_date)}
                    {ln.units != null ? ` · ${ln.units}u` : ''}
                    {ln.action ? ` · ${ln.action}` : ''}
                  </span>
                  {lt && <span style={{ fontSize: 11, fontWeight: 700, color: lt.c, marginLeft: 6 }}>{lt.t}</span>}
                </span>
                <button type="button" className="btn btn-sm btn-outline" title="Remove line"
                  onClick={() => removeLine(i)} style={{ flexShrink: 0 }}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add-line row */}
      <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 10 }}>
        <ScannerInput
          label="Scan product"
          value={barcode}
          onChange={v => { setBarcode(v); if (error) setError('') }}
          onConfirm={triggerLookup}
          lookupLoading={lookupLoading}
          readerId={`sweep-${block.id}`}
          placeholder="Scan or type the barcode"
        />
        {lookupInfo?.item_name && (
          <div className="note" style={{ fontSize: 13, marginTop: 4 }}>
            Product: <strong>{lookupInfo.item_name}</strong>
          </div>
        )}

        <div className="flex-row" style={{ gap: 6, alignItems: 'center', marginTop: 8 }}>
          <span className="note" style={{ fontSize: 12, width: 44 }}>Expiry</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="DD" aria-label="Day"
            value={d} onChange={onDigits(setD, mRef, 2)} style={{ ...boxStyle, width: 56 }} autoComplete="off" />
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <input ref={mRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="MM" aria-label="Month"
            value={m} onChange={onDigits(setM, yRef, 2)} style={{ ...boxStyle, width: 56 }} autoComplete="off" />
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <input ref={yRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="YY" aria-label="Year"
            value={y} onChange={onDigits(setY, null, 4)} style={{ ...boxStyle, width: 72 }} autoComplete="off" />
          {tone && <span style={{ fontSize: 12, fontWeight: 700, color: tone.c, marginLeft: 4 }}>{tone.t}</span>}
        </div>
        {invalid && <div className="note" style={{ fontSize: 12, marginTop: 4, color: 'var(--red, #c0392b)', fontWeight: 600 }}>Not a valid date.</div>}

        <div className="flex-row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0, flex: '0 0 100px' }}>
            <label style={{ fontSize: 12 }}>Units</label>
            <input type="number" min="0" step="1" placeholder="0"
              value={units} onChange={e => { setUnits(e.target.value); if (error) setError('') }} />
          </div>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label style={{ fontSize: 12 }}>
              Action{suggested && <span className="note" style={{ fontWeight: 400 }}> — suggested: <strong style={{ color: '#B47F1E' }}>{suggested}</strong></span>}
            </label>
            <select value={action} onChange={e => { setAction(e.target.value); setActionAuto(false) }}>
              <option value="">— choose an action —</option>
              {EXPIRY_ACTIONS.map(a => <option key={a.v} value={a.v}>{a.v}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={addLine} style={{ flexShrink: 0 }}>＋ Add line</button>
        </div>

        {/* A part-entered line lives only in this row's local state — it is NOT
            part of the task's answers until "Add line" is tapped. Completing the
            task with text still sitting here would silently drop that product,
            so say so loudly. */}
        {(barcode.trim() || d || m || y || units) && (
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 6,
            background: '#FFF7E0', border: '1px solid #E0A03A',
            fontSize: 12.5, color: 'var(--text)'
          }}>
            ⚠️ This product isn’t added to the sweep yet — tap <strong>＋ Add line</strong> before finishing the task.
          </div>
        )}

        {error && <div className="login-error mt-12">{error}</div>}
      </div>
    </div>
  )
}

// Auto-calculated block. Re-derives its value whenever any source answer
// changes and writes it back through onChange via a real useEffect (no
// queueMicrotask hack during render).
function CalcBlock({ block, answers, value, onChange }) {
  const computed = computeCalc(block, answers)
  useEffect(() => {
    if (computed !== null && computed !== value) onChange(computed)
  }, [computed, value, onChange])

  const display = computed === null || !Number.isFinite(computed)
    ? '—'
    : (Number.isInteger(computed) ? String(computed) : computed.toFixed(2))

  return (
    <div className="flex-row" style={{ gap: 8, alignItems: 'baseline' }}>
      <strong style={{ fontSize: 18 }}>{display}</strong>
      <span className="note" style={{ fontSize: 12 }}>
        (auto-calculated · {block.operation || 'sum'} of {(block.source_block_ids || []).length} block(s))
      </span>
    </div>
  )
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
