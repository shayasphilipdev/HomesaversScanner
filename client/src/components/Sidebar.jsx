import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { canSeeAnyAdminLink, canAccessAdmin, canDoHQTasks, canDoStoreTasks } from '../lib/roles.js'

// Desktop sidebar (visible on screens ≥ 1024px). Replaces the top-bar
// links at that width. Active state matches `/admin/*` for the Admin
// link even though it links to /admin/stores specifically.
export default function Sidebar() {
  const { session } = useStore()
  const { pathname } = useLocation()

  const items = [
    { to: '/dashboard',    icon: '◧', label: 'Dashboard' }
  ]
  if (canDoHQTasks(session))    items.push({ to: '/tasks',       icon: '✚', label: 'HO Tasks' })
  if (canDoStoreTasks(session)) items.push({ to: '/store-tasks', icon: '☑', label: 'Store Tasks' })
  items.push({ to: '/reports', icon: '▤', label: 'Reports' })
  if (canSeeAnyAdminLink(session)) {
    items.push({
      to: canAccessAdmin(session) ? '/admin/stores' : '/admin/task-templates',
      icon: '⚙', label: 'Admin', match: '/admin'
    })
  }

  return (
    <aside className="sidebar" aria-label="Primary">
      <nav className="sidebar-nav">
        {items.map(i => {
          const active = i.match
            ? pathname.startsWith(i.match)
            : pathname === i.to || pathname.startsWith(i.to + '/')
          return (
            <NavLink
              key={i.to}
              to={i.to}
              className={`sidebar-link${active ? ' active' : ''}`}
            >
              <span className="sidebar-icon" aria-hidden>{i.icon}</span>
              <span className="sidebar-label">{i.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <span className="note" style={{ fontSize: 11.5 }}>
          {session.mode === 'backoffice' ? 'Back Office' : 'Store'}
        </span>
      </div>
    </aside>
  )
}
