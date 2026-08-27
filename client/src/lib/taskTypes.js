// Static metadata about each task type — what the form looks like.
// The list of task types itself is loaded from the server (/api/task-types).
// This file describes the *form schema* per type, and which are implemented
// in the current phase.
//
// Display order (A–J shown in picker) is driven by the `display_order` column
// in the DB / API response — not by the DB code letter here.

export const TASK_FORMS = {
  K: { name: 'Price Check',          implemented: true,  warning: null },
  J: { name: 'Department Check',     implemented: true,  warning: null },
  M: { name: 'Routine Expiry Sweep', implemented: true,  warning: null },
  B: { name: 'Non-Scans',            implemented: true,  warning: null },
  C: { name: 'Wrong Prices',         implemented: true,  warning: null },
  D: { name: 'Wrong Description',    implemented: true,  warning: null },
  A: { name: 'UOM Errors',           implemented: true,  warning: null },
  E: { name: 'Price Marked Products', implemented: true,  warning: null },
  F: { name: 'DRS Errors',           implemented: true,
       warning: '⚠ Check for the Return Logo on the product before scanning.' },
  G: { name: 'Promotion Error',      implemented: true,  warning: null },
  H: { name: 'Stock Count',          implemented: true,  warning: null },
  I: { name: 'Miscellaneous Tasks',  implemented: true,  warning: null }
}

// Task types a store user can clear directly from Pending, with no HO review.
// M (Routine Expiry Sweep) belongs here: a sweep writes one record per product —
// 20-60 of them — and carries no query for HO to answer, so waiting on review
// just buries the store's own list.
export const STORE_CLEARABLE = new Set(['J', 'K', 'M'])

// Task types ANY user may PERMANENTLY delete. Deliberately NOT M: the backend
// delete filters only allow J/K for store roles, and sweep rows are the source
// data behind the HO Expiry Overview report. Clearing is a reversible archive;
// deleting is not.
export const HARD_DELETABLE = new Set(['J', 'K'])

export const FREQUENCY_LABEL = {
  daily:    'Daily',
  weekly:   'Weekly',
  monthly:  'Monthly',
  once_off: 'Once-off'
}
