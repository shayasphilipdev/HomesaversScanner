import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Tasks D (Wrong Description) and I (Miscellaneous Tasks) share an identical
// field set: product_code, product_name_label, notes.
// Uses the shared useTaskForm hook (M22 refactor).

const EMPTY = { product_code: '', product_name_label: '', notes: '' }

const HINTS = {
  D: 'Use this when the description in the system does not match the product in front of you.',
  I: 'For anything that does not fit the other task types.'
}

export default function TaskDIForm({ taskType, onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({
    initial: EMPTY,
    onLookup: ({ product, setForm }) => {
      // For Task D the user must type what the label actually says — never pre-fill
      // with the system description, as staff would just save it unchanged.
      if (taskType !== 'D') {
        setForm(f => ({ ...f, product_name_label: f.product_name_label || product.item_name || '' }))
      }
    }
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim())       return t.setError('Product code is required.')
    if (!t.form.product_name_label.trim()) return t.setError('Product name (as on the product) is required.')
    if (taskType === 'D' && t.lookupInfo?.item_name &&
        t.form.product_name_label.trim().toLowerCase() === t.lookupInfo.item_name.trim().toLowerCase()) {
      return t.setError('The description you entered matches the system description. Please enter exactly what is printed on the product label.')
    }

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:          taskType,
        store_id:           storeId || session.storeId || null,
        product_code:       t.form.product_code.trim(),
        product_name_label: t.form.product_name_label.trim(),
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

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>{HINTS[taskType]}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Barcode *"
              value={t.form.product_code}
              onChange={v => { t.update('product_code')(v); t.setError('') }}
              onConfirm={t.triggerLookup}
              lookupLoading={t.lookupLoading}
              readerId={`reader-${taskType.toLowerCase()}-code`}
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group full">
              <label>Product Name (as on the product) *</label>
              <input
                type="text" value={t.form.product_name_label}
                onChange={t.update('product_name_label')}
                placeholder="Exactly what is printed on the product"
              />
            </div>

            <div className="form-group full">
              <label>Notes (optional)</label>
              <textarea
                rows={2} value={t.form.notes}
                onChange={t.update('notes')}
                placeholder="Anything worth flagging…"
              />
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
