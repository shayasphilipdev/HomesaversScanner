import { useState, useRef } from 'react'
import { createTaskRecord, lookupPrice } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task J — Department Check.
// Scan a barcode → auto-fills Department (ItemGroup from the prices/ItemMaster
// table, resolved via EAN barcode from the alt_barcodes lookup).
const EMPTY = { product_code: '', item_group: '' }

export default function TaskJForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [priceInfo, setPriceInfo] = useState(null)
  const [scanKey, setScanKey] = useState(0)

  // After the alt-barcode row resolves, do a second lookup for the department.
  const handleLookup = async ({ product, setForm }) => {
    if (product.ean_barcode) {
      try {
        const price = await lookupPrice(product.ean_barcode)
        setPriceInfo(price)
        if (price?.item_group) {
          setForm(f => ({ ...f, item_group: price.item_group }))
        }
      } catch { /* silent */ }
    }
  }

  const t = useTaskForm({ initial: EMPTY, onLookup: handleLookup })

  const handleReset = () => {
    t.reset()
    setPriceInfo(null)
    setScanKey(k => k + 1)
  }

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
        details: {
          item_group: t.form.item_group || null
        },
        status: 'pending'
      })
      handleReset()
      onSaved?.({ queued: !!res?.queued })
    } catch (err) {
      t.setError(err.message)
    } finally {
      t.setSaving(false)
    }
  }

  const hasDept    = !!t.form.item_group
  const deptMiss   = t.lookupInfo && priceInfo === null
  const deptNotFound = t.lookupInfo && priceInfo !== null && !priceInfo?.item_group

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <ScannerInput
            key={scanKey}
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

          {/* Department — auto-filled from ItemMaster, read-only */}
          <div className="form-group full" style={{ marginTop: 4 }}>
            <label>Department</label>
            <input
              type="text"
              readOnly
              value={t.form.item_group}
              placeholder={
                deptMiss ? 'Barcode not in price list' :
                deptNotFound ? 'No department on record' :
                'Auto-filled on scan'
              }
              style={{
                background: 'var(--bg-soft)',
                color:      hasDept ? 'inherit' : 'var(--text-muted)'
              }}
            />
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
