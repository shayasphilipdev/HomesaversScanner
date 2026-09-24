import MultiSelectDropdown from './forms/MultiSelectDropdown.jsx'
import { FREQUENCY_LABEL, TASK_FORMS } from '../lib/taskTypes.js'

// Single dropdown grouped by frequency. Compact — fits in one row.
// Uses a custom dropdown so it closes immediately on tap (no iOS "Done").
export default function TaskTypePicker({ taskTypes, selected, onSelect }) {
  const groups = taskTypes.reduce((acc, t) => {
    const f = t.frequency || 'daily'
    if (!acc[f]) acc[f] = []
    acc[f].push(t)
    return acc
  }, {})
  const order = ['daily', 'weekly', 'monthly', 'once_off']

  const options = order
    .filter(f => groups[f]?.length)
    .flatMap(f => groups[f].map(t => {
      const meta = TASK_FORMS[t.code] || {}
      return {
        id:       t.code,
        label:    `${t.name}${!meta.implemented ? ' (coming soon)' : ''}`,
        subLabel: FREQUENCY_LABEL[f] || f
      }
    }))

  return (
    <div className="store-pick-bar" style={{ background: 'var(--surface-warm)', borderColor: 'var(--border)' }}>
      <span className="store-pick-label">Task type *</span>
      <div style={{ flex: 1, maxWidth: 360 }}>
        <MultiSelectDropdown
          single
          options={options}
          value={selected ? [selected] : []}
          onChange={arr => onSelect(arr[0] || null)}
          placeholder="— Pick a task type —"
          /* No search box. It appears automatically at 8+ options and there are
             12 task types. This is the picker a store opens before every single
             record, on a phone: a search field there costs a tap and pulls the
             keyboard up over the very list it is meant to help you read.
             CurrentStorePicker deliberately keeps its search -- 55 stores. */
          searchable={false}
        />
      </div>
    </div>
  )
}
