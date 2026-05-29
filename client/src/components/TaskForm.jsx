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

// Top-level dispatcher: picks the right form component for the chosen task type.
// `storeId` is the current store from the CurrentStorePicker — required for
// every record post (server rejects multi-store users that don't specify one).
export default function TaskForm({ taskType, storeId, onSaved }) {
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
    case 'A': return <TaskAForm storeId={storeId} onSaved={onSaved} />
    case 'B': return <TaskBForm storeId={storeId} onSaved={onSaved} />
    case 'C': return <TaskCForm storeId={storeId} onSaved={onSaved} />
    case 'D':
    case 'I': return <TaskDIForm taskType={taskType} storeId={storeId} onSaved={onSaved} />
    case 'E': return <TaskEForm storeId={storeId} onSaved={onSaved} />
    case 'F': return <TaskFForm storeId={storeId} onSaved={onSaved} />
    case 'G': return <TaskGForm storeId={storeId} onSaved={onSaved} />
    case 'H': return <TaskHForm storeId={storeId} onSaved={onSaved} />
    case 'J': return <TaskJForm storeId={storeId} onSaved={onSaved} />
    case 'K': return <TaskKForm storeId={storeId} onSaved={onSaved} />
    default:  return <div className="card"><div className="card-body">No form registered for {taskType}.</div></div>
  }
}
