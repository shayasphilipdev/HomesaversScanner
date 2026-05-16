import { useState } from 'react'
import { UOM_OPTIONS, PACK_WARNING_TRIGGER, EACHS_WARNING } from '../../lib/uom.js'
import { createTaskRecord, lookupProduct } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'

const EMPTY = {
  product_code: '', description: '', uom: '', quantity: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

// Task A — UOM Errors
// Fields: product_code, description (optional), uom, quantity, supplier, notes
export default function TaskAForm({ onSaved }) {
  const { session } = useStore()
  const [form, setForm]                   = useState(EMPTY)
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim()) return setError('Product code is required.')
    if (!form.uom)                  return setError('Please select a UOM.')
    if (form.quantity === '' || isNaN(Number(form.quantity)))
      return setError('Quantity must be a number.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'A',
        store_id:           session.storeId || null,
        product_code:       form.product_code.trim(),
        description:        form.description.trim() || null,
        uom:                form.uom,
        quantity:           Number(form.quantity),
        supplier_id:        form.supplier_id || null,
        supplier_name_text: form.supplier_name_text.trim() || null,
        notes:              form.notes.trim() || null,
        status:             'pending'
      })
      setForm(EMPTY)
      onSaved?.({ queued: !!res?.queued })
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
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-a"
            />

            <div className="form-group">
              <label>UOM *</label>
              <select value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} required>
                <option value="">Select UOM…</option>
                {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="form-group full">
              <label>Description (optional)</label>
              <input
                type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Auto-fills from master data if available"
              />
            </div>

            <div className="form-group">
              <label>Quantity *</label>
              <input
                type="number" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="0" min="0" step="any"
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

          {showEachsWarning && (
            <div className="warning-box mt-12">
              <span className="warning-icon">⚠️</span>
              <div><strong>{EACHS_WARNING.title}</strong>{EACHS_WARNING.body}</div>
            </div>
          )}

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
