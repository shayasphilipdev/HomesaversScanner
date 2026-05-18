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

  let res
  try {
    res = await fetch(`${base}${path}`, {
      headers,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
  } catch (e) {
    // Network failure (offline, DNS, dropped TLS). Bubble up a recognisable
    // error so the caller can decide whether to enqueue.
    throw new Error('Network error: ' + (e?.message || 'request failed'))
  }

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
export const verifyUserPin        = (username, pin) => request('/users/verify-pin', { method: 'POST', body: { username, pin } })

// ── Reference data ──────────────────────────────────────────────────────────

export const getTaskTypes      = () => request('/task-types')
export const getLookupOptions  = ({ kind, task_type } = {}) => {
  const q = new URLSearchParams()
  if (kind)      q.set('kind', kind)
  if (task_type) q.set('task_type', task_type)
  return request(`/lookup-options?${q}`)
}
export const getSuppliers      = () => request('/suppliers')
export const getAreas          = () => request('/areas')

export const getDashboardStats = ({ from, to, storeId } = {}) => {
  const q = new URLSearchParams()
  if (from)    q.set('from', from)
  if (to)      q.set('to', to)
  if (storeId) q.set('storeId', storeId)
  return request('/dashboard/stats' + (q.toString() ? `?${q}` : ''))
}

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

// Tries the network first; on offline / network failure the request is
// queued in IndexedDB (see lib/outbox.js) and replayed when we come back
// online. Returns { queued: true, id } in that case so forms can show
// "Saved offline" instead of "Saved".
export const createTaskRecord = async (record) => {
  try {
    return await request('/task-records', { method: 'POST', body: record })
  } catch (e) {
    const { isOfflineError, add: outboxAdd } = await import('./outbox.js')
    if (isOfflineError(e)) {
      const id = await outboxAdd({ kind: 'simple', body: record })
      return { queued: true, id }
    }
    throw e
  }
}

export const updateTaskRecord = (id, updates) =>
  request(`/task-records/${id}`, { method: 'PATCH', body: updates })

export const deleteTaskRecord = (id) =>
  request(`/task-records/${id}`, { method: 'DELETE' })

export const bulkReviewTaskRecords = ({ ids, status, review_notes }) =>
  request('/task-records/bulk-review', { method: 'POST', body: { ids, status, review_notes } })

// ── Admin (back office) ─────────────────────────────────────────────────────

export const adminListStores    = () => request('/admin/stores')
export const adminCreateStore   = (store) => request('/admin/stores', { method: 'POST', body: store })
export const adminUpdateStore   = (id, updates) => request(`/admin/stores/${id}`, { method: 'PATCH', body: updates })
export const adminResetStorePin = (id, pin) => request(`/admin/stores/${id}/reset-pin`, { method: 'POST', body: { pin } })

export const adminListSuppliers  = () => request('/admin/suppliers')
export const adminCreateSupplier = (supplier) => request('/admin/suppliers', { method: 'POST', body: supplier })
export const adminUpdateSupplier = (id, updates) => request(`/admin/suppliers/${id}`, { method: 'PATCH', body: updates })
export const adminBulkSuppliers  = (rows) => request('/admin/suppliers/bulk', { method: 'POST', body: rows })

export const adminListLookups   = (kind) => request('/admin/lookup-options' + (kind ? `?kind=${kind}` : ''))
export const adminCreateLookup  = (opt) => request('/admin/lookup-options', { method: 'POST', body: opt })
export const adminUpdateLookup  = (id, updates) => request(`/admin/lookup-options/${id}`, { method: 'PATCH', body: updates })
export const adminDeleteLookup  = (id) => request(`/admin/lookup-options/${id}`, { method: 'DELETE' })

export const adminListProducts  = ({ limit, q } = {}) => {
  const p = new URLSearchParams()
  if (limit) p.set('limit', limit)
  if (q)     p.set('q', q)
  return request('/admin/products' + (p.toString() ? `?${p}` : ''))
}
export const adminProductsCount = () => request('/admin/products/count')
export const adminBulkProducts  = (rows) => request('/admin/products/bulk', { method: 'POST', body: rows })
export const adminUpdateProduct = (id, updates) => request(`/admin/products/${id}`, { method: 'PATCH', body: updates })

export const adminGetSettings    = () => request('/admin/settings')
export const adminUpdateSettings = (updates) => request('/admin/settings', { method: 'PATCH', body: updates })
export const adminCleanupPhotos  = () => request('/admin/cleanup/photos', { method: 'POST' })

export const adminListAreas   = () => request('/admin/areas')
export const adminCreateArea  = (area) => request('/admin/areas', { method: 'POST', body: area })
export const adminUpdateArea  = (id, updates) => request(`/admin/areas/${id}`, { method: 'PATCH', body: updates })

export const adminListUsers     = () => request('/admin/users')
export const adminCreateUser    = (user) => request('/admin/users', { method: 'POST', body: user })
export const adminUpdateUser    = (id, updates) => request(`/admin/users/${id}`, { method: 'PATCH', body: updates })
export const adminResetUserPin  = (id, pin) => request(`/admin/users/${id}/reset-pin`, { method: 'POST', body: { pin } })

export const adminListEmployees = () => request('/admin/employees')

// ── Store tasks (Phase 9D + 9E) ─────────────────────────────────────────────

export const adminListTemplates   = () => request('/admin/task-templates')
export const adminCreateTemplate  = (tpl) => request('/admin/task-templates', { method: 'POST', body: tpl })
export const adminUpdateTemplate  = (id, updates) => request(`/admin/task-templates/${id}`, { method: 'PATCH', body: updates })
export const adminDeleteTemplate  = (id) => request(`/admin/task-templates/${id}`, { method: 'DELETE' })

export const getStoreTasksToday = ({ storeId } = {}) => {
  const q = new URLSearchParams()
  if (storeId) q.set('storeId', storeId)
  return request('/store-tasks/today' + (q.toString() ? `?${q}` : ''))
}
export const completeStoreTask  = (id, { photo_url, notes, answers } = {}) =>
  request(`/store-tasks/${id}/complete`, { method: 'PATCH', body: { photo_url, notes, answers } })
export const getStoreTaskStats  = ({ from, to, storeId } = {}) => {
  const q = new URLSearchParams()
  if (from)    q.set('from', from)
  if (to)      q.set('to', to)
  if (storeId) q.set('storeId', storeId)
  return request('/store-tasks/stats' + (q.toString() ? `?${q}` : ''))
}
export const generateStoreTasks = ({ date, storeId } = {}) =>
  request('/store-tasks/generate', { method: 'POST', body: { date, storeId } })

export const getStoreTaskReportRows = ({ from, to, storeId, template_id } = {}) => {
  const q = new URLSearchParams()
  if (from)        q.set('from', from)
  if (to)          q.set('to', to)
  if (storeId)     q.set('storeId', storeId)
  if (template_id) q.set('template_id', template_id)
  return request('/reports/store-tasks/json' + (q.toString() ? `?${q}` : ''))
}
