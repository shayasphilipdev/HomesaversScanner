import { useState } from 'react'
import { createTaskRecord, uploadPhoto, deletePhoto, lookupAltBarcode } from '../../lib/api.js'
import { newPhotoNamespace } from '../../lib/photos.js'
import { add as outboxAdd, isOfflineError } from '../../lib/outbox.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import PhotoCapture from './PhotoCapture.jsx'
import { LookupBanner, altFields } from './useTaskForm.jsx'

const EMPTY = {
  product_barcode: '', description: '', notes: ''
}

// Task B — Non-Scans
// Fields: product_barcode, description,
//         photo of product (mandatory), photo of barcode (mandatory),
//         supplier, notes
export default function TaskBForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [form, setForm]               = useState(EMPTY)
  const [productPhoto, setProductPhoto] = useState(null)  // Blob
  const [barcodePhoto, setBarcodePhoto] = useState(null)  // Blob
  const [saving, setSaving]           = useState(false)
  const [savingStep, setSavingStep]   = useState('')
  const [error, setError]             = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupInfo, setLookupInfo] = useState(null)

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) { setLookupInfo(null); return }
    setLookupLoading(true)
    try {
      const p = await lookupAltBarcode(code)
      if (p) {
        setForm(f => ({ ...f, description: f.description || p.item_name || '' }))
        setLookupInfo(p)
      } else {
        setLookupInfo(null)
      }
    } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_barcode.trim())              return setError('Product barcode is required.')
    if (!form.description.trim())                   return setError('Description is required.')
    if (!productPhoto)                              return setError('Product photo is required.')
    if (!barcodePhoto)                              return setError('Barcode photo is required.')

    setSaving(true); setError('')
    const tempId = newPhotoNamespace()
    let productPath = null, barcodePath = null

    const body = {
      task_type:          'B',
      store_id:           storeId || session.storeId || null,
      product_barcode:    form.product_barcode.trim(),
      description:        form.description.trim(),
      notes:              form.notes.trim() || null,
      ...altFields(lookupInfo, form.product_barcode.trim()),
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

  return (
    <div className="card" style={{ marginBottom: 24 }}>
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

            <LookupBanner info={lookupInfo} />

            <div className="form-group full">
              <label>Description *</label>
              <input
                type="text" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What is the product?"
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
