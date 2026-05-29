import { useState } from 'react'
import { createTaskRecord, lookupPrice } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task K — Price Check
// Scan a barcode → auto-fills Product Description (from alt_barcodes) and
// Selling Price (from the prices / ItemMaster table via EAN barcode).
const EMPTY = { product_code: '', description: '', sale_rate: '', item_group: '' }

export default function TaskKForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [priceInfo, setPriceInfo] = useState(null)

  // onLookup fires after the alt-barcode row resolves.  We then do a second
  // request to /api/prices/lookup to pull the ItemMaster selling price.
  const handleLookup = async ({ product, setForm }) => {
    // Auto-fill description from the Alternate Barcode master.
    if (product.item_name) {
      setForm(f => ({ ...f, description: product.item_name }))
    }
    // Price lookup by EAN barcode (step 2).
    if (product.ean_barcode) {
      try {
        const price = await lookupPrice(product.ean_barcode)
        setPriceInfo(price)
        if (price) {
          setForm(f => ({
            ...f,
            sale_rate:  price.sale_rate != null ? String(price.sale_rate) : '',
            item_group: price.item_group || ''
          }))
        }
      } catch { /* silent — price column is optional */ }
    }
  }

  const t = useTaskForm({ initial: EMPTY, onLookup: handleLookup })

  const handleReset = () => {
    t.reset()
    setPriceInfo(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Scan or type a barcode first.')

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord({
        task_type:    'K',
        store_id:     storeId || session.storeId || null,
        product_code: t.form.product_code.trim(),
        ...altFields(t.lookupInfo, t.form.product_code.trim()),
        details: {
          sale_rate:  t.form.sale_rate !== '' ? Number(t.form.sale_rate) : null,
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

  const hasPrice  = t.form.sale_rate !== ''
  const priceMiss = t.lookupInfo && !priceInfo

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <ScannerInput
            label="Product Barcode *"
            value={t.form.product_code}
            onChange={t.update('product_code')}
            onConfirm={t.triggerLookup}
            lookupLoading={t.lookupLoading}
            readerId="reader-k"
            placeholder="Scan or type the barcode"
            inlineAction={
              <button
                type="submit"
                className="btn btn-primary"
                disabled={t.saving}
                style={{ whiteSpace: 'nowrap' }}
              >
                {t.saving ? <span className="spinner" /> : 'Save'}
              </button>
            }
          />

          <LookupBanner info={t.lookupInfo} />

          {/* Product Description — auto-filled, editable */}
          <div className="form-group full" style={{ marginTop: 4 }}>
            <label>Product Description</label>
            <input
              type="text"
              value={t.form.description}
              onChange={t.update('description')}
              placeholder="Auto-filled on scan"
            />
          </div>

          {/* Selling Price — auto-filled from ItemMaster, read-only */}
          <div className="form-group" style={{ marginTop: 4 }}>
            <label>Selling Price (€)</label>
            <input
              type="text"
              readOnly
              value={hasPrice ? `€${Number(t.form.sale_rate).toFixed(2)}` : ''}
              placeholder={priceMiss ? 'Not found in price list' : 'Auto-filled on scan'}
              style={{
                background: 'var(--bg-soft)',
                color:      hasPrice ? 'inherit' : 'var(--text-muted)'
              }}
            />
            {priceMiss && (
              <span className="note" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                This barcode was not found in the ItemMaster price list.
              </span>
            )}
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
