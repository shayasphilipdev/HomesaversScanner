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

  // onLookup only fires on a HIT, so a scan that misses leaves whatever the
  // PREVIOUS product put in this field sitting against the new barcode — and on
  // Task D the operator cannot see it is stale, let alone edit it, because the
  // field is read-only. Clearing it before each scan is the same guard
  // TaskKForm applies to its description/price. Task I's copy of the field is
  // user-editable, so it must never be wiped from under them.
  const handleConfirm = (code) => {
    if (taskType === 'D') t.setForm(f => ({ ...f, product_name_label: '' }))
    t.triggerLookup(code)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Product code is required.')
    // Only Task I can be held to this. On Task D the field is a read-only
    // system reference filled solely by a successful lookup, so requiring it
    // made the form impossible to submit whenever the lookup returned nothing
    // — offline, timed out, or a barcode not in the master — and the operator
    // had no way to supply it. The report's actual content is product_code +
    // actual_product_name + notes, all of which are still required below.
    if (taskType !== 'D' && !t.form.product_name_label.trim()) {
      return t.setError('Product name is required.')
    }
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
      onSaved?.({ queued: !!res?.queued, record: res?.queued ? null : res })
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
              onConfirm={handleConfirm}
              lookupLoading={t.lookupLoading}
              readerId={`reader-${taskType.toLowerCase()}-code`}
            />

            <LookupBanner info={t.lookupInfo} />

            <div className="form-group full">
              {/* No asterisk on Task D — the field is a read-only system
                  reference there and is no longer required to save. */}
              <label>Product Name (as on the product){taskType === 'D' ? '' : ' *'}</label>
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
            <button type="submit" className="btn btn-primary" disabled={t.saving || (t.lookupLoading && navigator.onLine)}>
              {t.saving ? <><span className="spinner" /> Saving…</> : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
