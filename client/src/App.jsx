import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import StoreSelector from './components/StoreSelector.jsx'
import Nav from './components/Nav.jsx'
import Sidebar from './components/Sidebar.jsx'
import BottomNav from './components/BottomNav.jsx'
import AdminGuard from './components/AdminGuard.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { CurrentStoreProvider } from './lib/currentStore.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Tasks from './pages/Tasks.jsx'
import Reports from './pages/Reports.jsx'
import Sync from './pages/Sync.jsx'
import StoreTasks from './pages/StoreTasks.jsx'
import ProductQuery from './pages/ProductQuery.jsx'
import ManagerDashboard from './pages/ManagerDashboard.jsx'
import AdminTaskTemplates from './pages/AdminTaskTemplates.jsx'
import AdminStores from './pages/AdminStores.jsx'
import AdminAreas from './pages/AdminAreas.jsx'
import AdminUsers from './pages/AdminUsers.jsx'
import AdminEmployees from './pages/AdminEmployees.jsx'
import AdminLookups from './pages/AdminLookups.jsx'
import AdminProducts from './pages/AdminProducts.jsx'
import AdminSettings from './pages/AdminSettings.jsx'
import AdminSuppliers from './pages/AdminSuppliers.jsx'
import SpacePlan from './pages/SpacePlan.jsx'
import Competition from './pages/Competition.jsx'
import Pricing from './pages/Pricing.jsx'
import AdminSpacePlan from './pages/AdminSpacePlan.jsx'
import { setToken, clearToken, getAppConfig } from './lib/api.js'
import { canDoHQTasks } from './lib/roles.js'
import { isTestEnv } from './lib/env.js'

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

const APP_CONFIG_KEY = 'hs_app_config'
function loadAppConfig() {
  try { return JSON.parse(localStorage.getItem(APP_CONFIG_KEY)) || null } catch { return null }
}

export default function App() {
  const [session, setSession] = useState(loadSession)
  // Chain-wide client flags. Seeded synchronously from the last cached copy so
  // nav gating (e.g. the Competition module) doesn't flicker on reload, then
  // refreshed from the server once we have a session.
  const [appConfig, setAppConfig] = useState(loadAppConfig)

  // Pull chain-wide client flags once we have a session (camera-scan toggle,
  // Competition module on/off). Cached in localStorage: the camera flag so
  // ScannerInput can read it synchronously, the whole config so nav gating is
  // available on the next reload before the fetch resolves.
  useEffect(() => {
    if (!session) return
    getAppConfig()
      .then(cfg => {
        setAppConfig(cfg)
        localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(cfg))
        localStorage.setItem('hs_camera_enabled', cfg?.scanner_camera_enabled ? '1' : '0')
      })
      .catch(() => {})
  }, [session])

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
    <StoreContext.Provider value={{ session, logout, appConfig }}>
      <ToastProvider>
        <CurrentStoreProvider>
          <Shell />
        </CurrentStoreProvider>
      </ToastProvider>
    </StoreContext.Provider>
  )
}

// Sits inside the Router so we can read the current path and widen the
// main content area for data-dense pages (Reports, Dashboard).
function Shell() {
  const { session } = useStore()
  const { pathname } = useLocation()
  // Data-dense pages get a wider-but-capped, centred container (keeps aesthetic
  // margins on big screens). Space Plan is included — its grid scrolls inside.
  const wide = pathname.startsWith('/reports') || pathname.startsWith('/dashboard') || pathname.startsWith('/manager') || pathname.startsWith('/space-plan') || pathname.startsWith('/pricing')
  // Store users (mode === 'store') always land on HO Tasks.
  // HQ / back-office users go by their per-account flag.
  const home = (session.mode === 'store' || canDoHQTasks(session)) ? '/tasks' : '/dashboard'

  return (
    <div className="app">
      {isTestEnv() && (
        <div style={{
          background: '#B00020', color: '#fff', textAlign: 'center',
          fontSize: 13, fontWeight: 700, letterSpacing: '.4px', padding: '5px 8px'
        }}>
          ⚠ TESTING MODE — this is the TEST app, not live. Changes here are for testing only.
        </div>
      )}
      <Nav />
      <div className="app-body">
        <Sidebar />
        <main className={`main-content${wide ? ' main-content--wide' : ''}`}>
          <Routes>
            <Route path="/"              element={<Navigate to={home} replace />} />
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/tasks"         element={<Tasks />} />
            <Route path="/reports"       element={<Reports />} />
            <Route path="/sync"          element={<Sync />} />
            <Route path="/store-tasks"   element={<StoreTasks />} />
            <Route path="/space-plan"    element={<SpacePlan />} />
            <Route path="/competition"   element={<Competition />} />
            <Route path="/pricing"       element={<Pricing />} />
            <Route path="/product-query" element={<ProductQuery />} />
            <Route path="/manager"       element={<ManagerDashboard />} />
            <Route path="/admin/task-templates" element={<AdminGuard mode="templates"><AdminTaskTemplates /></AdminGuard>} />
            <Route path="/admin"            element={<Navigate to="/admin/stores" replace />} />
            <Route path="/admin/stores"     element={<AdminGuard><AdminStores /></AdminGuard>} />
            <Route path="/admin/areas"      element={<AdminGuard><AdminAreas /></AdminGuard>} />
            <Route path="/admin/users"      element={<AdminGuard><AdminUsers /></AdminGuard>} />
            <Route path="/admin/employees"  element={<AdminGuard><AdminEmployees /></AdminGuard>} />
            <Route path="/admin/lookups"    element={<AdminGuard><AdminLookups /></AdminGuard>} />
            <Route path="/admin/products"   element={<AdminGuard><AdminProducts /></AdminGuard>} />
            <Route path="/admin/suppliers"  element={<AdminGuard><AdminSuppliers /></AdminGuard>} />
            <Route path="/admin/space-plan" element={<AdminGuard><AdminSpacePlan /></AdminGuard>} />
            <Route path="/admin/settings"   element={<AdminGuard mode="settings"><AdminSettings /></AdminGuard>} />
            {/* Master Reports moved into the Reports page; keep the old URL working. */}
            <Route path="/admin/reports"    element={<Navigate to="/reports" replace />} />
          <Route path="*"                 element={<Navigate to={home} replace />} />
        </Routes>
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
