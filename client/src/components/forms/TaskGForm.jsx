import { useState } from 'react'
import { createTaskRecord, lookupProduct } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'

// Task G — Promotion Error
// product_code, promotion_description, promotion_price, supplier, notes
const EMPTY = {
  product_code: '', promotion_description: '', promotion_price: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

export default function TaskGForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupInfo, setLookupInfo] = useState(null)

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) { setLookupInfo(null); return }
    setLookupLoading(true)
    try {
      const p = await lookupProduct(code)
      if (p) {
        setForm(f => ({
          ...f,
          supplier_id:        p.supplier_id || f.supplier_id,
          supplier_name_text: p.supplier_id ? '' : f.supplier_name_text
        }))
        setLookupInfo(p)
      } else { setLookupInfo(null) }
    } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim())          return setError('Product code is required.')
    if (!form.promotion_description.trim()) return setError('Promotion description is required.')
    if (form.promotion_price === '' || isNaN(Number(form.promotion_price)))
                                            return setError('Promotion price must be a number.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:    'G',
        store_id:           storeId || session.storeId || null,
        product_code: form.product_code.trim(),
        supplier_id:        form.supplier_id || null,
        supplier_name_text: form.supplier_name_text.trim() || null,
        notes:        form.notes.trim() || null,
        details: {
          promotion_description: form.promotion_description.trim(),
          promotion_price:       Number(form.promotion_price)
        },
        status: 'pending'
      })
      setForm(EMPTY); setLookupInfo(null)
      onSaved?.({ queued: !!res?.queued })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">G — Promotion Error</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-g"
              placeholder="Scan or type the product ID"
            />

            {lookupInfo && (
              <div className="form-group full" style={{ marginTop: -6 }}>
                <span className="note" style={{ fontSize: 12.5 }}>
                  {lookupInfo.description && <>Product: <strong>{lookupInfo.description}</strong></>}
                  {lookupInfo.description && lookupInfo.supplier_name && ' · '}
                  {lookupInfo.supplier_name && <>Supplier: <strong>{lookupInfo.supplier_name}</strong></>}
                </span>
              </div>
            )}

            <div className="form-group">
              <label>Promotion Price *</label>
              <input
                type="number" value={form.promotion_price}
                onChange={e => setForm(f => ({ ...f, promotion_price: e.target.value }))}
                placeholder="€0.00" min="0" step="0.01"
              />
            </div>

            <div className="form-group full">
              <label>Promotion Description *</label>
              <input
                type="text" value={form.promotion_description}
                onChange={e => setForm(f => ({ ...f, promotion_description: e.target.value }))}
                placeholder="e.g. 2 for €5, Buy 1 Get 1, etc."
              />
            </div>

            <SupplierPicker
              value={{ supplier_id: form.supplier_id, supplier_name_text: form.supplier_name_text }}
              onChange={({ supplier_id, supplier_name_text }) => setForm(f => ({ ...f, supplier_id, supplier_name_text }))}
            />

            <div className="form-group full">
              <label>Notes (optional)</label>
              <textarea
                rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Anything worth flagging…"
              />
            </div>
          </div>

          {error && <div className="login-error mt-12">{error}</div>}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => { setForm(EMPTY); setLookupInfo(null); setError('') }}>
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
