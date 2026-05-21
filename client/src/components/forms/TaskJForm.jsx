import { createTaskRecord } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm } from './useTaskForm.jsx'

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
      <div className="card-header">J — Department Check</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          {/* Barcode + Save side by side so the action is right next to the
              scan field — no scrolling under the keyboard on a phone. */}
          <div className="flex-row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ScannerInput
                label="Barcode *"
                value={t.form.product_code}
                onChange={t.update('product_code')}
                lookupLoading={false}
                readerId="reader-j"
                placeholder="Scan or type the barcode"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={t.saving} style={{ marginBottom: 2, whiteSpace: 'nowrap' }}>
              {t.saving ? <span className="spinner" /> : 'Save'}
            </button>
          </div>

          {t.error && <div className="login-error mt-12">{t.error}</div>}
        </form>
      </div>
    </div>
  )
}
