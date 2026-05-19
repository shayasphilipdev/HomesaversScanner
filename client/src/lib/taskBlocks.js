// Catalogue of block types for the store task form-builder.
// Each entry tells the builder + renderer how to handle that type.
//
// A template's `blocks` column is JSON: an array of
//   { id: uuid, type, label, required, ... type-specific props }
// A completed instance's `answers` column is JSON: { [block.id]: value }.
//
// Two families:
// - INPUT blocks ask the completer for an answer and write to `answers`.
// - DISPLAY blocks are pure UI (headings, alerts, instructions) — `required`
//   is ignored, and they never appear in `answers`.

const INPUT_BLOCKS = [
  { type: 'text',           label: 'Short text',                icon: '✏',  family: 'input',
    defaults: { label: 'Question', required: false, placeholder: '' } },
  { type: 'textarea',       label: 'Long notes',                icon: '📝', family: 'input',
    defaults: { label: 'Description', required: false, placeholder: '' } },
  { type: 'number',         label: 'Number',                    icon: '#',  family: 'input',
    defaults: { label: 'Number', required: false, min: null, max: null, unit: '' } },
  { type: 'amount',         label: 'Money / amount',            icon: '€',  family: 'input',
    defaults: { label: 'Amount', required: false, currency: '€' } },
  { type: 'percentage',     label: 'Percentage',                icon: '%',  family: 'input',
    defaults: { label: 'Percentage', required: false, min: 0, max: 100 } },
  { type: 'temperature',    label: 'Temperature',               icon: '🌡', family: 'input',
    defaults: { label: 'Temperature', required: false, unit: '°C', min: null, max: null } },
  { type: 'rating',         label: 'Rating (1–5)',              icon: '⭐', family: 'input',
    defaults: { label: 'Rate', required: false, scale: 5 } },
  { type: 'date',           label: 'Date',                      icon: '📅', family: 'input',
    defaults: { label: 'Date', required: false } },
  { type: 'time',           label: 'Time',                      icon: '⏱', family: 'input',
    defaults: { label: 'Time', required: false } },
  { type: 'yes_no',         label: 'Yes / No',                  icon: '☑',  family: 'input',
    defaults: { label: 'Yes or No?', required: false } },
  { type: 'choice_single',  label: 'Multiple choice (one)',     icon: '◉',  family: 'input',
    defaults: { label: 'Pick one', required: false, options: ['Option A', 'Option B'] } },
  { type: 'choice_multi',   label: 'Checkbox (many)',           icon: '☐',  family: 'input',
    defaults: { label: 'Pick all that apply', required: false, options: ['Option A', 'Option B'] } },
  { type: 'signature',      label: 'Signature / name',          icon: '✍', family: 'input',
    defaults: { label: 'Signed by', required: false } },
  { type: 'photo',          label: 'Photo upload',              icon: '📷', family: 'input',
    defaults: { label: 'Take a photo', required: false } },
  { type: 'file',           label: 'File upload',               icon: '📎', family: 'input',
    defaults: { label: 'Attach a file', required: false, accept: '*/*' } },
  { type: 'calc',           label: 'Auto-calculated',           icon: '∑',  family: 'input',
    defaults: { label: 'Total', required: false, operation: 'sum', source_block_ids: [] } }
]

const DISPLAY_BLOCKS = [
  { type: 'heading',     label: 'Section heading',         icon: 'H',  family: 'display',
    defaults: { label: 'Section title' } },
  { type: 'instruction', label: 'Instruction text',        icon: '📃', family: 'display',
    defaults: { label: '', text: 'Step-by-step guidance for the completer.' } },
  { type: 'alert',       label: 'Alert / coloured note',   icon: '⚠️', family: 'display',
    defaults: { label: '', text: 'Important: …', variant: 'warning' } },
  { type: 'divider',     label: 'Divider line',            icon: '—',  family: 'display',
    defaults: { label: '' } }
]

export const BLOCK_TYPES = [...INPUT_BLOCKS, ...DISPLAY_BLOCKS]

export const BLOCK_TYPE_BY_KEY = Object.fromEntries(BLOCK_TYPES.map(t => [t.type, t]))

// Display blocks contribute no answer — used by the renderer to decide
// whether to read/write from the `answers` object, and by validators to
// know which IDs to skip when checking `required`.
export const isDisplayBlock = (b) => BLOCK_TYPE_BY_KEY[b?.type]?.family === 'display'
export const isInputBlock   = (b) => BLOCK_TYPE_BY_KEY[b?.type]?.family === 'input'

// Available variants for the 'alert' block — keep in sync with the renderer.
export const ALERT_VARIANTS = [
  { value: 'info',    label: 'Info (blue) ℹ️' },
  { value: 'warning', label: 'Warning (yellow) ⚠️' },
  { value: 'danger',  label: 'Danger (red) 🔴' },
  { value: 'success', label: 'Success (green) ✅' }
]

// Operations for the 'calc' block.
export const CALC_OPERATIONS = [
  { value: 'sum',     label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min',     label: 'Minimum' },
  { value: 'max',     label: 'Maximum' },
  { value: 'diff',    label: 'Difference (first − rest)' }
]

export function newBlock(type) {
  const meta = BLOCK_TYPE_BY_KEY[type]
  if (!meta) return null
  return {
    id: (crypto.randomUUID?.() || `b-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    type,
    ...meta.defaults
  }
}

// Compute the value for a 'calc' block from the current answers map.
// Skips non-numeric / missing source values gracefully so a half-filled
// form doesn't crash the renderer.
export function computeCalc(block, answers) {
  const ids = Array.isArray(block.source_block_ids) ? block.source_block_ids : []
  const nums = ids
    .map(id => Number(answers?.[id]))
    .filter(n => Number.isFinite(n))
  if (!nums.length) return null
  switch (block.operation) {
    case 'average': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min':     return Math.min(...nums)
    case 'max':     return Math.max(...nums)
    case 'diff':    return nums.slice(1).reduce((a, b) => a - b, nums[0])
    case 'sum':
    default:        return nums.reduce((a, b) => a + b, 0)
  }
}
