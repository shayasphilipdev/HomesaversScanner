import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task J — Department Check. The simplest task: scan a barcode, save.
// No supplier, no description, no extra fields.
const EMPTY = { product_code: '' }

export default function TaskJForm({ onSaved, storeId }) {
  const { session } = useStore()
  const t = useTaskForm({ initial: EMPTY })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Scan or type a barcode first.')

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:    'J',
        store_id:     storeId || session.storeId || null,
        product_code: t.form.product_code.trim(),
        ...altFields(t.lookupInfo, t.form.product_code.trim()),
        status:       'pending'
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
      {/* No card-header — the task name is already shown in the dropdown above. */}
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          {/* Save sits inline to the right of the barcode (and so ABOVE the
              camera band), reachable without scrolling under the keyboard. */}
          <ScannerInput
            label="Barcode *"
            value={t.form.product_code}
            onChange={t.update('product_code')}
            onConfirm={t.triggerLookup}
            lookupLoading={t.lookupLoading}
            readerId="reader-j"
            placeholder="Scan or type the barcode"
            inlineAction={
              <button type="submit" className="btn btn-primary" disabled={t.saving} style={{ whiteSpace: 'nowrap' }}>
                {t.saving ? <span className="spinner" /> : 'Save'}
              </button>
            }
          />

          <LookupBanner info={t.lookupInfo} />

          {t.error && <div className="login-error mt-12">{t.error}</div>}
        </form>
      </div>
    </div>
  )
}
