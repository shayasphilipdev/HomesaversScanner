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
          <div className="form-grid">
            <ScannerInput
              label="Barcode *"
              value={t.form.product_code}
              onChange={t.update('product_code')}
              lookupLoading={false}
              readerId="reader-j"
              placeholder="Scan or type the barcode"
            />
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
