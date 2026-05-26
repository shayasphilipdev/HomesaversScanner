import { useState } from 'react'
import { verifyUserPin } from '../lib/api.js'

// Phase 9J: single login form. Stores no longer have their own PIN —
// every login is an employee account with a username + PIN.
export default function StoreSelector({ onLogin }) {
  const [username, setUsername] = useState('')
  const [pin, setPin]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim()) return setError('Please enter your username.')
    if (!pin)             return setError('Please enter your PIN.')
    setLoading(true); setError('')
    try {
      const { token, user } = await verifyUserPin(username.trim(), pin)
      const storeRole = user?.role === 'sales_assistant' || user?.role === 'supervisor' ||
                        user?.role === 'assistant_store_manager' || user?.role === 'store_manager'
      onLogin({
        mode:                   storeRole ? 'store' : 'backoffice',
        role:                   user?.role,
        userId:                 user?.id || null,
        displayName:            user?.display_name || username.trim(),
        all_stores:             !!user?.all_stores,
        store_ids:              user?.store_ids || [],
        area_ids:               user?.area_ids || [],
        can_access_hq_tasks:    user?.can_access_hq_tasks    !== false,
        can_access_store_tasks: user?.can_access_store_tasks !== false,
        // Legacy compat: storeId = the single store when there's exactly one
        storeId:                user?.store_ids?.length === 1 ? user.store_ids[0] : null,
        storeName:              user?.display_name || username.trim(),
        token
      })
    } catch (e) {
      // Distinguish a server/network outage from a wrong-credentials error.
      const msg = e?.message || ‘’
      if (msg.startsWith(‘Network error’) || msg.includes(‘Failed to fetch’) || msg.includes(‘NetworkError’)) {
        setError(‘Can’t reach the server — check your internet connection and try again.’)
      } else {
        setError(‘Username or PIN doesn’t match — try again or ask the Admin to reset it.’)
      }
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

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label>Username</label>
            <input
              type="text" autoCapitalize="none" autoCorrect="off" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="e.g. jdoe"
              required autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label>PIN</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" maxLength={16} required />
          </div>
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign in'}
          </button>
          <p className="note" style={{ marginTop: 14, fontSize: 12, textAlign: 'center' }}>
            Every employee signs in with their own username and PIN. The Admin manages accounts under Admin → Employees.
          </p>
        </form>
      </div>
    </div>
  )
}
