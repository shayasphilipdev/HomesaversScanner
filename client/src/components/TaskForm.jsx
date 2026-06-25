import { useState } from 'react'
import { TASK_FORMS } from '../lib/taskTypes.js'
import TaskAForm  from './forms/TaskAForm.jsx'
import TaskBForm  from './forms/TaskBForm.jsx'
import TaskCForm  from './forms/TaskCForm.jsx'
import TaskDIForm from './forms/TaskDIForm.jsx'
import TaskEForm  from './forms/TaskEForm.jsx'
import TaskFForm  from './forms/TaskFForm.jsx'
import TaskGForm  from './forms/TaskGForm.jsx'
import TaskHForm  from './forms/TaskHForm.jsx'
import TaskJForm  from './forms/TaskJForm.jsx'
import TaskKForm  from './forms/TaskKForm.jsx'

const REMINDER_KEY = 'hs_barcode_reminder_dismissed'

// Top-level dispatcher: picks the right form component for the chosen task type.
export default function TaskForm({ taskType, storeId, onSaved }) {
  const [reminderDismissed, setReminderDismissed] = useState(
    () => !!localStorage.getItem(REMINDER_KEY)
  )

  const hideReminder = () => {
    localStorage.setItem(REMINDER_KEY, '1')
    setReminderDismissed(true)
  }
  const showReminder = () => {
    localStorage.removeItem(REMINDER_KEY)
    setReminderDismissed(false)
  }

  const meta = TASK_FORMS[taskType]

  const reminder = reminderDismissed ? (
    // Compact one-line toggle to bring the banner back
    <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
      <button
        onClick={showReminder}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
          color: '#B47F1E', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 4 }}
        title="Show scan reminder"
      >
        ⚠️ <span style={{ textDecoration: 'underline' }}>Show scan reminder</span>
      </button>
    </div>
  ) : (
    <div style={{
      background: '#FFF8E6', border: '1px solid #E8C84A', borderRadius: 8,
      padding: '10px 14px', marginBottom: 12,
      display: 'flex', alignItems: 'center', gap: 10
    }}>
      <span style={{ fontSize: 15 }}>⚠️</span>
      <span style={{ flex: 1, fontSize: 13, color: '#7A5610' }}>
        Scan the product barcode only — not the shelf label (SEL).
      </span>
      <button
        onClick={hideReminder}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#B47F1E', padding: '0 2px', lineHeight: 1 }}
        aria-label="Hide reminder"
        title="Hide (saved permanently)"
      >
        ✕
      </button>
    </div>
  )

  if (!meta) {
    return <div className="card"><div className="card-body">Unknown task type.</div></div>
  }

  if (!meta.implemented) {
    return (
      <>
        {reminder}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">{meta.name}</div>
          <div className="card-body">
            {meta.warning && (
              <div className="warning-box mb-12">
                <span className="warning-icon">⚠️</span>
                <div>{meta.warning}</div>
              </div>
            )}
            <div className="empty-state">
              <div className="empty-state-icon">🚧</div>
              <p><strong>Coming soon.</strong></p>
              <p className="note">{meta.comingSoon || 'Not yet implemented.'}</p>
            </div>
          </div>
        </div>
      </>
    )
  }

  switch (taskType) {
    case 'A': return <>{reminder}<TaskAForm storeId={storeId} onSaved={onSaved} /></>
    case 'B': return <>{reminder}<TaskBForm storeId={storeId} onSaved={onSaved} /></>
    case 'C': return <>{reminder}<TaskCForm storeId={storeId} onSaved={onSaved} /></>
    case 'D':
    case 'I': return <>{reminder}<TaskDIForm taskType={taskType} storeId={storeId} onSaved={onSaved} /></>
    case 'E': return <>{reminder}<TaskEForm storeId={storeId} onSaved={onSaved} /></>
    case 'F': return <>{reminder}<TaskFForm storeId={storeId} onSaved={onSaved} /></>
    case 'G': return <>{reminder}<TaskGForm storeId={storeId} onSaved={onSaved} /></>
    case 'H': return <>{reminder}<TaskHForm storeId={storeId} onSaved={onSaved} /></>
    case 'J': return <>{reminder}<TaskJForm storeId={storeId} onSaved={onSaved} /></>
    case 'K': return <>{reminder}<TaskKForm storeId={storeId} onSaved={onSaved} /></>
    default:  return <div className="card"><div className="card-body">No form registered for {taskType}.</div></div>
  }
}
