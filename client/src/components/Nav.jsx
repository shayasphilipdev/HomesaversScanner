import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../App.jsx'
import { resolvedTheme, setTheme } from '../lib/theme.js'
import { canSeeAnyAdminLink, canAccessAdmin, canDoHQTasks, canDoStoreTasks, STORE_ROLE_KEYS, roleLabel } from '../lib/roles.js'
import { useCurrentStore } from '../lib/currentStore.jsx'
import OfflineIndicator from './OfflineIndicator.jsx'
import CapacityAlert from './CapacityAlert.jsx'

export default function Nav() {
  const { session, logout } = useStore()
  const { currentStoreId, scopedStores } = useCurrentStore()
  const [theme, setLocalTheme] = useState(resolvedTheme())

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    setLocalTheme(next)
  }

  const isStoreRole = STORE_ROLE_KEYS.includes(session.role)
  const contextLabel = isStoreRole ? 'Store Login' : 'Head Office Login'
  const currentStore = scopedStores.find(s => s.id === currentStoreId)

  return (
    <nav className="nav">
      <span className="nav-brand">Homesavers</span>

      {canDoHQTasks(session)    && <NavLink to="/tasks"       className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>HO Tasks</NavLink>}
      {canDoStoreTasks(session) && <NavLink to="/store-tasks" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Store Tasks</NavLink>}
      <NavLink to="/reports"    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Reports</NavLink>

      {canSeeAnyAdminLink(session) && (
        <NavLink
          to={canAccessAdmin(session) ? '/admin/stores' : '/admin/task-templates'}
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >Admin</NavLink>
      )}

      <OfflineIndicator />
      <CapacityAlert />

      <span className="nav-context-chip" title={`Signed in as ${roleLabel(session.role)}`}>
        <span className={`nav-context-dot ${isStoreRole ? 'is-store' : 'is-ho'}`} />
        {contextLabel}
        {currentStore && <span className="nav-context-store"> · {currentStore.store_name}</span>}
      </span>

      <span className="nav-store-badge" title={`Role: ${roleLabel(session.role)}`}>
        {session.displayName || session.display_name || session.storeName}
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
