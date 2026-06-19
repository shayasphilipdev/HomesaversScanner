import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Tasks D (Wrong Description) and I (Miscellaneous Tasks) share an identical
// field set: product_code, product_name_label, notes.
// Task D adds actual_product_name — what the label physically shows.
// Uses the shared useTaskForm hook (M22 refactor).

const EMPTY = { product_code: '', product_name_label: '', actual_product_name: '', notes: '' }

const HINTS = {
  D: 'Use this when the description in the system does not match the product in front of you.',
  I: 'For anything that does not fit the other task types.'
}

export default function TaskDIForm({ taskType, onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({
    initial: EMPTY,
    onLookup: ({ product, setForm }) => {
      setForm(f => ({
        ...f,
        // Task D: always overwrite with system description (field is read-only reference).
        // Task I: only fill if user hasn't typed anything yet.
        product_name_label: taskType === 'D'
          ? (product.item_name || '')
          : (f.product_name_label || product.item_name || '')
      }))
    }
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Product code is required.')
    if (!t.form.product_name_label.trim()) return t.setError('Product name is required.')
    if (taskType === 'D') {
      if (!t.form.actual_product_name.trim()) return t.setError('Actual product name is required.')
      if (t.form.actual_product_name.trim().length <= 2) return t.setError('Actual product name must be more than 2 characters.')
    }

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:            taskType,
        store_id:             storeId || session.storeId || null,
        product_code:         t.form.product_code.trim(),
        product_name_label:   t.form.product_name_label.trim(),
        actual_product_name:  taskType === 'D' ? (t.form.actual_product_name.trim() || null) : null,
        notes:                t.form.notes.trim() || null,
        ...altFields(t.lookupInfo, t.form.product_code.trim()),
        status:               'pending'
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
                readOnly={taskType === 'D'}
                onChange={taskType === 'D' ? undefined : t.update('product_name_label')}
                placeholder="Exactly what is printed on the product"
                style={taskType === 'D' ? { background: 'var(--input-disabled-bg, #f0f0f0)', color: 'var(--text-muted, #888)', cursor: 'default' } : undefined}
              />
            </div>

            {taskType === 'D' && (
              <div className="form-group full">
                <label>Actual Product Name *</label>
                <input
                  type="text" value={t.form.actual_product_name}
                  onChange={t.update('actual_product_name')}
                  placeholder="What is actually printed on the product label"
                />
              </div>
            )}

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
