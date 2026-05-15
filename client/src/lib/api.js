// All API calls go through /api/* — handled by Cloudflare Pages Functions.
// The Function holds the Supabase credentials; client only ever sends a
// short-lived HMAC-signed session token returned by /verify-pin.

const base = '/api'
const TOKEN_KEY = 'hs_token'

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

// ── Auth & stores ───────────────────────────────────────────────────────────

export const getStores            = () => request('/stores')
export const verifyStorePin       = (storeId, pin) => request('/stores/verify-pin', { method: 'POST', body: { storeId, pin } })
export const verifyBackofficePin  = (pin) => request('/backoffice/verify-pin', { method: 'POST', body: { pin } })

// ── Reference data ──────────────────────────────────────────────────────────

export const getTaskTypes      = () => request('/task-types')
export const getLookupOptions  = ({ kind, task_type } = {}) => {
  const q = new URLSearchParams()
  if (kind)      q.set('kind', kind)
  if (task_type) q.set('task_type', task_type)
  return request(`/lookup-options?${q}`)
}
export const getSuppliers      = () => request('/suppliers')

// ── Products master lookup ──────────────────────────────────────────────────

export const lookupProduct = (productCode) =>
  request(`/products/lookup?code=${encodeURIComponent(productCode)}`)

// ── Photos ──────────────────────────────────────────────────────────────────
// Note: photo upload uses multipart/form-data so we bypass the JSON `request`.

export async function uploadPhoto({ file, slot, tempId }) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('slot', slot)
  fd.append('tempId', tempId)
  const res = await fetch(`${base}/photos/upload`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body:    fd
  })
  if (res.status === 401) {
    clearToken()
    sessionStorage.removeItem('hs_session')
    localStorage.removeItem('hs_session')
    if (typeof window !== 'undefined') window.location.reload()
    throw new Error('Session expired')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Upload failed')
  return data
}

export const deletePhoto = (objectPath) =>
  request(`/photos?path=${encodeURIComponent(objectPath)}`, { method: 'DELETE' })

// ── Task records ────────────────────────────────────────────────────────────

export const getTaskRecords = ({ storeId, taskType, status, filters = {} } = {}) => {
  const q = new URLSearchParams()
  if (storeId)  q.set('storeId', storeId)
  if (taskType) q.set('task_type', taskType)
  if (status)   q.set('status', status)
  for (const [k, v] of Object.entries(filters)) q.set(k, v)
  return request('/task-records' + (q.toString() ? `?${q}` : ''))
}

export const createTaskRecord = (record) =>
  request('/task-records', { method: 'POST', body: record })

export const updateTaskRecord = (id, updates) =>
  request(`/task-records/${id}`, { method: 'PATCH', body: updates })

export const deleteTaskRecord = (id) =>
  request(`/task-records/${id}`, { method: 'DELETE' })

// ── Admin (back office) ─────────────────────────────────────────────────────

export const adminListStores  = () => request('/admin/stores')
export const adminCreateStore = (store) => request('/admin/stores', { method: 'POST', body: store })
export const adminUpdateStore = (id, updates) => request(`/admin/stores/${id}`, { method: 'PATCH', body: updates })
export const adminResetStorePin = (id, pin) => request(`/admin/stores/${id}/reset-pin`, { method: 'POST', body: { pin } })
