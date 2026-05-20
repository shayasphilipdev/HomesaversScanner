import { UOM_OPTIONS, PACK_WARNING_TRIGGER, EACHS_WARNING } from '../../lib/uom.js'
import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'
import { useTaskForm, LookupBanner } from './useTaskForm.jsx'

const EMPTY = {
  product_code: '', description: '', uom: '', quantity: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

// Task A — UOM Errors. Auto-fills description + uom + supplier on scan.
export default function TaskAForm({ onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({
    initial: EMPTY,
    // Task-A specific extra auto-fills: pull description + uom from the master.
    onLookup: ({ product, setForm }) =>
      setForm(f => ({
        ...f,
        description: f.description || product.description || '',
        uom:         f.uom         || product.uom || ''
      }))
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Product code is required.')
    if (!t.form.uom)                  return t.setError('Please select a UOM.')
    if (t.form.quantity === '' || isNaN(Number(t.form.quantity)))
      return t.setError('Quantity must be a number.')

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'A',
        store_id:           storeId || session.storeId || null,
        product_code:       t.form.product_code.trim(),
        description:        t.form.description.trim() || null,
        uom:                t.form.uom,
        quantity:           Number(t.form.quantity),
        supplier_id:        t.form.supplier_id || null,
        supplier_name_text: t.form.supplier_name_text.trim() || null,
        notes:              t.form.notes.trim() || null,
        status:             'pending'
      })
      t.reset()
      onSaved?.({ queued: !!res?.queued })
    } catch (err) {
      t.setError(err.message)
    } finally {
      t.setSaving(false)
    }
  }

  const showEachsWarning = t.form.uom === PACK_WARNING_TRIGGER

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">A — UOM Errors</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={t.form.product_code}
              onChange={v => t.update('product_code')(v)}
              onConfirm={t.triggerLookup}
              lookupLoading={t.lookupLoading}
              readerId="reader-a"
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group">
              <label>UOM *</label>
              <select value={t.form.uom} onChange={t.update('uom')} required>
                <option value="">Select UOM…</option>
                {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="form-group full">
              <label>Description (optional)</label>
              <input
                type="text" value={t.form.description}
                onChange={t.update('description')}
                placeholder="Auto-fills from master data if available"
              />
            </div>

            <div className="form-group">
              <label>Quantity *</label>
              <input
                type="number" value={t.form.quantity}
                onChange={t.update('quantity')}
                placeholder="0" min="0" step="any"
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

          {showEachsWarning && (
            <div className="warning-box mt-12">
              <span className="warning-icon">⚠️</span>
              <div><strong>{EACHS_WARNING.title}</strong>{EACHS_WARNING.body}</div>
            </div>
          )}

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
