import { useState } from 'react'
import { createTaskRecord, lookupPrice } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task L — Expiry Date Check (Operations).
// Scan a barcode → shows the standard lookup box (Product Id, Description,
// Product Status, Item/Barcode Status), then the user records an Expiry Date
// (+ optional Action). Behaves like Department Check / Price Check: same scanner
// / HID handling, offline queue, and Save gated on the in-flight lookup.
const EMPTY = { product_code: '' }

const ACTIONS = ['Reduced', 'Removed', 'Rotated', 'OK / In date']

// Days from today (local midnight) to the entered YYYY-MM-DD expiry date.
function daysUntil(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}

export default function TaskLForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [priceInfo, setPriceInfo] = useState(null)
  const [expiry, setExpiry] = useState('')
  const [action, setAction] = useState('')

  // Product Status (product_type) for the info box — resolved from the price
  // table via EAN, guarded against a superseded scan (gen/genRef) so a stale
  // result never lands on the next record.
  const handleLookup = async ({ product, gen, genRef }) => {
    if (!product.ean_barcode) return
    try {
      const price = await lookupPrice(product.ean_barcode)
      if (gen !== genRef.current) return
      setPriceInfo(price)
    } catch { /* silent */ }
  }

  const t = useTaskForm({ initial: EMPTY, onLookup: handleLookup })

  const handleConfirm = (code) => {
    setPriceInfo(null)
    t.triggerLookup(code)
  }

  const handleReset = () => {
    t.reset()
    setPriceInfo(null)
    setExpiry('')
    setAction('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Scan or type a barcode first.')
    if (!expiry) return t.setError('Enter the expiry date.')

    const body = {
      task_type:    'L',
      store_id:     storeId || session.storeId || null,
      product_code: t.form.product_code.trim(),
      ...altFields(t.lookupInfo, t.form.product_code.trim()),
      details: {
        expiry_date:  expiry,
        action_taken: action || null
      },
      status: 'pending'
    }

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord(body)
      handleReset()
      onSaved?.({ queued: !!res?.queued, record: res?.queued ? null : res })
    } catch (err) {
      t.setError(err.message)
    } finally {
      t.setSaving(false)
    }
  }

  const days = daysUntil(expiry)
  const expiryTone = days == null ? null
    : days < 0   ? { c: 'var(--red, #c0392b)', t: `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago` }
    : days <= 7  ? { c: 'var(--red, #c0392b)', t: `${days} day${days !== 1 ? 's' : ''} left — short-dated` }
    : days <= 14 ? { c: '#B47F1E',             t: `${days} days left` }
    :              { c: '#1E7B34',             t: `${days} days left` }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <ScannerInput
            label="Barcode *"
            value={t.form.product_code}
            onChange={t.update('product_code')}
            onConfirm={handleConfirm}
            lookupLoading={t.lookupLoading}
            readerId="reader-l"
            placeholder="Scan or type the barcode"
            inlineAction={
              <button type="submit" className="btn btn-primary" disabled={t.saving || (t.lookupLoading && navigator.onLine)} style={{ whiteSpace: 'nowrap' }}>
                {t.saving ? <span className="spinner" /> : 'Save'}
              </button>
            }
          />

          {/* Standard lookup box — Product Id (Code), Description, Product Status,
              Item / Barcode status — same as Department Check / Price Check. */}
          <LookupBanner info={t.lookupInfo} productStatus={priceInfo?.product_type} />

          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="form-group">
              <label>Expiry Date *</label>
              <input
                type="date"
                value={expiry}
                min="2000-01-01"
                onChange={e => { setExpiry(e.target.value); if (t.error) t.setError('') }}
              />
              {expiryTone && (
                <div className="note" style={{ fontSize: 12, marginTop: 4, color: expiryTone.c, fontWeight: 600 }}>
                  {expiryTone.t}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Action taken</label>
              <select value={action} onChange={e => setAction(e.target.value)}>
                <option value="">— optional —</option>
                {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleReset}>
              ✕ Clear
            </button>
          </div>

          {t.error && <div className="login-error mt-12">{t.error}</div>}
        </form>
      </div>
    </div>
  )
}
