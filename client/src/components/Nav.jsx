import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../App.jsx'
import { resolvedTheme, setTheme } from '../lib/theme.js'
import OfflineIndicator from './OfflineIndicator.jsx'

export default function Nav() {
  const { session, logout } = useStore()
  const [theme, setLocalTheme] = useState(resolvedTheme())

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    setLocalTheme(next)
  }

  return (
    <nav className="nav">
      <span className="nav-brand">Homesavers</span>

      <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Dashboard</NavLink>
      <NavLink to="/tasks"     className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Tasks</NavLink>
      <NavLink to="/reports"   className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Reports</NavLink>

      {session.mode === 'backoffice' && (
        <NavLink to="/admin/stores" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Admin</NavLink>
      )}

      <OfflineIndicator />

      <span className="nav-store-badge" title={session.role ? `Role: ${session.role}` : ''}>
        {session.displayName || (session.mode === 'backoffice' ? '⚙ Back Office' : session.storeName)}
      </span>

      <button
        className="nav-theme-toggle"
        onClick={toggleTheme}
        title={theme === 'light' ? 'Switch to high-contrast (dark) mode' : 'Switch to light mode'}
        aria-label="Toggle theme"
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>

      <button className="nav-logout" onClick={logout}>Sign out</button>
    </nav>
  )
}
