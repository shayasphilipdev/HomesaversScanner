// All API calls go through /api/* — handled by Cloudflare Pages Functions.
// The functions add the Supabase credentials server-side; nothing sensitive
// is ever exposed in the client bundle.

const base = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  })
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

// ── Product records ──────────────────────────────────────────────────────────

export const getProductRecords = ({ storeId, mode, filters = {} }) =>
  request('/product-records?' + new URLSearchParams({
    storeId: storeId || '',
    mode: mode || 'store',
    ...filters
  }))

export const createProductRecord = (record) =>
  request('/product-records', { method: 'POST', body: record })

export const updateProductRecord = (id, updates) =>
  request(`/product-records/${id}`, { method: 'PATCH', body: updates })

export const deleteProductRecord = (id) =>
  request(`/product-records/${id}`, { method: 'DELETE' })

// ── Products master lookup ────────────────────────────────────────────────────

export const lookupProduct = (productCode) =>
  request(`/products/lookup?code=${encodeURIComponent(productCode)}`)
