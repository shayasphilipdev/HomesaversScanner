import { NavLink } from 'react-router-dom'
import { useStore } from '../App.jsx'

// Visible only on phones (CSS handles the breakpoint).
// Thumb-reach navigation pinned to the bottom edge, with safe-area
// inset support so it sits above the iOS home indicator.
export default function BottomNav() {
  const { session } = useStore()
  const isBO = session.mode === 'backoffice'

  const items = [
    { to: '/dashboard',     icon: '◧', label: 'Home' },
    { to: '/store-tasks',   icon: '☑', label: 'Tasks' },
    { to: '/tasks',         icon: '✚', label: 'HQ' },
    { to: '/reports',       icon: '▤', label: 'Reports' }
  ]
  if (isBO) items.push({ to: '/admin/stores', icon: '⚙', label: 'Admin' })

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
