import { useEffect, useState } from 'react'
import { getSuppliers } from '../../lib/api.js'

// Supplier dropdown with "Other (type a name)" fallback.
//
// Value model (controlled): { supplier_id: '' | uuid, supplier_name_text: '' | string }
// Exactly one of supplier_id / supplier_name_text is set when the user picks
// a non-empty value.
export default function SupplierPicker({ value, onChange, label = 'Supplier (optional)' }) {
  const [suppliers, setSuppliers] = useState([])
  const [mode, setMode] = useState(value.supplier_name_text ? 'other' : 'list')

  useEffect(() => {
    getSuppliers().then(setSuppliers).catch(() => setSuppliers([]))
  }, [])

  return (
    <div className="form-group">
      <label>{label}</label>
      {mode === 'list' ? (
        <select
          value={value.supplier_id}
          onChange={e => {
            const v = e.target.value
            if (v === '__other__') {
              setMode('other')
              onChange({ supplier_id: '', supplier_name_text: '' })
            } else {
              onChange({ supplier_id: v, supplier_name_text: '' })
            }
          }}
        >
          <option value="">— Select supplier —</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
          <option value="__other__">Other (type a name)…</option>
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={value.supplier_name_text}
            onChange={e => onChange({ supplier_id: '', supplier_name_text: e.target.value })}
            placeholder="Supplier name"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-sm btn-outline" onClick={() => { setMode('list'); onChange({ supplier_id: '', supplier_name_text: '' }) }}>
            Use list
          </button>
        </div>
      )}
    </div>
  )
}
