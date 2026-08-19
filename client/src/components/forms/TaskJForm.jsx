import { useState, useRef } from 'react'
import { createTaskRecord, lookupPrice } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task J — Department Check.
// Scan a barcode → auto-fills Department (ItemGroup from the prices/ItemMaster
// table, resolved via EAN barcode from the alt_barcodes lookup).
const EMPTY = { product_code: '' }

export default function TaskJForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [priceInfo, setPriceInfo] = useState(null)

  // After the alt-barcode row resolves, do a second lookup for the department.
  // Uses the gen/genRef forwarded from useTaskForm so a stale prices lookup
  // (from a scan that was superseded by reset or a newer scan) never writes
  // to priceInfo — preventing stale item_group from bleeding into the next record.
  const handleLookup = async ({ product, gen, genRef }) => {
    if (!product.ean_barcode) return
    try {
      const price = await lookupPrice(product.ean_barcode)
      if (gen !== genRef.current) return   // superseded
      setPriceInfo(price)
    } catch { /* silent */ }
  }

  const t = useTaskForm({ initial: EMPTY, onLookup: handleLookup })

  // Wrap triggerLookup so that starting a new scan also wipes the stale
  // priceInfo immediately (avoids the old department showing between scans).
  const handleConfirm = (code) => {
    setPriceInfo(null)
    t.triggerLookup(code)
  }

  const handleReset = () => {
    t.reset()         // also increments genRef, invalidating in-flight lookups
    setPriceInfo(null)
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
          item_group: priceInfo?.item_group || null
        },
        status: 'pending'
      })
      handleReset()
      onSaved?.({ queued: !!res?.queued, record: res?.queued ? null : res })
    } catch (err) {
      t.setError(err.message)
    } finally {
      t.setSaving(false)
    }
  }

  const dept         = priceInfo?.item_group || ''
  const deptMiss     = t.lookupInfo && priceInfo === null && !t.lookupLoading
  const deptNotFound = t.lookupInfo && priceInfo !== null && !dept

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
            readerId="reader-j"
            placeholder="Scan or type the barcode"
            inlineAction={
              <button type="submit" className="btn btn-primary" disabled={t.saving || t.lookupLoading} style={{ whiteSpace: 'nowrap' }}>
                {t.saving ? <span className="spinner" /> : 'Save'}
              </button>
            }
          />

          {/* Department + Product Status are folded into the lookup box (below
              the Selling Price) to save vertical space — no separate field. */}
          <LookupBanner
            info={t.lookupInfo}
            price={priceInfo?.sale_rate}
            productStatus={priceInfo?.product_type}
            department={dept}
            departmentEmpty={
              deptMiss        ? 'Barcode not in price list' :
              deptNotFound    ? 'No department on record'   :
              t.lookupLoading ? 'Looking up…'               : ''
            }
          />

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
