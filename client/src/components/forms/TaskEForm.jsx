import { useState } from 'react'
import { createTaskRecord, lookupProduct } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'

// Task E — Price Marked Products
// product_code, price_marked_price, supplier, notes
const EMPTY = {
  product_code: '', price_marked_price: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

export default function TaskEForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [form, setForm]   = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) return
    setLookupLoading(true)
    try { await lookupProduct(code) } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim())   return setError('Product code is required.')
    if (form.price_marked_price === '' || isNaN(Number(form.price_marked_price)))
                                     return setError('Price marked price must be a number.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'E',
        store_id:           storeId || session.storeId || null,
        product_code:       form.product_code.trim(),
        supplier_id:        form.supplier_id || null,
        supplier_name_text: form.supplier_name_text.trim() || null,
        notes:              form.notes.trim() || null,
        details: {
          price_marked_price: Number(form.price_marked_price)
        },
        status: 'pending'
      })
      setForm(EMPTY)
      onSaved?.({ queued: !!res?.queued })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">E — Price Marked Products</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-e"
              placeholder="Scan or type the product ID"
            />

            <div className="form-group">
              <label>Price Marked Price *</label>
              <input
                type="number" value={form.price_marked_price}
                onChange={e => setForm(f => ({ ...f, price_marked_price: e.target.value }))}
                placeholder="€0.00" min="0" step="0.01"
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
