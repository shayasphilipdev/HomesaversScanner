import { useEffect, useState } from 'react'
import { createTaskRecord, lookupAltBarcode, getLookupOptions } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { LookupBanner, altFields } from './useTaskForm.jsx'

// Task F — DRS (Deposit Return Scheme) Errors
// product_code, drs_size (from lookup_options master),
// units_per_package, supplier, notes
//
// Shows a persistent warning: the staff member must verify the Return Logo
// is on the product before logging a DRS error.
const EMPTY = {
  product_code: '', drs_size: '', units_per_package: '', notes: ''
}

// Parse a size label like "500ml", "330 ml", "1L", "1.5 l", "33cl" → millilitres.
// Returns null when the label can't be interpreted as a volume.
function sizeLabelToMl(label) {
  if (!label) return null
  const m = String(label).trim().toLowerCase().match(/([\d.]+)\s*(ml|cl|l|litre|liter)\b/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!isFinite(n)) return null
  switch (m[2]) {
    case 'ml':                                return n
    case 'cl':                                return n * 10
    case 'l': case 'litre': case 'liter':     return n * 1000
    default:                                  return null
  }
}

// DRS deposit per single container: 15 cents under 500 ml, 25 cents at 500 ml+.
function depositPerUnitCents(ml) {
  if (ml == null) return null
  return ml >= 500 ? 25 : 15
}

export default function TaskFForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [form, setForm]   = useState(EMPTY)
  const [sizes, setSizes] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupInfo, setLookupInfo] = useState(null)

  useEffect(() => {
    getLookupOptions({ kind: 'drs_size', task_type: 'F' })
      .then(setSizes)
      .catch(() => setSizes([]))
  }, [])

  const triggerLookup = async (code) => {
    if (!code || code.length < 4) { setLookupInfo(null); return }
    setLookupLoading(true)
    try {
      const p = await lookupAltBarcode(code)
      setLookupInfo(p || null)
    } catch {} finally { setLookupLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.product_code.trim()) return setError('Product code is required.')
    if (!form.drs_size)            return setError('Please select the product size.')
    if (form.units_per_package === '' || isNaN(Number(form.units_per_package)))
                                   return setError('Number of products in a unit must be a number.')
    if (Number(form.units_per_package) < 1)
                                   return setError('Number of products must be at least 1.')

    setSaving(true); setError('')
    try {
      const res = await createTaskRecord({
        task_type:          'F',
        store_id:           storeId || session.storeId || null,
        product_code:       form.product_code.trim(),
        notes:              form.notes.trim() || null,
        ...altFields(lookupInfo, form.product_code.trim()),
        details: {
          drs_size:          form.drs_size,
          units_per_package: Number(form.units_per_package)
        },
        status: 'pending'
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
      <div className="card-header">F — DRS Errors</div>
      <div className="card-body">

        {/* Persistent warning — must be visible before any data entry */}
        <div className="warning-box mb-12">
          <span className="warning-icon">⚠️</span>
          <div>
            <strong>Check for the Return Logo on the product.</strong>
            Only log a DRS error when the product is actually part of the Deposit Return Scheme — the return logo confirms this.
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <ScannerInput
              label="Product Code *"
              value={form.product_code}
              onChange={v => { setForm(f => ({ ...f, product_code: v })); setError('') }}
              onConfirm={triggerLookup}
              lookupLoading={lookupLoading}
              readerId="reader-f"
              placeholder="Scan or type the product ID"
            />

            <LookupBanner info={lookupInfo} />

            <div className="form-group">
              <label>Size of the Product *</label>
              <select value={form.drs_size} onChange={e => setForm(f => ({ ...f, drs_size: e.target.value }))} required>
                <option value="">Select size…</option>
                {sizes.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Number of Products in a Unit *</label>
              <input
                type="number" value={form.units_per_package}
                onChange={e => setForm(f => ({ ...f, units_per_package: e.target.value }))}
                placeholder="e.g. 6, 12, 24" min="1" step="1"
              />
            </div>

            {(() => {
              const ml      = sizeLabelToMl(form.drs_size)
              const perUnit = depositPerUnitCents(ml)
              const units   = Number(form.units_per_package)
              if (perUnit == null || !units || isNaN(units)) return null
              const totalCents = perUnit * units
              const totalEur   = (totalCents / 100).toFixed(2)
              return (
                <div className="form-group full">
                  <div className="warning-box" style={{ background: 'var(--surface-warm)', borderColor: 'var(--border-soft)' }}>
                    <span className="warning-icon" aria-hidden>💰</span>
                    <div>
                      <strong>DRS deposit:</strong> {units} × {perUnit}c = <strong>€{totalEur}</strong>
                      <div className="note" style={{ fontSize: 12, marginTop: 2 }}>
                        ({ml} ml per container — {ml >= 500 ? '500 ml or above → 25c each' : 'below 500 ml → 15c each'})
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

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
