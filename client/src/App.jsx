import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, createContext, useContext } from 'react'
import StoreSelector from './components/StoreSelector.jsx'
import Nav from './components/Nav.jsx'
import ProductData from './pages/ProductData.jsx'
import Reports from './pages/Reports.jsx'
import { setToken, clearToken } from './lib/api.js'

export const StoreContext = createContext(null)
export const useStore = () => useContext(StoreContext)

const SESSION_KEY = 'hs_session'

// Back-office sessions live in sessionStorage (clears on tab close);
// store sessions persist in localStorage so people can keep working.
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
    return <StoreSelector onLogin={login} />
  }

  return (
    <StoreContext.Provider value={{ session, logout }}>
      <div className="app">
        <Nav />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/products" replace />} />
            <Route path="/products" element={<ProductData />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </main>
      </div>
    </StoreContext.Provider>
  )
}
