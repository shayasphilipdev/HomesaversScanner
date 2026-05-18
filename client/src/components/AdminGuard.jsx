import { useStore } from '../App.jsx'
import { canAccessAdmin, canAccessTemplates } from '../lib/roles.js'

// Wrap a route element to keep non-admin roles out. Mode='admin' means
// admin / buying_manager only; mode='templates' allows any task creator.
export default function AdminGuard({ mode = 'admin', children }) {
  const { session } = useStore()
  const allowed = mode === 'templates'
    ? canAccessTemplates(session)
    : canAccessAdmin(session)
  if (!allowed) {
    return (
      <div className="card">
        <div className="empty-state">
          <p>You don't have access to this page.</p>
          <p className="note" style={{ marginTop: 6 }}>
            Ask the Admin if you should — they can change your role under Admin → Employees.
          </p>
        </div>
      </div>
    )
  }
  return children
}
