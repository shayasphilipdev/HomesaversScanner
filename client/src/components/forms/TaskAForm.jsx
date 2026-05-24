import MultiSelectDropdown from './MultiSelectDropdown.jsx'
import { UOM_OPTIONS, PACK_WARNING_TRIGGER, EACHS_WARNING } from '../../lib/uom.js'
import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

const EMPTY = {
  product_code: '', uom: '', quantity: '', notes: ''
}

// Task A — UOM Errors. Auto-fills description from the Alternate Barcode item.
export default function TaskAForm({ onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({
    initial: EMPTY,
    // Pull the item name into the description on scan (UOM stays manual).
    onLookup: ({ product, setForm }) =>
      setForm(f => ({ ...f, description: f.description || product.item_name || '' }))
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
        uom:                t.form.uom,
        quantity:           Number(t.form.quantity),
        notes:              t.form.notes.trim() || null,
        ...altFields(t.lookupInfo, t.form.product_code.trim()),
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

  const uomOptions = UOM_OPTIONS.map(o => ({ id: o.value, label: o.label }))

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Barcode *"
              value={t.form.product_code}
              onChange={v => t.update('product_code')(v)}
              onConfirm={t.triggerLookup}
              lookupLoading={t.lookupLoading}
              readerId="reader-a"
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group">
              <label>UOM *</label>
              <MultiSelectDropdown
                single
                options={uomOptions}
                value={t.form.uom ? [t.form.uom] : []}
                onChange={arr => t.update('uom')(arr[0] || '')}
                placeholder="Select UOM…"
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
