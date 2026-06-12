import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useStore } from '../App.jsx'
import { resolvedTheme, setTheme } from '../lib/theme.js'
import { canAccessAdmin, canDoHQTasks, canDoStoreTasks, STORE_ROLE_KEYS, roleLabel } from '../lib/roles.js'
import { useCurrentStore } from '../lib/currentStore.jsx'
import { getUnreadMessageCount } from '../lib/api.js'
import OfflineIndicator from './OfflineIndicator.jsx'
import CapacityAlert from './CapacityAlert.jsx'

export default function Nav() {
  const { session, logout } = useStore()
  const { currentStoreId, scopedStores } = useCurrentStore()
  const [theme, setLocalTheme] = useState(resolvedTheme())
  const [unreadMsgs, setUnreadMsgs] = useState(0)

  useEffect(() => {
    if (!session) return
    const refresh = () => {
      getUnreadMessageCount().then(d => setUnreadMsgs(d?.count || 0)).catch(() => {})
    }
    refresh()
    const t = setInterval(refresh, 60000)
    window.addEventListener('hs:messages-read', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('hs:messages-read', refresh)
    }
  }, [session])

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
      <NavLink to="/space-plan" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Space Plan</NavLink>
      <NavLink to="/reports"    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Reports</NavLink>

      {canAccessAdmin(session) && (
        <NavLink
          to="/admin/stores"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >Admin</NavLink>
      )}

      {unreadMsgs > 0 && (
        <span
          className="nav-link"
          title={`${unreadMsgs} record${unreadMsgs === 1 ? '' : 's'} with unread messages`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'default' }}
        >
          💬
          <span style={{
            background: '#e53e3e', color: '#fff', borderRadius: 999,
            fontSize: 11, fontWeight: 700, padding: '1px 6px', lineHeight: 1.4
          }}>
            {unreadMsgs}
          </span>
        </span>
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
