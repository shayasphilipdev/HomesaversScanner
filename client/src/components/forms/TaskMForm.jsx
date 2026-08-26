import { useState, useRef, useEffect } from 'react'
import { createTaskRecord, lookupPrice } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task M — Routine Expiry Sweep (Operations).
// Replaces the old Expiry Date Check (L). Built for walking an aisle and
// logging many products in one session: pick a category once, then scan →
// expiry → units → action → Save & next, without leaving the form. The action
// is pre-suggested from days-to-expiry + category (Reduce to Clear ladder) and
// can be overridden. Category and the session count persist across saves.

// Sweep categories — drive the markdown trigger and the suggested action.
const CATEGORIES = [
  'Confectionery',
  'Bakery / Ambient',
  'Drinks',
  'Grocery / Canned',
  'Health / Pharmacy',
  'Seasonal / Other',
]

// The Reduce to Clear action ladder. pct = markdown percentage (null = write off).
const ACTIONS = [
  { v: 'Rotate',     pct: 0    },
  { v: 'Reduce 30%', pct: 30   },
  { v: 'Reduce 50%', pct: 50   },
  { v: 'Reduce 75%', pct: 75   },
  { v: 'Write Off',  pct: null },
]

const EMPTY = { product_code: '', units: '' }

// Build YYYY-MM-DD from day/month/year strings; '' if incomplete or invalid.
// Year takes 2 digits (26 -> 2026) or 4 (2026). Impossible dates (e.g. 31/02)
// are rejected so a bad entry never saves.
function buildDate(d, m, y) {
  if (!d || !m || !y) return ''
  const dd = Number(d), mm = Number(m)
  let yy = Number(y)
  if (y.length <= 2) yy = 2000 + yy
  if (!(dd >= 1 && dd <= 31) || !(mm >= 1 && mm <= 12) || !(yy >= 2000 && yy <= 2100)) return ''
  const dt = new Date(yy, mm - 1, dd)
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return ''
  const p = n => String(n).padStart(2, '0')
  return `${yy}-${p(mm)}-${p(dd)}`
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}

// First-markdown trigger by category (days-to-expiry). Bakery is shortest-dated,
// long-life grocery/health the longest — matches the sweep cadence table.
function firstTrigger(category) {
  if (category === 'Bakery / Ambient') return 14
  if (category === 'Grocery / Canned' || category === 'Health / Pharmacy') return 30
  return 21
}

// Suggested action from days-to-expiry + category. Deeper reductions as the
// date gets closer; write off once expired.
function suggestAction(days, category) {
  if (days == null) return ''
  if (days < 0)  return 'Write Off'
  if (days <= 6) return 'Reduce 75%'
  if (days <= 14) return 'Reduce 50%'
  if (days <= firstTrigger(category)) return 'Reduce 30%'
  return 'Rotate'
}

export default function TaskMForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [priceInfo, setPriceInfo] = useState(null)
  const [category, setCategory]   = useState('')   // persists across saves
  const [d, setD] = useState('')
  const [m, setM] = useState('')
  const [y, setY] = useState('')
  const [action, setAction]         = useState('')
  const [actionAuto, setActionAuto] = useState(true) // true until user overrides
  const [sessionCount, setSessionCount] = useState(0)

  const mRef = useRef(null)
  const yRef = useRef(null)

  const handleLookup = async ({ product, gen, genRef }) => {
    if (!product.ean_barcode) return
    try {
      const price = await lookupPrice(product.ean_barcode)
      if (gen !== genRef.current) return
      setPriceInfo(price)
    } catch { /* silent */ }
  }

  const t = useTaskForm({ initial: EMPTY, onLookup: handleLookup })

  const handleConfirm = (code) => { setPriceInfo(null); t.triggerLookup(code) }

  const expiry     = buildDate(d, m, y)
  const dmyEntered = d && m && y
  const invalid    = dmyEntered && !expiry
  const days       = daysUntil(expiry)
  const suggested  = suggestAction(days, category)

  // Pre-fill the action from the suggestion until the user picks one manually.
  useEffect(() => {
    if (actionAuto) setAction(suggested)
  }, [suggested, actionAuto])

  // Clear the product-level fields for the next scan; keep category + counter.
  const clearProduct = () => {
    t.reset(); setPriceInfo(null); setD(''); setM(''); setY('')
    setAction(''); setActionAuto(true)
  }
  // Full reset — also drops the category and session count.
  const handleResetAll = () => { clearProduct(); setCategory(''); setSessionCount(0) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Scan or type a barcode first.')
    if (!expiry) return t.setError(invalid ? 'That expiry date is not valid.' : 'Enter the expiry date (day / month / year).')
    if (t.form.units !== '' && (isNaN(Number(t.form.units)) || Number(t.form.units) < 0))
      return t.setError('Units must be a number (0 or more).')

    const pct = ACTIONS.find(a => a.v === action)?.pct ?? null
    const body = {
      task_type:    'M',
      store_id:     storeId || session.storeId || null,
      product_code: t.form.product_code.trim(),
      quantity:     t.form.units === '' ? null : Number(t.form.units),
      ...altFields(t.lookupInfo, t.form.product_code.trim()),
      details: {
        category:       category || null,
        expiry_date:    expiry,
        days_to_expiry: days,
        // action_taken feeds the existing report "Action" column (same key the
        // old Expiry Date Check used), so Task M rows populate it with no
        // backend change. markdown_pct keeps the numeric value for Phase 3.
        action_taken:   action || null,
        markdown_pct:   pct,
      },
      status: 'pending',
    }

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord(body)
      setSessionCount(c => c + 1)
      clearProduct()   // ready for the next product; category stays selected
      onSaved?.({ queued: !!res?.queued, record: res?.queued ? null : res })
    } catch (err) {
      t.setError(err.message)
    } finally {
      t.setSaving(false)
    }
  }

  const tone = days == null ? null
    : days < 0   ? { c: 'var(--red, #c0392b)', t: `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago` }
    : days <= 7  ? { c: 'var(--red, #c0392b)', t: `${days} day${days !== 1 ? 's' : ''} left — short-dated` }
    : days <= 14 ? { c: '#B47F1E',             t: `${days} days left` }
    :              { c: '#1E7B34',             t: `${days} days left` }

  // Big, centred, numeric-keypad boxes; auto-advance to the next box when full.
  const boxStyle = { fontSize: 24, textAlign: 'center', padding: '12px 6px', fontWeight: 600 }
  const onDigits = (setter, next, max) => (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, max)
    setter(v)
    if (t.error) t.setError('')
    if (v.length === max && next?.current) next.current.focus()
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-body">
        <form onSubmit={handleSubmit}>
          {/* Category — pick once, stays selected for the whole sweep. */}
          <div className="form-group full" style={{ marginBottom: 8 }}>
            <label>Category <span className="note" style={{ fontWeight: 400 }}>— stays selected while you sweep</span></label>
            <div className="flex-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{ flex: 1, minWidth: 180 }}
              >
                <option value="">— choose a category —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {sessionCount > 0 && (
                <span style={{
                  fontSize: 13, fontWeight: 700, color: '#1E7B34',
                  background: '#E6F4EA', border: '1px solid #9BD3AC',
                  borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap'
                }}>
                  ✓ {sessionCount} logged this session
                </span>
              )}
            </div>
          </div>

          <ScannerInput
            label="Barcode *"
            value={t.form.product_code}
            onChange={t.update('product_code')}
            onConfirm={handleConfirm}
            lookupLoading={t.lookupLoading}
            readerId="reader-m"
            placeholder="Scan or type the barcode"
            inlineAction={
              <button type="submit" className="btn btn-primary" disabled={t.saving || (t.lookupLoading && navigator.onLine)} style={{ whiteSpace: 'nowrap' }}>
                {t.saving ? <span className="spinner" /> : 'Save & next'}
              </button>
            }
          />

          {/* Standard lookup box — Product Id (Code), Description, Product Status,
              Item / Barcode status — same as Department Check / Price Check. */}
          <LookupBanner info={t.lookupInfo} productStatus={priceInfo?.product_type} />

          <div className="form-group full" style={{ marginTop: 8 }}>
            <label>Expiry Date * <span className="note" style={{ fontWeight: 400 }}>— type day / month / year</span></label>
            <div className="flex-row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="DD" aria-label="Day"
                value={d} onChange={onDigits(setD, mRef, 2)} style={{ ...boxStyle, width: 70 }} autoComplete="off" />
              <span style={{ fontSize: 22, color: 'var(--text-muted)' }}>/</span>
              <input ref={mRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="MM" aria-label="Month"
                value={m} onChange={onDigits(setM, yRef, 2)} style={{ ...boxStyle, width: 70 }} autoComplete="off" />
              <span style={{ fontSize: 22, color: 'var(--text-muted)' }}>/</span>
              <input ref={yRef} type="text" inputMode="numeric" pattern="[0-9]*" placeholder="YY" aria-label="Year"
                value={y} onChange={onDigits(setY, null, 4)} style={{ ...boxStyle, width: 96 }} autoComplete="off" />
            </div>
            {invalid && <div className="note" style={{ fontSize: 12, marginTop: 4, color: 'var(--red, #c0392b)', fontWeight: 600 }}>Not a valid date.</div>}
            {tone && <div className="note" style={{ fontSize: 13, marginTop: 4, color: tone.c, fontWeight: 700 }}>{tone.t}</div>}
          </div>

          <div className="flex-row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 4 }}>
            <div className="form-group" style={{ flex: '0 0 130px' }}>
              <label>Units on shelf</label>
              <input
                type="number" min="0" step="1" placeholder="0"
                value={t.form.units}
                onChange={t.update('units')}
              />
            </div>

            <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
              <label>
                Action
                {suggested && (
                  <span className="note" style={{ fontWeight: 400, marginLeft: 6 }}>
                    — suggested: <strong style={{ color: '#B47F1E' }}>{suggested}</strong>
                  </span>
                )}
              </label>
              <select
                value={action}
                onChange={e => { setAction(e.target.value); setActionAuto(false) }}
              >
                <option value="">— choose an action —</option>
                {ACTIONS.map(a => <option key={a.v} value={a.v}>{a.v}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleResetAll}>✕ Reset sweep</button>
          </div>

          {t.error && <div className="login-error mt-12">{t.error}</div>}
        </form>
      </div>
    </div>
  )
}
