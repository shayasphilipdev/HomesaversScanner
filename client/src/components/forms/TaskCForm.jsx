import { useEffect, useState } from 'react'
import { createTaskRecord, getLookupOptions } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'
import { useTaskForm, LookupBanner } from './useTaskForm.js'

// Task C — Wrong Prices
const EMPTY = {
  product_code: '', reason_code: '', current_price: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

export default function TaskCForm({ onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({ initial: EMPTY })
  const [reasons, setReasons] = useState([])

  useEffect(() => {
    getLookupOptions({ kind: 'reason_code', task_type: 'C' })
      .then(setReasons).catch(() => setReasons([]))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Product code is required.')
    if (!t.form.reason_code)         return t.setError('Please select a reason code.')
    if (t.form.current_price !== '' && isNaN(Number(t.form.current_price)))
                                     return t.setError('Current price must be a number.')

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'C',
        store_id:           storeId || session.storeId || null,
        product_code:       t.form.product_code.trim(),
        supplier_id:        t.form.supplier_id || null,
        supplier_name_text: t.form.supplier_name_text.trim() || null,
        notes:              t.form.notes.trim() || null,
        details: {
          reason_code:   t.form.reason_code,
          current_price: t.form.current_price === '' ? null : Number(t.form.current_price)
        },
        status: 'pending'
      })
      t.reset()
      onSaved?.({ queued: !!res?.queued })
    } catch (err) { t.setError(err.message) } finally { t.setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">C — Wrong Prices</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={t.form.product_code}
              onChange={t.update('product_code')}
              onConfirm={t.triggerLookup}
              lookupLoading={t.lookupLoading}
              readerId="reader-c"
              placeholder="Scan or type the product ID"
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group">
              <label>Reason Code *</label>
              <select value={t.form.reason_code} onChange={t.update('reason_code')} required>
                <option value="">Select reason…</option>
                {reasons.map(r => <option key={r.id} value={r.label}>{r.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Current Price (optional)</label>
              <input
                type="number" value={t.form.current_price}
                onChange={t.update('current_price')}
                placeholder="€0.00" min="0" step="0.01"
              />
            </div>

            <SupplierPicker
              value={{ supplier_id: t.form.supplier_id, supplier_name_text: t.form.supplier_name_text }}
              onChange={({ supplier_id, supplier_name_text }) => t.patch({ supplier_id, supplier_name_text })}
            />

            <div className="form-group full">
              <label>Notes (optional)</label>
              <textarea rows={2} value={t.form.notes} onChange={t.update('notes')} placeholder="Anything worth flagging…" />
            </div>
          </div>

          {t.error && <div className="login-error mt-12">{t.error}</div>}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={t.reset}>Clear</button>
            <button type="submit" className="btn btn-primary" disabled={t.saving}>
              {t.saving ? <><span className="spinner" /> Saving…</> : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
