// VAT vocab + margin math for the Pricing page. Must stay in step with the
// VAT_PCT map in functions/api/[[route]].js — the server recomputes the margin
// on save and its value is authoritative.

export const VAT_OPTIONS = [
  { code: 'Standard', pct: 23 },
  { code: 'Reduced',  pct: 13.5 },
  { code: 'Nine',     pct: 9 },
  { code: 'Zero',     pct: 0 },
  { code: 'Exempted', pct: 0 },
]

// % for a VAT code; null for empty, 9999 for anything unrecognised (per spec).
export function vatPct(code) {
  if (code == null || String(code).trim() === '') return null
  const hit = VAT_OPTIONS.find(o => o.code.toLowerCase() === String(code).trim().toLowerCase())
  return hit ? hit.pct : 9999
}

// Margin % on net selling price: (Net SP − Cost) ÷ Net SP × 100, where
// Net SP = VAT-inclusive New Selling Price ÷ (1 + VAT%). Null (shown empty)
// when cost / price / a usable VAT rate is missing — e.g. most Non-Scans.
export function marginPct(newSp, vatCode, cost) {
  const sp = Number(newSp), c = Number(cost), pct = vatPct(vatCode)
  if (!Number.isFinite(sp) || sp <= 0 || newSp === '' || newSp == null) return null
  if (!Number.isFinite(c) || cost === '' || cost == null) return null
  if (pct == null || pct === 9999) return null
  const net = sp / (1 + pct / 100)
  return Math.round(((net - c) / net) * 1000) / 10
}
