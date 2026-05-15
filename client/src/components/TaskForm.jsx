import { useState, useRef, useEffect } from 'react'
import { UOM_OPTIONS, PACK_WARNING_TRIGGER, EACHS_WARNING } from '../lib/uom.js'
import { TASK_FORMS } from '../lib/taskTypes.js'
import { createTaskRecord, lookupProduct, getSuppliers } from '../lib/api.js'
import { useStore } from '../App.jsx'

const EMPTY_A = {
  product_code: '', description: '', uom: '', quantity: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

const CAMERA_CONFIRM_COUNT = 3
const CAMERA_MIN_LENGTH    = 4
const CAMERA_MAX_LENGTH    = 80

export default function TaskForm({ taskType, onSaved }) {
  const meta = TASK_FORMS[taskType]

  if (!meta) {
    return <div className="card"><div className="card-body">Unknown task type.</div></div>
  }

  if (!meta.implemented) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">{meta.name}</div>
        <div className="card-body">
          {meta.warning && <div className="warning-box mb-12"><span className="warning-icon">⚠️</span><div>{meta.warning}</div></div>}
          <div className="empty-state">
            <div className="empty-state-icon">🚧</div>
            <p><strong>Coming soon.</strong></p>
            <p className="note">{meta.comingSoon || 'Not yet implemented.'}</p>
          </div>
        </div>
      </div>
    )
  }

  // Task A — UOM Errors
  return <TaskAForm onSaved={onSaved} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Task A: UOM Errors
// Fields: product_code, description (optional), uom, quantity, supplier, notes
// ─────────────────────────────────────────────────────────────────────────────

function TaskAForm({ onSaved }) {
  const { session } = useStore()
  const [form, setForm]       = useState(EMPTY_A)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraStatus, setCameraStatus] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [supplierMode, setSupplierMode] = useState('list') // 'list' | 'other'
  const codeRef    = useRef(null)
  const scannerRef = useRef(null)

  useEffect(() => {
    getSuppliers().then(setSuppliers).catch(() => setSuppliers([]))
  }, [])

  // Scanner gun keystroke buffer
  useEffect(() => {
    let buffer = '', timer = null
    const onKey = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          setForm(f => ({ ...f, product_code: buffer }))
          triggerLookup(buffer)
          codeRef.current?.focus()
        }
        buffer = ''; clearTimeout(timer)
      } else if (e.key.length === 1) {
        buffer += e.key
        clearTimeout(timer)
        timer = setTimeout(() => { buffer = '' }, 300)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
        const scanner = new Html5Qrcode('reader')
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
              setForm(f => ({ ...f, product_code: code }))
              triggerLookup(code)
              setCameraStatus('Saved code — close camera or scan another.')
              candidate = ''; candidateN = 0
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
  }, [cameraOn])

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) return
    setLookupLoading(true)
    try {
      const p = await lookupProduct(code)
      if (p) {
        setForm(f => ({ ...f, description: p.description || f.description, uom: p.uom || f.uom }))
      }
    } catch {} finally { setLookupLoading(false) }
  }

  const set = (field) => (e) => { setForm(f => ({ ...f, [field]: e.target.value })); setError('') }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim()) return setError('Product code is required.')
    if (!form.uom)                  return setError('Please select a UOM.')
    if (form.quantity === '' || isNaN(Number(form.quantity)))
      return setError('Quantity must be a number.')

    setSaving(true); setError('')
    try {
      await createTaskRecord({
        task_type:          'A',
        store_id:           session.storeId || null,
        product_code:       form.product_code.trim(),
        description:        form.description.trim() || null,
        uom:                form.uom,
        quantity:           Number(form.quantity),
        supplier_id:        supplierMode === 'list'  ? (form.supplier_id || null) : null,
        supplier_name_text: supplierMode === 'other' ? (form.supplier_name_text.trim() || null) : null,
        notes:              form.notes.trim() || null,
        status:             'pending'
      })
      setForm(EMPTY_A)
      setSupplierMode('list')
      codeRef.current?.focus()
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const showEachsWarning = form.uom === PACK_WARNING_TRIGGER

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">A — UOM Errors</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">

            {/* Product code */}
            <div className="form-group">
              <label>Product Code *</label>
              <div style={{ position: 'relative' }}>
                <input
                  ref={codeRef} type="text" className="scan-input"
                  value={form.product_code} onChange={set('product_code')}
                  onBlur={() => triggerLookup(form.product_code)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerLookup(form.product_code) } }}
                  placeholder="Scan with gun, type, or use camera…"
                  autoComplete="off" spellCheck={false}
                />
                {lookupLoading && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                    <span className="spinner spinner-dark" />
                  </span>
                )}
              </div>
              <div className="flex-row" style={{ gap: 8, marginTop: 6 }}>
                <button type="button" className={`btn btn-sm ${cameraOn ? 'btn-danger' : 'btn-outline'}`} onClick={() => setCameraOn(v => !v)}>
                  {cameraOn ? '✕ Stop camera' : '📷 Use camera'}
                </button>
                <span className="note" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Scanner gun and typing work without enabling the camera.
                </span>
              </div>
            </div>

            {/* UOM */}
            <div className="form-group">
              <label>UOM *</label>
              <select value={form.uom} onChange={set('uom')} required>
                <option value="">Select UOM…</option>
                {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Description */}
            <div className="form-group full">
              <label>Description (optional)</label>
              <input type="text" value={form.description} onChange={set('description')} placeholder="Auto-fills from master data if available" />
            </div>

            {/* Quantity */}
            <div className="form-group">
              <label>Quantity *</label>
              <input type="number" value={form.quantity} onChange={set('quantity')} placeholder="0" min="0" step="any" />
            </div>

            {/* Supplier */}
            <div className="form-group">
              <label>Supplier (optional)</label>
              {supplierMode === 'list' ? (
                <select
                  value={form.supplier_id}
                  onChange={e => {
                    if (e.target.value === '__other__') { setSupplierMode('other'); setForm(f => ({ ...f, supplier_id: '' })) }
                    else setForm(f => ({ ...f, supplier_id: e.target.value }))
                  }}
                >
                  <option value="">— Select supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                  <option value="__other__">Other (type a name)…</option>
                </select>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={form.supplier_name_text}
                    onChange={set('supplier_name_text')}
                    placeholder="Supplier name"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => { setSupplierMode('list'); setForm(f => ({ ...f, supplier_name_text: '' })) }}>
                    Use list
                  </button>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="form-group full">
              <label>Notes (optional)</label>
              <textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Anything worth flagging…" />
            </div>

          </div>

          {cameraOn && (
            <div className="mt-12">
              <div id="reader" style={{ width: '100%', maxWidth: 480, minHeight: 240, background: '#eee', borderRadius: 10, overflow: 'hidden' }} />
              <div className="note mt-12" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {cameraStatus || 'Starting camera…'}
              </div>
            </div>
          )}

          {showEachsWarning && (
            <div className="warning-box mt-12">
              <span className="warning-icon">⚠️</span>
              <div><strong>{EACHS_WARNING.title}</strong>{EACHS_WARNING.body}</div>
            </div>
          )}

          {error && <div className="login-error mt-12">{error}</div>}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => { setForm(EMPTY_A); setSupplierMode('list'); setError('') }}>
              Clear
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function cameraErrorMessage(error) {
  const text = String((error && (error.name || error.message)) || error || 'Unknown error')
  if (/NotAllowed|Permission|denied/i.test(text))   return 'Camera permission denied. Allow camera for this site in your browser.'
  if (/NotFound|DevicesNotFound|no camera/i.test(text)) return 'No camera found on this device.'
  if (/NotReadable|TrackStart|busy/i.test(text))    return 'Camera is busy. Close other apps using the camera.'
  if (/Overconstrained|Constraint/i.test(text))     return 'Back camera could not start — try refreshing.'
  return 'Camera could not start: ' + text
}
