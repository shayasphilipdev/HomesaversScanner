// All API calls go through /api/* — handled by Cloudflare Pages Functions.
// The Function holds the Supabase credentials; client only ever sends a
// short-lived HMAC-signed session token returned by /verify-pin.

const base = '/api'

const TOKEN_KEY = 'hs_token'

// Token lives wherever the session lives — sessionStorage for back office
// (clears on tab close), localStorage for store users (persists).
export const getToken = () =>
  sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY)

export const setToken = (token, mode) => {
  clearToken()
  if (mode === 'backoffice') sessionStorage.setItem(TOKEN_KEY, token)
  else                       localStorage.setItem(TOKEN_KEY, token)
}

export const clearToken = () => {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${base}${path}`, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  // Session expired or invalid — wipe everything and bounce to login.
  if (res.status === 401) {
    clearToken()
    sessionStorage.removeItem('hs_session')
    localStorage.removeItem('hs_session')
    if (typeof window !== 'undefined') window.location.reload()
    throw new Error('Session expired')
  }

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// ── Stores ──────────────────────────────────────────────────────────────────

export const getStores = () =>
  request('/stores')

export const verifyStorePin = (storeId, pin) =>
  request('/stores/verify-pin', { method: 'POST', body: { storeId, pin } })

export const verifyBackofficePin = (pin) =>
  request('/backoffice/verify-pin', { method: 'POST', body: { pin } })

// ── Product records ─────────────────────────────────────────────────────────
// mode / storeId are no longer sent — the server derives them from the token.
// Back office can pass storeId to narrow results.

export const getProductRecords = ({ storeId, filters = {} } = {}) => {
  const q = new URLSearchParams()
  if (storeId) q.set('storeId', storeId)
  for (const [k, v] of Object.entries(filters)) q.set(k, v)
  return request('/product-records' + (q.toString() ? `?${q}` : ''))
}

export const createProductRecord = (record) =>
  request('/product-records', { method: 'POST', body: record })

export const updateProductRecord = (id, updates) =>
  request(`/product-records/${id}`, { method: 'PATCH', body: updates })

export const deleteProductRecord = (id) =>
  request(`/product-records/${id}`, { method: 'DELETE' })

// ── Products master lookup ──────────────────────────────────────────────────

export const lookupProduct = (productCode) =>
  request(`/products/lookup?code=${encodeURIComponent(productCode)}`)
