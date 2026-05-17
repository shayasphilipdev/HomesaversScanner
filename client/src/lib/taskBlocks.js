// Catalogue of block types for the store task form-builder (Phase 9F).
// Each entry tells the builder + renderer how to handle that type.
//
// A template's `blocks` column is JSON: an array of
//   { id: uuid, type, label, required, ... type-specific props }
// A completed instance's `answers` column is JSON: { [block.id]: value }.

export const BLOCK_TYPES = [
  {
    type: 'text',
    label: 'Single-line text',
    icon: '✏',
    defaults: { label: 'Question', required: false, placeholder: '' }
  },
  {
    type: 'textarea',
    label: 'Long text',
    icon: '📝',
    defaults: { label: 'Description', required: false, placeholder: '' }
  },
  {
    type: 'number',
    label: 'Number',
    icon: '#',
    defaults: { label: 'Number', required: false, min: null, max: null, unit: '' }
  },
  {
    type: 'amount',
    label: 'Money / amount',
    icon: '€',
    defaults: { label: 'Amount', required: false, currency: '€' }
  },
  {
    type: 'date',
    label: 'Date',
    icon: '📅',
    defaults: { label: 'Date', required: false }
  },
  {
    type: 'time',
    label: 'Time',
    icon: '⏱',
    defaults: { label: 'Time', required: false }
  },
  {
    type: 'yes_no',
    label: 'Yes / No',
    icon: '☑',
    defaults: { label: 'Yes or No?', required: false }
  },
  {
    type: 'choice_single',
    label: 'Single choice (radio)',
    icon: '◉',
    defaults: { label: 'Pick one', required: false, options: ['Option A', 'Option B'] }
  },
  {
    type: 'choice_multi',
    label: 'Multiple choice (checkboxes)',
    icon: '☐',
    defaults: { label: 'Pick all that apply', required: false, options: ['Option A', 'Option B'] }
  },
  {
    type: 'photo',
    label: 'Photo',
    icon: '📷',
    defaults: { label: 'Take a photo', required: false }
  }
]

export const BLOCK_TYPE_BY_KEY = Object.fromEntries(BLOCK_TYPES.map(t => [t.type, t]))

export function newBlock(type) {
  const meta = BLOCK_TYPE_BY_KEY[type]
  if (!meta) return null
  return {
    id: (crypto.randomUUID?.() || `b-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    type,
    ...meta.defaults
  }
}
