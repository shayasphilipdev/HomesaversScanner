import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, createContext, useContext } from 'react'
import StoreSelector from './components/StoreSelector.jsx'
import Nav from './components/Nav.jsx'
import BottomNav from './components/BottomNav.jsx'
import { ToastProvider } from './components/Toast.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Tasks from './pages/Tasks.jsx'
import Reports from './pages/Reports.jsx'
import AdminStores from './pages/AdminStores.jsx'
import AdminSuppliers from './pages/AdminSuppliers.jsx'
import AdminLookups from './pages/AdminLookups.jsx'
import AdminProducts from './pages/AdminProducts.jsx'
import AdminSettings from './pages/AdminSettings.jsx'
import { setToken, clearToken } from './lib/api.js'

export const StoreContext = createContext(null)
export const useStore = () => useContext(StoreContext)

const SESSION_KEY = 'hs_session'

function loadSession() {
  const bo = sessionStorage.getItem(SESSION_KEY)
  if (bo) return JSON.parse(bo)
  const store = localStorage.getItem(SESSION_KEY)
  if (store) return JSON.parse(store)
  return null
}

function saveSession(s) {
  sessionStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(SESSION_KEY)
  const target = s.mode === 'backoffice' ? sessionStorage : localStorage
  target.setItem(SESSION_KEY, JSON.stringify(s))
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(SESSION_KEY)
}

export default function App() {
  const [session, setSession] = useState(loadSession)

  const login = ({ token, ...sessionData }) => {
    setToken(token, sessionData.mode)
    saveSession(sessionData)
    setSession(sessionData)
  }

  const logout = () => {
    clearToken()
    clearSession()
    setSession(null)
  }

  if (!session) {
    return (
      <ToastProvider>
        <StoreSelector onLogin={login} />
      </ToastProvider>
    )
  }

  return (
    <StoreContext.Provider value={{ session, logout }}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreContext.Provider>
  )
}

// Sits inside the Router so we can read the current path and widen the
// main content area for data-dense pages (Reports, Dashboard).
function Shell() {
  const { pathname } = useLocation()
  const wide = pathname.startsWith('/reports') || pathname.startsWith('/dashboard')

  return (
    <div className="app">
      <Nav />
      <main className={`main-content${wide ? ' main-content--wide' : ''}`}>
        <Routes>
            <Route path="/"              element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/tasks"         element={<Tasks />} />
            <Route path="/reports"       element={<Reports />} />
            <Route path="/admin"            element={<Navigate to="/admin/stores" replace />} />
            <Route path="/admin/stores"     element={<AdminStores />} />
            <Route path="/admin/suppliers"  element={<AdminSuppliers />} />
            <Route path="/admin/lookups"    element={<AdminLookups />} />
            <Route path="/admin/products"   element={<AdminProducts />} />
            <Route path="/admin/settings"   element={<AdminSettings />} />
          <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}
