import { useState } from 'react'
import { UOM_OPTIONS, PACK_WARNING_TRIGGER, EACHS_WARNING } from '../../lib/uom.js'
import { createTaskRecord, uploadPhoto, deletePhoto, lookupProduct } from '../../lib/api.js'
import { newPhotoNamespace } from '../../lib/photos.js'
import { add as outboxAdd, isOfflineError } from '../../lib/outbox.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import SupplierPicker from './SupplierPicker.jsx'
import PhotoCapture from './PhotoCapture.jsx'

const EMPTY = {
  product_barcode: '', description: '', uom: '', quantity: '',
  supplier_id: '', supplier_name_text: '', notes: ''
}

// Task B — Non-Scans
// Fields: product_barcode, description, uom, quantity,
//         photo of product (mandatory), photo of barcode (mandatory),
//         supplier, notes
export default function TaskBForm({ onSaved }) {
  const { session } = useStore()
  const [form, setForm]               = useState(EMPTY)
  const [productPhoto, setProductPhoto] = useState(null)  // Blob
  const [barcodePhoto, setBarcodePhoto] = useState(null)  // Blob
  const [saving, setSaving]           = useState(false)
  const [savingStep, setSavingStep]   = useState('')
  const [error, setError]             = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) return
    setLookupLoading(true)
    try {
      const p = await lookupProduct(code)
      if (p) {
        setForm(f => ({ ...f, description: p.description || f.description, uom: p.uom || f.uom }))
      }
    } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_barcode.trim())              return setError('Product barcode is required.')
    if (!form.description.trim())                   return setError('Description is required.')
    if (!form.uom)                                  return setError('UOM is required.')
    if (form.quantity === '' || isNaN(Number(form.quantity)))
                                                    return setError('Quantity must be a number.')
    if (!productPhoto)                              return setError('Product photo is required.')
    if (!barcodePhoto)                              return setError('Barcode photo is required.')

    setSaving(true); setError('')
    const tempId = newPhotoNamespace()
    let productPath = null, barcodePath = null

    const body = {
      task_type:          'B',
      store_id:           session.storeId || null,
      product_barcode:    form.product_barcode.trim(),
      description:        form.description.trim(),
      uom:                form.uom,
      quantity:           Number(form.quantity),
      supplier_id:        form.supplier_id || null,
      supplier_name_text: form.supplier_name_text.trim() || null,
      notes:              form.notes.trim() || null,
      status:             'pending'
    }

    try {
      setSavingStep('Uploading product photo…')
      const p = await uploadPhoto({ file: productPhoto, slot: 'product', tempId })
      productPath = p.path

      setSavingStep('Uploading barcode photo…')
      const b = await uploadPhoto({ file: barcodePhoto, slot: 'barcode', tempId })
      barcodePath = b.path

      setSavingStep('Saving record…')
      await createTaskRecord({ ...body, photo_product_url: p.url, photo_barcode_url: b.url })

      setForm(EMPTY); setProductPhoto(null); setBarcodePhoto(null)
      onSaved?.({ queued: false })
    } catch (err) {
      if (isOfflineError(err)) {
        // Queue the full operation (body + both photo Blobs) and clear the form.
        await outboxAdd({ kind: 'with_photos', body, photos: { product: productPhoto, barcode: barcodePhoto } })
        setForm(EMPTY); setProductPhoto(null); setBarcodePhoto(null)
        // Clean up any partial photo uploads that did make it through before
        // the connection dropped — they'd otherwise be orphans.
        if (productPath) deletePhoto(productPath).catch(() => {})
        if (barcodePath) deletePhoto(barcodePath).catch(() => {})
        onSaved?.({ queued: true })
      } else {
        setError(err.message || 'Save failed')
        if (productPath) deletePhoto(productPath).catch(() => {})
        if (barcodePath) deletePhoto(barcodePath).catch(() => {})
      }
    } finally {
      setSaving(false)
      setSavingStep('')
    }
  }

  const showEachsWarning = form.uom === PACK_WARNING_TRIGGER

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">B — Non-Scans</div>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Barcode *"
              value={form.product_barcode}
              onChange={v => { setForm(f => ({ ...f, product_barcode: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-b"
            />

            <div className="form-group">
              <label>UOM *</label>
              <select value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} required>
                <option value="">Select UOM…</option>
                {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="form-group full">
              <label>Description *</label>
              <input
                type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What is the product?"
              />
            </div>

            <div className="form-group">
              <label>Quantity *</label>
              <input
                type="number" value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="0" min="0" step="any"
              />
            </div>

            <PhotoCapture
              label="Photo of the product"
              value={productPhoto}
              onChange={setProductPhoto}
              required
            />

            <PhotoCapture
              label="Photo of the barcode"
              value={barcodePhoto}
              onChange={setBarcodePhoto}
              required
            />

            <SupplierPicker
              value={{ supplier_id: form.supplier_id, supplier_name_text: form.supplier_name_text }}
              onChange={({ supplier_id, supplier_name_text }) => setForm(f => ({ ...f, supplier_id, supplier_name_text }))}
            />

            <div className="form-group full">
              <label>Notes (optional)</label>
              <textarea
                rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Anything worth flagging…"
              />
            </div>
          </div>

          {showEachsWarning && (
            <div className="warning-box mt-12">
              <span className="warning-icon">⚠️</span>
              <div><strong>{EACHS_WARNING.title}</strong>{EACHS_WARNING.body}</div>
            </div>
          )}

          {error && <div className="login-error mt-12">{error}</div>}

          <div className="flex-row mt-20" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => { setForm(EMPTY); setProductPhoto(null); setBarcodePhoto(null); setError('') }}>
              Clear
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> {savingStep || 'Saving…'}</> : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
