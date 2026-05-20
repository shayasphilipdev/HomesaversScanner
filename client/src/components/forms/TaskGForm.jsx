import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'
import { useTaskForm, LookupBanner } from './useTaskForm.jsx'

// Task G — Promotion Error
const EMPTY = {
  product_code: '', promotion_description: '', promotion_price: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

export default function TaskGForm({ onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({ initial: EMPTY })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim())          return t.setError('Product code is required.')
    if (!t.form.promotion_description.trim()) return t.setError('Promotion description is required.')
    if (t.form.promotion_price === '' || isNaN(Number(t.form.promotion_price)))
                                              return t.setError('Promotion price must be a number.')

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'G',
        store_id:           storeId || session.storeId || null,
        product_code:       t.form.product_code.trim(),
        supplier_id:        t.form.supplier_id || null,
        supplier_name_text: t.form.supplier_name_text.trim() || null,
        notes:              t.form.notes.trim() || null,
        details: {
          promotion_description: t.form.promotion_description.trim(),
          promotion_price:       Number(t.form.promotion_price)
        },
        status: 'pending'
      })
      t.reset()
      onSaved?.({ queued: !!res?.queued })
    } catch (err) { t.setError(err.message) } finally { t.setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">G — Promotion Error</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={t.form.product_code}
              onChange={t.update('product_code')}
              onConfirm={t.triggerLookup}
              lookupLoading={t.lookupLoading}
              readerId="reader-g"
              placeholder="Scan or type the product ID"
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group">
              <label>Promotion Price *</label>
              <input
                type="number" value={t.form.promotion_price}
                onChange={t.update('promotion_price')}
                placeholder="€0.00" min="0" step="0.01"
              />
            </div>

            <div className="form-group full">
              <label>Promotion Description *</label>
              <input
                type="text" value={t.form.promotion_description}
                onChange={t.update('promotion_description')}
                placeholder="e.g. 2 for €5, Buy 1 Get 1, etc."
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
