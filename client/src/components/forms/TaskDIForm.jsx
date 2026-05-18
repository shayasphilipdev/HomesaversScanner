import { useState } from 'react'
import { createTaskRecord, lookupProduct } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'

// Tasks D (Wrong Description) and I (Miscellaneous Tasks) share an identical
// field set: product_code, product_name_label, product_barcode, supplier, notes.
//
// The task_type prop decides which header is shown and which code lands in
// the DB. Behaviour is otherwise identical.
const EMPTY = {
  product_code: '', product_name_label: '', product_barcode: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

const HEADERS = {
  D: 'D — Wrong Description',
  I: 'I — Miscellaneous Tasks'
}

const HINTS = {
  D: 'Use this when the description in the system does not match the product in front of you.',
  I: 'For anything that does not fit the other task types.'
}

export default function TaskDIForm({ taskType, onSaved, storeId }) {
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
          product_name_label: f.product_name_label || p.description || '',
          supplier_id:        p.supplier_id || f.supplier_id,
          supplier_name_text: p.supplier_id ? '' : f.supplier_name_text
        }))
        setLookupInfo(p)
      } else { setLookupInfo(null) }
    } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim())       return setError('Product code is required.')
    if (!form.product_name_label.trim()) return setError('Product name (as on the product) is required.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:          taskType,
        store_id:           storeId || session.storeId || null,
        product_code:       form.product_code.trim(),
        product_name_label: form.product_name_label.trim(),
        product_barcode:    form.product_barcode.trim() || null,
        supplier_id:        form.supplier_id || null,
        supplier_name_text: form.supplier_name_text.trim() || null,
        notes:              form.notes.trim() || null,
        status:             'pending'
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
      <div className="card-header">{HEADERS[taskType] || taskType}</div>
      <div className="card-body">
        <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>{HINTS[taskType]}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId={`reader-${taskType.toLowerCase()}-code`}
              placeholder="Scan or type the product ID"
            />

            <ScannerInput
              label="Product Barcode (optional)"
              value={form.product_barcode}
              onChange={v => { setForm(f => ({ ...f, product_barcode: v })); setError('') }}
              readerId={`reader-${taskType.toLowerCase()}-barcode`}
              placeholder="Scan or type the printed barcode"
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

            <div className="form-group full">
              <label>Product Name (as on the product) *</label>
              <input
                type="text" value={form.product_name_label}
                onChange={e => setForm(f => ({ ...f, product_name_label: e.target.value }))}
                placeholder="Exactly what is printed on the product"
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
