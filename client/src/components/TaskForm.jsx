import { TASK_FORMS } from '../lib/taskTypes.js'
import TaskAForm  from './forms/TaskAForm.jsx'
import TaskBForm  from './forms/TaskBForm.jsx'
import TaskCForm  from './forms/TaskCForm.jsx'
import TaskDIForm from './forms/TaskDIForm.jsx'
import TaskEForm  from './forms/TaskEForm.jsx'
import TaskFForm  from './forms/TaskFForm.jsx'
import TaskGForm  from './forms/TaskGForm.jsx'

// Top-level dispatcher: picks the right form component for the chosen task type.
// Task types not yet implemented render a "coming soon" placeholder.
export default function TaskForm({ taskType, onSaved }) {
  const meta = TASK_FORMS[taskType]

  if (!meta) {
    return <div className="card"><div className="card-body">Unknown task type.</div></div>
  }

  if (!meta.implemented) {
    return (
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">{taskType} — {meta.name}</div>
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
    )
  }

  switch (taskType) {
    case 'A': return <TaskAForm onSaved={onSaved} />
    case 'B': return <TaskBForm onSaved={onSaved} />
    case 'C': return <TaskCForm onSaved={onSaved} />
    case 'D':
    case 'I': return <TaskDIForm taskType={taskType} onSaved={onSaved} />
    case 'E': return <TaskEForm onSaved={onSaved} />
    case 'F': return <TaskFForm onSaved={onSaved} />
    case 'G': return <TaskGForm onSaved={onSaved} />
    default:  return <div className="card"><div className="card-body">No form registered for {taskType}.</div></div>
  }
}
