import { useState, useRef, useEffect } from 'react'
import { UOM_OPTIONS, PACK_WARNING_TRIGGER, EACHS_WARNING } from '../lib/uom.js'
import { createProductRecord, lookupProduct } from '../lib/api.js'
import { useStore } from '../App.jsx'

const EMPTY = { productCode: '', description: '', uom: '', quantity: '' }

export default function ProductForm({ onSaved }) {
  const { session } = useStore()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const codeRef = useRef(null)

  // Scanner gun: capture rapid keystrokes into the product code field
  useEffect(() => {
    let buffer = ''
    let timer = null

    const onKey = (e) => {
      // If any input/select/textarea is focused, let it handle its own input
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (e.key === 'Enter') {
        if (buffer.length >= 4) {
          setForm(f => ({ ...f, productCode: buffer }))
          triggerLookup(buffer)
          codeRef.current?.focus()
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
  }, [])

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) return
    setLookupLoading(true)
    try {
      const product = await lookupProduct(code)
      if (product) {
        setForm(f => ({
          ...f,
          description: product.description || f.description,
          uom: product.uom || f.uom
        }))
      }
    } catch {
      // No match is fine — user fills in manually
    } finally {
      setLookupLoading(false)
    }
  }

  const handleCodeBlur = () => triggerLookup(form.productCode)

  const handleCodeKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      triggerLookup(form.productCode)
    }
  }

  const set = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.productCode.trim()) return setError('Product code is required.')
    if (!form.uom) return setError('Please select a UOM.')
    if (form.quantity === '' || isNaN(Number(form.quantity))) return setError('Quantity must be a number.')
    setSaving(true); setError('')
    try {
      await createProductRecord({
        store_id: session.storeId || null,
        product_code: form.productCode.trim(),
        description: form.description.trim(),
        uom: form.uom,
        quantity: Number(form.quantity),
        status: 'pending'
      })
      setForm(EMPTY)
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
      <div className="card-header">Add Product Record</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">

            {/* Product code */}
            <div className="form-group">
              <label>Product Code *</label>
              <div style={{ position: 'relative' }}>
                <input
                  ref={codeRef}
                  type="text"
                  className="scan-input"
                  value={form.productCode}
                  onChange={set('productCode')}
                  onBlur={handleCodeBlur}
                  onKeyDown={handleCodeKeyDown}
                  placeholder="Scan or type code…"
                  autoComplete="off"
                  spellCheck={false}
                />
                {lookupLoading && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                    <span className="spinner spinner-dark" />
                  </span>
                )}
              </div>
            </div>

            {/* UOM */}
            <div className="form-group">
              <label>UOM *</label>
              <select value={form.uom} onChange={set('uom')} required>
                <option value="">Select UOM…</option>
                {UOM_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="form-group full">
              <label>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={set('description')}
                placeholder="Product description (auto-fills if in master data)"
              />
            </div>

            {/* Quantity */}
            <div className="form-group">
              <label>Quantity *</label>
              <input
                type="number"
                value={form.quantity}
                onChange={set('quantity')}
                placeholder="0"
                min="0"
                step="any"
              />
            </div>

          </div>

          {/* Eachs warning */}
          {showEachsWarning && (
            <div className="warning-box mt-12">
              <span className="warning-icon">⚠️</span>
              <div>
                <strong>{EACHS_WARNING.title}</strong>
                {EACHS_WARNING.body}
              </div>
            </div>
          )}

          {error && (
            <div className="login-error mt-12">{error}</div>
          )}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => { setForm(EMPTY); setError('') }}>
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
