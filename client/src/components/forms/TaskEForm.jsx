import MultiSelectDropdown from './MultiSelectDropdown.jsx'
import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

const CURRENCY_OPTIONS = [
  { id: 'GBP', label: '£ Pound (GBP)' },
  { id: 'EUR', label: '€ Euro (EUR)' }
]

// Task E — Price Marked Products
const EMPTY = {
  product_code: '', price_marked_price: '', currency: 'GBP', notes: ''
}

export default function TaskEForm({ onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({ initial: EMPTY })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim())   return t.setError('Product code is required.')
    if (t.form.price_marked_price === '' || isNaN(Number(t.form.price_marked_price)))
                                       return t.setError('Price marked price must be a number.')

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'E',
        store_id:           storeId || session.storeId || null,
        product_code:       t.form.product_code.trim(),
        notes:              t.form.notes.trim() || null,
        ...altFields(t.lookupInfo, t.form.product_code.trim()),
        details:            { price_marked_price: Number(t.form.price_marked_price), price_marked_currency: t.form.currency },
        status:             'pending'
      })
      t.reset()
      onSaved?.({ queued: !!res?.queued })
    } catch (err) { t.setError(err.message) } finally { t.setSaving(false) }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Barcode *"
              value={t.form.product_code}
              onChange={t.update('product_code')}
              onConfirm={t.triggerLookup}
              lookupLoading={t.lookupLoading}
              readerId="reader-e"
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group">
              <label>Currency *</label>
              <MultiSelectDropdown
                single
                options={CURRENCY_OPTIONS}
                value={t.form.currency ? [t.form.currency] : []}
                onChange={arr => t.update('currency')(arr[0] || 'GBP')}
                placeholder="Select currency…"
              />
            </div>

            <div className="form-group">
              <label>Price Marked Price *</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {t.form.currency === 'EUR' ? '€' : '£'}
                </span>
                <input
                  type="number" value={t.form.price_marked_price}
                  onChange={t.update('price_marked_price')}
                  placeholder="0.00" min="0" step="0.01"
                  style={{ paddingLeft: 24 }}
                />
              </div>
            </div>

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
