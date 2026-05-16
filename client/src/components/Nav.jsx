import { NavLink } from 'react-router-dom'
import { useStore } from '../App.jsx'

export default function Nav() {
  const { session, logout } = useStore()

  return (
    <nav className="nav">
      <span className="nav-brand">Homesavers</span>

      <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        Dashboard
      </NavLink>

      <NavLink to="/tasks" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        Tasks
      </NavLink>

      <NavLink to="/reports" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        Reports
      </NavLink>

      {session.mode === 'backoffice' && (
        <NavLink to="/admin/stores" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Admin
        </NavLink>
      )}

      <span className="nav-store-badge">
        {session.mode === 'backoffice' ? '⚙ Back Office' : session.storeName}
      </span>

      <button className="nav-logout" onClick={logout}>Sign out</button>
    </nav>
  )
}
