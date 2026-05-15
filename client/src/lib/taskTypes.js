// Static metadata about each task type — what the form looks like.
// The list of task types itself is loaded from the server (/api/task-types).
// This file describes the *form schema* per type, and which are implemented
// in the current phase.

export const TASK_FORMS = {
  A: { name: 'UOM Errors',           implemented: true,  warning: null },
  B: { name: 'Non-Scans',            implemented: true,  warning: null },
  C: { name: 'Wrong Prices',         implemented: false, warning: null,
       comingSoon: 'Phase 2 — reason code dropdown + optional current price.' },
  D: { name: 'Wrong Description',    implemented: false, warning: null,
       comingSoon: 'Phase 2.' },
  E: { name: 'Price Marked Products', implemented: false, warning: null,
       comingSoon: 'Phase 2.' },
  F: { name: 'DRS Errors',           implemented: false,
       warning: '⚠ Check for the Return Logo on the product before scanning.',
       comingSoon: 'Phase 2 — size dropdown + units per package.' },
  G: { name: 'Promotion Error',      implemented: false, warning: null,
       comingSoon: 'Phase 2.' },
  H: { name: 'Stock Count',          implemented: false, warning: null,
       comingSoon: 'Phase 2 — simplified count form.' },
  I: { name: 'Miscellaneous Tasks',  implemented: false, warning: null,
       comingSoon: 'Phase 2.' }
}

export const FREQUENCY_LABEL = {
  daily:    'Daily',
  weekly:   'Weekly',
  monthly:  'Monthly',
  once_off: 'Once-off'
}
