// Shared expiry / Reduce-to-Clear logic used by the Task M sweep form and the
// scheduled Store-Task "expiry sweep" block, so the date rules and the
// suggested-action ladder live in one place.

// Sweep categories — drive the first-markdown trigger and the suggested action.
export const EXPIRY_CATEGORIES = [
  'Confectionery',
  'Bakery / Ambient',
  'Drinks',
  'Grocery / Canned',
  'Health / Pharmacy',
  'Seasonal / Other',
]

// The Reduce to Clear action ladder. pct = markdown percentage (null = write off).
export const EXPIRY_ACTIONS = [
  { v: 'Rotate',     pct: 0    },
  { v: 'Reduce 30%', pct: 30   },
  { v: 'Reduce 50%', pct: 50   },
  { v: 'Reduce 75%', pct: 75   },
  { v: 'Write Off',  pct: null },
]

export function markdownPctFor(action) {
  const a = EXPIRY_ACTIONS.find(x => x.v === action)
  return a ? a.pct : null
}

// Build YYYY-MM-DD from day/month/year strings; '' if incomplete or invalid.
// Year takes 2 digits (26 -> 2026) or 4 (2026). Impossible dates (e.g. 31/02)
// are rejected so a bad entry never saves.
export function buildDate(d, m, y) {
  if (!d || !m || !y) return ''
  const dd = Number(d), mm = Number(m)
  let yy = Number(y)
  if (String(y).length <= 2) yy = 2000 + yy
  if (!(dd >= 1 && dd <= 31) || !(mm >= 1 && mm <= 12) || !(yy >= 2000 && yy <= 2100)) return ''
  const dt = new Date(yy, mm - 1, dd)
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return ''
  const p = n => String(n).padStart(2, '0')
  return `${yy}-${p(mm)}-${p(dd)}`
}

// Whole days from today (local midnight) until the given YYYY-MM-DD; null if blank.
export function daysUntil(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const exp = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}

// First-markdown trigger by category (days-to-expiry). Bakery is shortest-dated,
// long-life grocery/health the longest — matches the sweep cadence table.
export function firstTrigger(category) {
  if (category === 'Bakery / Ambient') return 14
  if (category === 'Grocery / Canned' || category === 'Health / Pharmacy') return 30
  return 21
}

// Suggested action from days-to-expiry + category. Deeper reductions as the
// date gets closer; write off once expired. '' when no date entered yet.
export function suggestAction(days, category) {
  if (days == null) return ''
  if (days < 0)  return 'Write Off'
  if (days <= 6) return 'Reduce 75%'
  if (days <= 14) return 'Reduce 50%'
  if (days <= firstTrigger(category)) return 'Reduce 30%'
  return 'Rotate'
}

// Colour + label for a days-to-expiry value (red short-dated, amber soon, green ok).
export function expiryTone(days) {
  if (days == null) return null
  if (days < 0)   return { c: 'var(--red, #c0392b)', t: `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago` }
  if (days <= 7)  return { c: 'var(--red, #c0392b)', t: `${days} day${days !== 1 ? 's' : ''} left — short-dated` }
  if (days <= 14) return { c: '#B47F1E',             t: `${days} days left` }
  return { c: '#1E7B34', t: `${days} days left` }
}

// DD/MM/YY from a YYYY-MM-DD string (for compact display of saved lines).
export function formatDMY(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y.slice(2)}`
}
