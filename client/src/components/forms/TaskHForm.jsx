import { useState } from 'react'
import { createTaskRecord, lookupProduct } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'

// Task H — Stock Count
// product_code, shop_floor_count, notes
const EMPTY = { product_code: '', shop_floor_count: '', notes: '' }

export default function TaskHForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) return
    setLookupLoading(true)
    try { await lookupProduct(code) } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim()) return setError('Product code is required.')
    if (form.shop_floor_count === '' || isNaN(Number(form.shop_floor_count)))
                                   return setError('Count must be a number.')
    if (Number(form.shop_floor_count) < 0)
                                   return setError('Count cannot be negative.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:    'H',
        store_id:           storeId || session.storeId || null,
        product_code: form.product_code.trim(),
        notes:        form.notes.trim() || null,
        details: { shop_floor_count: Number(form.shop_floor_count) },
        status:       'pending'
      })
      setForm(EMPTY)
      onSaved?.({ queued: !!res?.queued })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">H — Stock Count</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-h"
              placeholder="Scan or type the product ID"
            />

            <div className="form-group">
              <label>Count in the Shop Floor *</label>
              <input
                type="number" value={form.shop_floor_count}
                onChange={e => setForm(f => ({ ...f, shop_floor_count: e.target.value }))}
                placeholder="0" min="0" step="1"
                autoFocus
              />
            </div>

            <div className="form-group full">
              <label>Notes (optional)</label>
              <textarea
                rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Anything worth flagging…"
              />
            </div>
          </div>

          {error && <div className="login-error mt-12">{error}</div>}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => { setForm(EMPTY); setError('') }}>
              Clear
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
