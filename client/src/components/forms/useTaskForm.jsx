import { useState } from 'react'
import { lookupAltBarcode } from '../../lib/api.js'

// Shared state + behaviour for the HO Task forms (A–J).
// Each form still owns its own EMPTY shape, validation, JSX, and payload
// builder -- this hook just removes the boilerplate that's identical across
// all of them: state slots, alt-barcode auto-fill from /alt-barcodes/lookup,
// and the saving/error/lookup-loading flags.
//
// Phase 3: Barcode_No is the primary key. A scan resolves the Alternate
// Barcode row and exposes it via t.lookupInfo (item_name, supl_id,
// supplier_code, item_status, barcode_status). Inactive items still save.
//
// Usage:
//   const t = useTaskForm({ initial: EMPTY })
//   <ScannerInput value={t.form.product_code} onChange={t.update('product_code')}
//                 onConfirm={t.triggerLookup} lookupLoading={t.lookupLoading} />
//   <LookupBanner info={t.lookupInfo} />
//
// altFields(t) returns the alt-barcode columns to merge into the saved record.
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

  // Scan -> resolve the Alternate Barcode row by Barcode_No -> stash the
  // result for the banner and the form-specific onLookup hook.
  const triggerLookup = async (code) => {
    if (!code || code.length < 4) { setLookupInfo(null); return }
    setLookupLoading(true)
    try {
      const p = await lookupAltBarcode(code)
      if (p) {
        setLookupInfo(p)
        if (typeof onLookup === 'function') onLookup({ product: p, setForm })
      } else {
        setLookupInfo(null)
      }
    } catch {
      // Silent on lookup miss -- the user can still save the raw barcode.
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

// The alt-barcode columns to persist on a task_records row. Spread into the
// createTaskRecord payload so reports can show item/supplier/status without a
// second lookup. barcode_no = scanned Barcode_No; product_barcode = EAN from lookup.
export function altFields(info, barcode) {
  return {
    barcode_no:      (barcode || info?.barcode_no || '') || null,
    product_barcode: info?.ean_barcode   || null,   // EAN → "Product Code" in reports
    item_name:       info?.item_name     || null,
    supl_id:         info?.supl_id       || null,
    supplier_code:   info?.supplier_code || null,
    item_status:     info?.item_status   || null,
    barcode_status:  info?.barcode_status|| null
  }
}

// Small Active / Inactive pill. Active = green, Inactive = amber. Anything
// else (unknown source value) renders neutral grey.
function StatusPill({ label, value }) {
  const v = (value || '').toLowerCase()
  const tone = v === 'active'
    ? { bg: '#E6F4EA', fg: '#1E7B34', dot: '#3E9F4B' }
    : v === 'inactive'
      ? { bg: '#FCF3E2', fg: '#9A6B12', dot: '#E0A03A' }
      : { bg: 'var(--bg-soft)', fg: 'var(--text-muted)', dot: 'var(--text-muted)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: tone.bg, color: tone.fg, borderRadius: 999,
      padding: '2px 10px', fontSize: 12, fontWeight: 600
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.dot }} />
      {label}: {value || '—'}
    </span>
  )
}

// Shown under the scanner input once a barcode resolves against the
// Alternate Barcode table. Shows Product Code (EAN), Product Description,
// Supplier, and Product / Barcode status pills.
export function LookupBanner({ info }) {
  if (!info) return null
  const supplier = [info.supl_id, info.supplier_code].filter(Boolean).join(' · ')
  return (
    <div className="form-group full" style={{
      marginTop: -2, marginBottom: 6,
      background: 'var(--surface-warm)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px', gap: 6
    }}>
      {info.item_name && (
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
          <span className="note" style={{ fontSize: 11, fontWeight: 400 }}>Product Description: </span>
          {info.item_name}
        </div>
      )}
      {info.ean_barcode && (
        <div className="note" style={{ fontSize: 12.5 }}>Product Code: <strong>{info.ean_barcode}</strong></div>
      )}
      {supplier && (
        <div className="note" style={{ fontSize: 12.5 }}>Supplier: <strong>{supplier}</strong></div>
      )}
      <div className="flex-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <StatusPill label="Product" value={info.item_status} />
        <StatusPill label="Barcode" value={info.barcode_status} />
      </div>
    </div>
  )
}
