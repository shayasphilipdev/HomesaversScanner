import { useState } from 'react'
import { lookupProduct } from '../../lib/api.js'

// Shared state + behaviour for the 8 HO Task forms (A, B, C, D, E, F, G, H, I).
// Each form still owns its own EMPTY shape, validation, JSX, and payload
// builder -- this hook just removes the boilerplate that's identical across
// all of them: state slots, supplier auto-fill from /products/lookup,
// and the saving/error/lookup-loading flags.
//
// Usage:
//   const t = useTaskForm({ initial: EMPTY })
//   <ScannerInput value={t.form.product_code} onChange={t.update('product_code')}
//                 onConfirm={t.triggerLookup} lookupLoading={t.lookupLoading} />
//   <LookupBanner info={t.lookupInfo} />
//   ...
//   t.reset() / t.setError(...) / t.setSaving(true)
//
// Optional onLookup({ product, setForm }) hook lets a form add task-specific
// auto-fills (e.g. Task A copies description + uom too).
export function useTaskForm({ initial, onLookup } = {}) {
  const [form, setForm]           = useState(initial || {})
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupInfo, setLookupInfo]       = useState(null)

  // Quick curried setter for any field: <input onChange={t.update('uom')} />
  const update = (key) => (v) => {
    setForm(f => ({ ...f, [key]: v?.target ? v.target.value : v }))
    if (error) setError('')
  }

  // Patch the form with an object; useful when several fields change at once.
  const patch = (next) => setForm(f => ({ ...f, ...next }))

  // Reset to the initial shape and wipe transient state.
  const reset = () => { setForm(initial || {}); setLookupInfo(null); setError('') }

  // Scan -> resolve product master -> auto-fill supplier and call the
  // form-specific onLookup hook (so e.g. Task A can also auto-fill uom).
  const triggerLookup = async (code) => {
    if (!code || code.length < 4) { setLookupInfo(null); return }
    setLookupLoading(true)
    try {
      const p = await lookupProduct(code)
      if (p) {
        setForm(f => ({
          ...f,
          supplier_id:        p.supplier_id || f.supplier_id || '',
          supplier_name_text: p.supplier_id ? '' : (f.supplier_name_text || '')
        }))
        setLookupInfo(p)
        if (typeof onLookup === 'function') onLookup({ product: p, setForm })
      } else {
        setLookupInfo(null)
      }
    } catch {
      // Silent on lookup miss -- the user fills the description manually.
    } finally {
      setLookupLoading(false)
    }
  }

  return {
    form, setForm, patch, update, reset,
    saving, setSaving,
    error,  setError,
    lookupLoading,
    lookupInfo, setLookupInfo,
    triggerLookup
  }
}

// Shared subheader shown under the scanner input once a product is
// resolved -- 'Product: X · Supplier: Y'. Returns null when there's
// nothing to show, so it's safe to drop into any task form unconditionally.
export function LookupBanner({ info }) {
  if (!info) return null
  return (
    <div className="form-group full" style={{ marginTop: -6 }}>
      <span className="note" style={{ fontSize: 12.5 }}>
        {info.description    && <>Product: <strong>{info.description}</strong></>}
        {info.description    && info.supplier_name && ' · '}
        {info.supplier_name  && <>Supplier: <strong>{info.supplier_name}</strong></>}
      </span>
    </div>
  )
}
