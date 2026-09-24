// The four Pricing states a task record can be in, derived from three
// timestamps on task_records. One definition, so the report bubble, the filter
// and anything added later cannot drift apart.
//
//   sent_to_pricing_at  set by POST /pricing/items
//   priced_at           set by PATCH /pricing/items/:id  (never cleared)
//   pricing_removed_at  set by DELETE /pricing/items/:id (cleared on re-send)
//
// Order of the checks is by SPECIFICITY, not by the display order below: a
// removed record still carries priced_at, and that combination is exactly what
// distinguishes "priced, then removed" from "removed, never priced".
//
// pricing_items rows are HARD deleted on removal, so after that these three
// columns are the only surviving evidence that the record was ever in Pricing.

export const PRICING_STATES = [
  {
    id:    'in_pricing',
    label: 'In Pricing, not priced',
    short: 'In Pricing',
    cls:   'pbub-waiting',
    glyph: '€',
    hint:  'On the Pricing page, waiting for a price',
  },
  {
    id:    'priced',
    label: 'Priced',
    short: 'Priced',
    cls:   'pbub-priced',
    glyph: '€',
    hint:  'Priced, still on the Pricing page',
  },
  {
    id:    'priced_removed',
    label: 'Priced and deleted',
    short: 'Priced, removed',
    cls:   'pbub-priced-removed',
    glyph: '€',
    hint:  'Was priced, then removed from the Pricing page',
  },
  {
    id:    'removed_unpriced',
    label: 'Not priced but deleted',
    short: 'Removed, unpriced',
    cls:   'pbub-removed',
    glyph: '·',
    hint:  'Was sent to Pricing and removed without ever being priced',
  },
]

const BY_ID = Object.fromEntries(PRICING_STATES.map(s => [s.id, s]))

// Returns one of the four ids, or null when the record never went to Pricing.
export function pricingStateId(r) {
  if (!r) return null
  const removed = !!r.pricing_removed_at
  const priced  = !!r.priced_at
  if (removed && priced) return 'priced_removed'
  if (removed)           return 'removed_unpriced'
  if (priced)            return 'priced'
  if (r.sent_to_pricing_at) return 'in_pricing'
  return null
}

export function pricingState(r) {
  const id = pricingStateId(r)
  return id ? BY_ID[id] : null
}

// Task types excluded from duplicate highlighting.
//
// Department Check is excluded by decision, on measured evidence: 55 stores
// legitimately scan the same products, so 94.4% of all J records share a barcode
// with another J record. On a store's default report that highlighted 196 of 200
// rows -- a signal present on almost everything is not a signal, and it buried
// the cases that do matter. The query types sit at 28-57%, where a shared
// barcode genuinely means two stores hit the same problem.
//
// This is the ONLY place the exclusion lives. dupKey() returns null for these,
// which makes both the request (no pointless barcodes sent) and the highlight
// (no key can ever match) skip them together -- they cannot drift apart.
export const DUP_EXCLUDED_TASK_TYPES = new Set(['J'])

// "TASKTYPE|BARCODE" — the key the server returns from
// POST /task-records/duplicate-keys. Built in one place so the two sides cannot
// disagree about separator or which barcode field is canonical (barcode_no is
// the corrected one; product_code is what was physically scanned).
//
// Returns null when the record cannot or should not be keyed: no barcode, or an
// excluded task type.
export function dupKey(r) {
  const bc = r?.barcode_no
  if (!bc) return null
  if (DUP_EXCLUDED_TASK_TYPES.has(r.task_type)) return null
  return `${r.task_type}|${bc}`
}
