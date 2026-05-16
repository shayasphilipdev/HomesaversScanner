import { FREQUENCY_LABEL, TASK_FORMS } from '../lib/taskTypes.js'

// Visual order + small icon per frequency group, plus a short hint.
const GROUP_META = {
  daily:    { icon: '🕒', hint: 'Quick checks to do across the day' },
  weekly:   { icon: '📅', hint: 'Weekly housekeeping' },
  monthly:  { icon: '🗓️', hint: 'Monthly review tasks' },
  once_off: { icon: '✅', hint: 'One-off jobs as they come up' }
}
const GROUP_ORDER = ['daily', 'weekly', 'monthly', 'once_off']

export default function TaskTypePicker({ taskTypes, selected, onSelect }) {
  const groups = taskTypes.reduce((acc, t) => {
    const f = t.frequency || 'daily'
    if (!acc[f]) acc[f] = []
    acc[f].push(t)
    return acc
  }, {})

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">What are you logging?</div>
      <div className="card-body">
        {GROUP_ORDER.filter(f => groups[f]?.length).map(f => {
          const meta = GROUP_META[f] || { icon: '·', hint: '' }
          return (
            <div key={f} style={{ marginBottom: 18 }}>
              <div className="flex-row" style={{ marginBottom: 8, gap: 8, alignItems: 'baseline' }}>
                <span aria-hidden style={{ fontSize: 16 }}>{meta.icon}</span>
                <strong style={{ fontSize: 13, color: 'var(--text)', letterSpacing: 0 }}>
                  {FREQUENCY_LABEL[f] || f}
                </strong>
                <span className="note" style={{ fontSize: 12 }}>{meta.hint}</span>
              </div>
              <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {groups[f].map(t => {
                  const tm     = TASK_FORMS[t.code] || {}
                  const active = selected === t.code
                  return (
                    <button
                      key={t.code}
                      type="button"
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => onSelect(t.code)}
                      title={tm.implemented ? '' : 'Coming soon'}
                    >
                      <span style={{ fontWeight: 700, marginRight: 6 }}>{t.code}</span>
                      {t.name}
                      {!tm.implemented && (
                        <span style={{ marginLeft: 6, fontSize: 10, opacity: .7 }}>· soon</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
