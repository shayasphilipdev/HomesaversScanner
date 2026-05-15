import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import StoreSelector from './components/StoreSelector.jsx'
import Nav from './components/Nav.jsx'
import ProductData from './pages/ProductData.jsx'
import Reports from './pages/Reports.jsx'

export const StoreContext = createContext(null)
export const useStore = () => useContext(StoreContext)

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem('hs_session')
    return saved ? JSON.parse(saved) : null
  })

  const login = (sessionData) => {
    localStorage.setItem('hs_session', JSON.stringify(sessionData))
    setSession(sessionData)
  }

  const logout = () => {
    localStorage.removeItem('hs_session')
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
