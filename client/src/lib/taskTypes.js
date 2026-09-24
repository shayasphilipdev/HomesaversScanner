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

// Task types a store user can ARCHIVE directly from Pending, with no HO review.
// M (Routine Expiry Sweep) belongs here: a sweep writes one record per product --
// 20-60 of them -- and carries no query for HO to answer, so waiting on review
// just buries the store's own list.
// H (Stock Count) joins them: like a Department or Price Check it is something
// the store records on the floor and acts on itself, not a query it is asking HO
// to answer.
//
// Beyond these a store may also archive anything HO has already reviewed
// (completed / no_change_needed) and its own store_completed records, of ANY
// type -- that part is status-driven rather than type-driven, so it is not a set.
// Keep in step with the bulk-clear filter in functions/api/[[route]].js.
//
// Was STORE_CLEARABLE. "Clear" is gone from the product: there is one action,
// Archive, and it is reversible.
export const STORE_ARCHIVABLE = new Set(['J', 'K', 'M', 'H'])

// NOTE: there is deliberately NO task-type set for permanent delete any more.
//
// It used to be HARD_DELETABLE = {J, K, H} -- the store's own floor records,
// which any user could destroy outright. Delete is now ADMIN ONLY and is not
// restricted by type: the type list existed to stop stores destroying a query
// record awaiting an HO answer, which is moot once stores cannot delete at all.
// Gate on the session role, not on the task type.

export const FREQUENCY_LABEL = {
  daily:    'Daily',
  weekly:   'Weekly',
  monthly:  'Monthly',
  once_off: 'Once-off'
}
