import { FREQUENCY_LABEL, TASK_FORMS } from '../lib/taskTypes.js'

// Single dropdown grouped by frequency. Compact — fits in one row.
export default function TaskTypePicker({ taskTypes, selected, onSelect }) {
  // Group by frequency to render <optgroup>s.
  const groups = taskTypes.reduce((acc, t) => {
    const f = t.frequency || 'daily'
    if (!acc[f]) acc[f] = []
    acc[f].push(t)
    return acc
  }, {})
  const order = ['daily', 'weekly', 'monthly', 'once_off']

  return (
    <div className="store-pick-bar" style={{ background: 'var(--surface-warm)', borderColor: 'var(--border)' }}>
      <span className="store-pick-label">Task type *</span>
      <select value={selected || ''} onChange={e => onSelect(e.target.value || null)} style={{ maxWidth: 360 }}>
        <option value="">— Pick a task type —</option>
        {order.filter(f => groups[f]?.length).map(f => (
          <optgroup key={f} label={FREQUENCY_LABEL[f] || f}>
            {groups[f].map(t => {
              const meta = TASK_FORMS[t.code] || {}
              return (
                <option key={t.code} value={t.code}>
                  {t.code} — {t.name}{!meta.implemented ? ' (coming soon)' : ''}
                </option>
              )
            })}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
