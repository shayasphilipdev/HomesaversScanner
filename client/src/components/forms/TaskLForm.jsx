import { useState, useRef } from 'react'
import { createTaskRecord, lookupPrice } from '../../lib/api.js'
import { useStore } from '../../App.jsx'
import ScannerInput from './ScannerInput.jsx'
import { useTaskForm, LookupBanner, altFields } from './useTaskForm.jsx'

// Task L — Expiry Date Check (Operations).
// Scan a barcode → standard lookup box (Product Id, Description, Product Status,
// Item/Barcode Status) + an easy Expiry Date entry: three big Day / Month / Year
// boxes with the numeric keypad that auto-advance as you type (fast on a small
// handheld screen). Behaves like Department Check / Price Check otherwise.
const EMPTY = { product_code: '' }
const ACTIONS = ['Reduced', 'Removed', 'Rotated', 'OK / In date']

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

export default function TaskLForm({ onSaved, storeId }) {
  const { session } = useStore()
  const [priceInfo, setPriceInfo] = useState(null)
  const [d, setD] = useState('')
  const [m, setM] = useState('')
  const [y, setY] = useState('')
  const [action, setAction] = useState('')

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

  const handleReset = () => {
    t.reset(); setPriceInfo(null); setD(''); setM(''); setY(''); setAction('')
  }

  const expiry     = buildDate(d, m, y)
  const dmyEntered = d && m && y
  const invalid    = dmyEntered && !expiry

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!t.form.product_code.trim()) return t.setError('Scan or type a barcode first.')
    if (!expiry) return t.setError(invalid ? 'That expiry date is not valid.' : 'Enter the expiry date (day / month / year).')

    const body = {
      task_type:    'L',
      store_id:     storeId || session.storeId || null,
      product_code: t.form.product_code.trim(),
      ...altFields(t.lookupInfo, t.form.product_code.trim()),
      details: { expiry_date: expiry, action_taken: action || null },
      status: 'pending'
    }

    t.setSaving(true); t.setError('')
    try {
      const res = await createTaskRecord(body)
      handleReset()
      onSaved?.({ queued: !!res?.queued, record: res?.queued ? null : res })
    } catch (err) {
      t.setError(err.message)
    } finally {
      t.setSaving(false)
    }
  }

  const days = daysUntil(expiry)
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
          <ScannerInput
            label="Barcode *"
            value={t.form.product_code}
            onChange={t.update('product_code')}
            onConfirm={handleConfirm}
            lookupLoading={t.lookupLoading}
            readerId="reader-l"
            placeholder="Scan or type the barcode"
            inlineAction={
              <button type="submit" className="btn btn-primary" disabled={t.saving || (t.lookupLoading && navigator.onLine)} style={{ whiteSpace: 'nowrap' }}>
                {t.saving ? <span className="spinner" /> : 'Save'}
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

          <div className="form-group" style={{ marginTop: 4 }}>
            <label>Action taken</label>
            <select value={action} onChange={e => setAction(e.target.value)}>
              <option value="">— optional —</option>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleReset}>✕ Clear</button>
          </div>

          {t.error && <div className="login-error mt-12">{t.error}</div>}
        </form>
      </div>
    </div>
  )
}
