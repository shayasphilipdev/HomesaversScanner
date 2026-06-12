import { NavLink } from 'react-router-dom'
import { useStore } from '../App.jsx'
import { canAccessAdmin, canDoHQTasks, canDoStoreTasks, canSeeManagerDashboard } from '../lib/roles.js'

// Visible only on phones (CSS handles the breakpoint).
// Thumb-reach navigation pinned to the bottom edge, with safe-area
// inset support so it sits above the iOS home indicator.
export default function BottomNav() {
  const { session } = useStore()

  const items = [
    { to: '/dashboard', icon: '◧', label: 'Home' }
  ]
  if (canSeeManagerDashboard(session)) items.push({ to: '/manager', icon: '◑', label: 'Manager' })
  if (canDoStoreTasks(session)) items.push({ to: '/store-tasks', icon: '☑', label: 'Tasks' })
  items.push({ to: '/space-plan', icon: '▦', label: 'Space' })
  items.push({ to: '/product-query', icon: '💬', label: 'Query' })
  if (canDoHQTasks(session))    items.push({ to: '/tasks',       icon: '✚', label: 'HO' })
  items.push({ to: '/reports', icon: '▤', label: 'Reports' })
  if (canAccessAdmin(session)) {
    items.push({ to: '/admin/stores', icon: '⚙', label: 'Admin' })
  }

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map(i => (
        <NavLink key={i.to} to={i.to} className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}>
          <span className="bottom-nav-icon" aria-hidden>{i.icon}</span>
          <span className="bottom-nav-label">{i.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
