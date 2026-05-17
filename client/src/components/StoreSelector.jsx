import { useState, useEffect } from 'react'
import { getStores, verifyStorePin, verifyUserPin } from '../lib/api.js'

// Login. Two tabs since Phase 9B:
//   - Store        : pick store + PIN → resolves to that store's default
//                    sales_assistant user (UX unchanged from earlier).
//   - Staff / HQ   : username + PIN → any other user (store_manager,
//                    area_manager, support_admin, buying_manager,
//                    commercial_manager, director).
export default function StoreSelector({ onLogin }) {
  const [tab, setTab] = useState('store')      // 'store' | 'staff'
  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState('')
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStores, setLoadingStores] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getStores()
      .then(data => setStores(data))
      .catch(() => setError('Could not load stores. Check your connection.'))
      .finally(() => setLoadingStores(false))
  }, [])

  const handleStoreLogin = async (e) => {
    e.preventDefault()
    if (!storeId) return setError('Please select a store.')
    if (!pin)     return setError('Please enter the store PIN.')
    setLoading(true); setError('')
    try {
      const { token, store, user } = await verifyStorePin(storeId, pin)
      onLogin({
        mode:        'store',
        storeId:     store.id,
        storeName:   store.store_name,
        storeCode:   store.store_code,
        role:        user?.role || 'sales_assistant',
        displayName: user?.display_name || store.store_name,
        userId:      user?.id || null,
        token
      })
    } catch {
      setError('That PIN doesn’t match — try again or ask HQ to reset it.')
    } finally {
      setLoading(false)
    }
  }

  const handleStaffLogin = async (e) => {
    e.preventDefault()
    if (!username.trim()) return setError('Please enter your username.')
    if (!pin)             return setError('Please enter your PIN.')
    setLoading(true); setError('')
    try {
      const { token, user } = await verifyUserPin(username.trim(), pin)
      const isStoreRole = user?.role === 'sales_assistant' || user?.role === 'store_manager'
      onLogin({
        mode:        isStoreRole ? 'store' : 'backoffice',
        storeId:     user?.store_id || null,
        storeName:   user?.display_name || username.trim(),
        role:        user?.role,
        displayName: user?.display_name || username.trim(),
        userId:      user?.id || null,
        token
      })
    } catch {
      setError('Username or PIN doesn’t match — try again or ask HQ to reset it.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <h1>Homesavers</h1>
          <p>Scanner App</p>
        </div>

        <div className="login-tabs">
          <button className={`login-tab ${tab === 'store' ? 'active' : ''}`} onClick={() => { setTab('store'); setError(''); setPin('') }}>
            Store
          </button>
          <button className={`login-tab ${tab === 'staff' ? 'active' : ''}`} onClick={() => { setTab('staff'); setError(''); setPin('') }}>
            Staff / HQ
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        {tab === 'store' && (
          <form onSubmit={handleStoreLogin}>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Store</label>
              {loadingStores
                ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading stores…</div>
                : <select value={storeId} onChange={e => setStoreId(e.target.value)} required>
                    <option value="">Select store…</option>
                    {stores.filter(s => s.is_active).map(s => (
                      <option key={s.id} value={s.id}>{s.store_name} ({s.store_code})</option>
                    ))}
                  </select>
              }
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label>Store PIN</label>
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="4-digit PIN" maxLength={8} required />
            </div>
            <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={loading || loadingStores}>
              {loading ? <span className="spinner" /> : 'Sign in to Store'}
            </button>
          </form>
        )}

        {tab === 'staff' && (
          <form onSubmit={handleStaffLogin}>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Username</label>
              <input
                type="text" autoCapitalize="none" autoCorrect="off" autoComplete="username"
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="e.g. director"
                required
              />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label>PIN</label>
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" maxLength={12} required />
            </div>
            <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Sign in'}
            </button>
            <p className="note" style={{ marginTop: 12, fontSize: 12, textAlign: 'center' }}>
              For Store Managers, Area Managers, Support Admins, Buying Managers,<br />
              Buying Heads, and the Admin.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
