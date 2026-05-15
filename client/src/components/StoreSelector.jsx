import { useState, useEffect } from 'react'
import { getStores, verifyStorePin, verifyBackofficePin } from '../lib/api.js'

export default function StoreSelector({ onLogin }) {
  const [tab, setTab] = useState('store')          // 'store' | 'backoffice'
  const [stores, setStores] = useState([])
  const [storeId, setStoreId] = useState('')
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
    if (!pin) return setError('Please enter the store PIN.')
    setLoading(true); setError('')
    try {
      await verifyStorePin(storeId, pin)
      const store = stores.find(s => s.id === storeId)
      onLogin({ mode: 'store', storeId, storeName: store.store_name, storeCode: store.store_code })
    } catch {
      setError('Incorrect PIN. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleBackofficeLogin = async (e) => {
    e.preventDefault()
    if (!pin) return setError('Please enter the back office PIN.')
    setLoading(true); setError('')
    try {
      await verifyBackofficePin(pin)
      onLogin({ mode: 'backoffice', storeName: 'Back Office' })
    } catch {
      setError('Incorrect PIN. Please try again.')
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
          <button className={`login-tab ${tab === 'backoffice' ? 'active' : ''}`} onClick={() => { setTab('backoffice'); setError(''); setPin('') }}>
            Back Office
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

        {tab === 'backoffice' && (
          <form onSubmit={handleBackofficeLogin}>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label>Back Office PIN</label>
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" maxLength={12} autoFocus required />
            </div>
            <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Sign in to Back Office'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
