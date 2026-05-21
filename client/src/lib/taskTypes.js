// Static metadata about each task type — what the form looks like.
// The list of task types itself is loaded from the server (/api/task-types).
// This file describes the *form schema* per type, and which are implemented
// in the current phase.

export const TASK_FORMS = {
  A: { name: 'UOM Errors',           implemented: true,  warning: null },
  B: { name: 'Non-Scans',            implemented: true,  warning: null },
  C: { name: 'Wrong Prices',         implemented: true,  warning: null },
  D: { name: 'Wrong Description',    implemented: true,  warning: null },
  E: { name: 'Price Marked Products', implemented: true,  warning: null },
  F: { name: 'DRS Errors',           implemented: true,
       warning: '⚠ Check for the Return Logo on the product before scanning.' },
  G: { name: 'Promotion Error',      implemented: true,  warning: null },
  H: { name: 'Stock Count',          implemented: true,  warning: null },
  I: { name: 'Miscellaneous Tasks',  implemented: true,  warning: null },
  J: { name: 'Department Check',     implemented: true,  warning: null }
}

export const FREQUENCY_LABEL = {
  daily:    'Daily',
  weekly:   'Weekly',
  monthly:  'Monthly',
  once_off: 'Once-off'
}
