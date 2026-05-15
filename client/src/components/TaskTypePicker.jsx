import { FREQUENCY_LABEL, TASK_FORMS } from '../lib/taskTypes.js'

export default function TaskTypePicker({ taskTypes, selected, onSelect }) {
  // Group by frequency, preserve sort_order
  const groups = taskTypes.reduce((acc, t) => {
    const f = t.frequency || 'daily'
    if (!acc[f]) acc[f] = []
    acc[f].push(t)
    return acc
  }, {})

  // Display order
  const order = ['daily', 'weekly', 'monthly', 'once_off']

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">Choose a task type</div>
      <div className="card-body">
        {order.filter(f => groups[f]?.length).map(f => (
          <div key={f} style={{ marginBottom: 12 }}>
            <div className="note" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)', marginBottom: 6 }}>
              {FREQUENCY_LABEL[f] || f}
            </div>
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {groups[f].map(t => {
                const meta   = TASK_FORMS[t.code] || {}
                const active = selected === t.code
                return (
                  <button
                    key={t.code}
                    type="button"
                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => onSelect(t.code)}
                    title={meta.implemented ? '' : 'Coming soon'}
                  >
                    <span style={{ fontWeight: 700, marginRight: 6 }}>{t.code}</span>
                    {t.name}
                    {!meta.implemented && (
                      <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>·  coming soon</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
