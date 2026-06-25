import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../App.jsx'
import { resolvedTheme, setTheme } from '../lib/theme.js'
import { canAccessAdmin, canDoHQTasks, canDoStoreTasks, STORE_ROLE_KEYS, roleLabel } from '../lib/roles.js'
import { useCurrentStore } from '../lib/currentStore.jsx'
import { getMessageThreads, dismissMessageThread } from '../lib/api.js'
import { TASK_FORMS } from '../lib/taskTypes.js'
import OfflineIndicator from './OfflineIndicator.jsx'
import CapacityAlert from './CapacityAlert.jsx'

export default function Nav() {
  const { session, logout } = useStore()
  const navigate = useNavigate()
  const { currentStoreId, scopedStores } = useCurrentStore()
  const [theme, setLocalTheme] = useState(resolvedTheme())

  const [threads, setThreads]   = useState([])
  const [unread, setUnread]     = useState(0)
  const [msgOpen, setMsgOpen]   = useState(false)
  const msgRef = useRef(null)

  useEffect(() => {
    if (!session) return
    const refresh = () => getMessageThreads()
      .then(d => { setThreads(d?.threads || []); setUnread(d?.unread_total || 0) })
      .catch(() => {})
    refresh()
    const t = setInterval(refresh, 60000)
    window.addEventListener('hs:messages-read', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('hs:messages-read', refresh)
    }
  }, [session])

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!msgOpen) return
    const onDoc = (e) => { if (msgRef.current && !msgRef.current.contains(e.target)) setMsgOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [msgOpen])

  const openThread = (t) => {
    // Navigate to the record — keep the dropdown open so users can see the full list.
    navigate('/tasks', { state: { openRecordId: t.record_id, taskType: t.task_type } })
    setMsgOpen(false)
  }

  const clearThread = async (e, t) => {
    e.stopPropagation()
    try {
      await dismissMessageThread(t.record_id)
      setThreads(prev => prev.filter(x => x.record_id !== t.record_id))
      setUnread(prev => Math.max(0, prev - (t.unread || 0)))
      window.dispatchEvent(new Event('hs:messages-read'))
    } catch (_) {}
  }

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
        <NavLink to="/admin/stores" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Admin</NavLink>
      )}

      {/* Messages — clickable dropdown, visible on every page incl. mobile */}
      <div className="nav-msg" ref={msgRef}>
        <button
          type="button"
          className={`nav-msg-btn${unread > 0 ? ' has-unread' : ''}`}
          onClick={() => setMsgOpen(o => !o)}
          aria-label={`Messages${unread ? `, ${unread} unread` : ''}`}
          title="Messages"
        >
          <span className="nav-msg-ico" aria-hidden>✉</span>
          {unread > 0 && <span className="nav-msg-badge">{unread}</span>}
        </button>
        {msgOpen && (
          <div className="nav-msg-menu" role="menu">
            <div className="nav-msg-head">
              Messages{unread > 0 ? ` · ${unread} unread` : ''}
            </div>
            {threads.length === 0 ? (
              <div className="nav-msg-empty">No active messages.</div>
            ) : threads.map(t => (
              <div key={t.record_id} className="nav-msg-item-wrap">
                <button type="button" className="nav-msg-item" onClick={() => openThread(t)}>
                  <div className="nav-msg-item-top">
                    {t.has_high_priority && <span className="nav-msg-hipri">HIGH</span>}
                    <span className="nav-msg-item-label">{(TASK_FORMS[t.task_type]?.name || t.task_type)} · {t.label}</span>
                    {t.unread > 0 && <span className="nav-msg-item-count">{t.unread}</span>}
                  </div>
                  <div className="nav-msg-item-preview">{t.preview}</div>
                </button>
                <button
                  type="button"
                  className="nav-msg-clear"
                  title="Dismiss this thread"
                  onClick={(e) => clearThread(e, t)}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

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
