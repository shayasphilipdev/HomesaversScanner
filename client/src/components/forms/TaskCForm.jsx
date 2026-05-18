import { useEffect, useState } from 'react'
import { createTaskRecord, lookupProduct, getLookupOptions } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'

// Task C — Wrong Prices
// product_code, reason_code (from lookup_options master), current_price (optional), notes
const EMPTY = {
  product_code: '', reason_code: '', current_price: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

export default function TaskCForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [form, setForm]         = useState(EMPTY)
  const [reasons, setReasons]   = useState([])
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupInfo, setLookupInfo] = useState(null)

  useEffect(() => {
    getLookupOptions({ kind: 'reason_code', task_type: 'C' })
      .then(setReasons)
      .catch(() => setReasons([]))
  }, [])

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
    if (!form.product_code.trim()) return setError('Product code is required.')
    if (!form.reason_code)         return setError('Please select a reason code.')
    if (form.current_price !== '' && isNaN(Number(form.current_price)))
                                   return setError('Current price must be a number.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:    'C',
        store_id:           storeId || session.storeId || null,
        product_code: form.product_code.trim(),
        supplier_id:        form.supplier_id || null,
        supplier_name_text: form.supplier_name_text.trim() || null,
        notes:        form.notes.trim() || null,
        details: {
          reason_code:   form.reason_code,
          current_price: form.current_price === '' ? null : Number(form.current_price)
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
      <div className="card-header">C — Wrong Prices</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-c"
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
              <label>Reason Code *</label>
              <select value={form.reason_code} onChange={e => setForm(f => ({ ...f, reason_code: e.target.value }))} required>
                <option value="">Select reason…</option>
                {reasons.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Current Price (optional)</label>
              <input
                type="number" value={form.current_price}
                onChange={e => setForm(f => ({ ...f, current_price: e.target.value }))}
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
