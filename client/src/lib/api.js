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
// Phase 9J: single login. Old /stores/verify-pin and /backoffice/verify-pin
// were removed server-side.
export const verifyUserPin        = (username, pin) => request('/users/verify-pin', { method: 'POST', body: { username, pin } })

// ── Reference data ──────────────────────────────────────────────────────────

export const getTaskTypes      = () => request('/task-types')
export const getAppConfig      = () => request('/app-config')
export const getLookupOptions  = ({ kind, task_type } = {}) => {
  const q = new URLSearchParams()
  if (kind)      q.set('kind', kind)
  if (task_type) q.set('task_type', task_type)
  return request(`/lookup-options?${q}`)
}
export const getSuppliers      = () => request('/suppliers')
export const getAreas          = () => request('/areas')

export const getDashboardStats = ({ from, to, storeId, storeIds } = {}) => {
  const q = new URLSearchParams()
  if (from)    q.set('from', from)
  if (to)      q.set('to', to)
  if (Array.isArray(storeIds) && storeIds.length) q.set('storeIds', storeIds.join(','))
  else if (storeId) q.set('storeId', storeId)
  return request('/dashboard/stats' + (q.toString() ? `?${q}` : ''))
}

// Product Master — paginated lookup for all users (alt_barcodes + prices).
// Browse by page, search (q >= 2 chars), and/or exact-match dropdown filters.
// Returns { rows, total, page, limit, pages }. 100 rows per page. View-only.
export const getProductMaster = ({ q = '', page = 1, filters = {} } = {}) => {
  const p = new URLSearchParams()
  if (q) p.set('q', q)
  if (page > 1) p.set('page', String(page))
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v)
  return request('/product-master' + (p.toString() ? `?${p}` : ''))
}

// Distinct values for the Product Master dropdown filters.
export const getProductMasterFilters = () => request('/product-master/filters')

// ── Products master lookup ──────────────────────────────────────────────────

export const lookupProduct = (productCode) =>
  request(`/products/lookup?code=${encodeURIComponent(productCode)}`)

// Phase 3: scan lookup against the Alternate Barcode table (Barcode_No is the
// primary key). Returns { barcode_no, ean_barcode, item_name, supl_id,
// supplier_code, item_status, barcode_status } or null.
export const lookupAltBarcode = (barcode) =>
  request(`/alt-barcodes/lookup?barcode=${encodeURIComponent(barcode)}`)

// Look up a price row by EAN barcode.
// Returns { ean_barcode, item_group, item_subgrp_id, product_type, sale_rate } or null.
export const lookupPrice = (ean) =>
  request(`/prices/lookup?ean=${encodeURIComponent(ean)}`)

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

// Returns { records, total, limit, offset, has_more } -- backend caps each
// page at 1000 rows. Pass { limit, offset } to paginate; defaults are 200/0.
export const getTaskRecords = ({ storeId, taskType, status, limit, offset, filters = {} } = {}) => {
  const q = new URLSearchParams()
  if (storeId)        q.set('storeId',   storeId)
  if (taskType)       q.set('task_type', taskType)
  if (status)         q.set('status',    status)
  if (limit  != null) q.set('limit',     String(limit))
  if (offset != null) q.set('offset',    String(offset))
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

// Store users: clear multiple pending records for Task J / Task K in one go.
export const bulkClearTaskRecords = (ids) =>
  request('/task-records/bulk-clear', { method: 'POST', body: { ids } })

// ── Admin (back office) ─────────────────────────────────────────────────────

export const adminListStores    = () => request('/admin/stores')
export const adminCreateStore   = (store) => request('/admin/stores', { method: 'POST', body: store })
export const adminUpdateStore   = (id, updates) => request(`/admin/stores/${id}`, { method: 'PATCH', body: updates })
// adminResetStorePin removed in Phase 9J — stores no longer have a PIN.

export const adminListSuppliers  = () => request('/admin/suppliers')
export const adminCreateSupplier = (supplier) => request('/admin/suppliers', { method: 'POST', body: supplier })
export const adminUpdateSupplier = (id, updates) => request(`/admin/suppliers/${id}`, { method: 'PATCH', body: updates })
export const adminDeleteSupplier = (id) => request(`/admin/suppliers/${id}`, { method: 'DELETE' })
export const adminBulkSuppliers  = (rows) => request('/admin/suppliers/bulk', { method: 'POST', body: rows })

export const adminListLookups   = (kind) => request('/admin/lookup-options' + (kind ? `?kind=${kind}` : ''))
export const adminCreateLookup  = (opt) => request('/admin/lookup-options', { method: 'POST', body: opt })
export const adminUpdateLookup  = (id, updates) => request(`/admin/lookup-options/${id}`, { method: 'PATCH', body: updates })
export const adminDeleteLookup  = (id) => request(`/admin/lookup-options/${id}`, { method: 'DELETE' })

// Products admin page now lists the imported Alternate Barcode table.
export const adminListPrices = ({ limit, q } = {}) => {
  const p = new URLSearchParams()
  if (limit) p.set('limit', limit)
  if (q)     p.set('q', q)
  return request('/admin/prices' + (p.toString() ? `?${p}` : ''))
}
export const adminPricesCount = () => request('/admin/prices/count')

export const adminListAltBarcodes = ({ limit, q } = {}) => {
  const p = new URLSearchParams()
  if (limit) p.set('limit', limit)
  if (q)     p.set('q', q)
  return request('/admin/alt-barcodes' + (p.toString() ? `?${p}` : ''))
}
export const adminAltBarcodesCount = () => request('/admin/alt-barcodes/count')

export const adminGetSettings    = () => request('/admin/settings')
export const adminUpdateSettings = (updates) => request('/admin/settings', { method: 'PATCH', body: updates })
export const adminCleanupPhotos       = () => request('/admin/cleanup/photos',       { method: 'POST' })
export const adminCleanupTaskRecords  = () => request('/admin/cleanup/task-records', { method: 'POST' })
export const adminGetCapacity         = () => request('/admin/capacity')
export const adminListSyncRuns         = () => request('/admin/sync-runs')
export const adminImportAltBarcodes    = (rows) => request('/alt-barcodes/import', { method: 'POST', body: rows })
export const adminImportPrices         = (rows) => request('/prices/import',        { method: 'POST', body: rows })

// Server-side Excel upload — browser sends raw .xlsx, server parses with SheetJS
// Upload via local Python server (http://localhost:8765).
// Python parses with pandas/openpyxl — the only approach that handles
// large VRS Excel files. Modern browsers allow HTTPS→localhost HTTP calls.
export async function adminUploadExcel(endpoint, file, sheet) {
  const s = encodeURIComponent(sheet || '1')
  // Map Cloudflare endpoint path → local server path
  const localPath = endpoint.replace('/upload-excel', '')
    .replace('/prices', '/upload-prices')
    .replace('/alt-barcodes', '/upload-alt-barcodes')
  let res
  try {
    res = await fetch(`http://localhost:8765${localPath}?sheet=${s}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body:    file
    })
  } catch {
    throw new Error(
      'Local upload server is not running. ' +
      'Start it with: C:\\Scraping\\homesavers-scanner\\scripts\\run_sync.bat server'
    )
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`)
  return data
}

// Append-only audit ledger for one task_records row.
export const getTaskRecordEvents      = (id) => request(`/task-records/${id}/events`)

// ── Per-record message threads ──────────────────────────────────────────────
export const getRecordMessages      = (id) => request(`/task-records/${id}/messages`)
export const postRecordMessage      = (id, body) => request(`/task-records/${id}/messages`, { method: 'POST', body: { body } })
export const getUnreadMessageCount  = () => request('/task-messages/unread-count')
export const markRecordMessagesRead = (id) => request(`/task-records/${id}/messages/mark-read`, { method: 'POST' })

// ── Space Plan ──────────────────────────────────────────────────────────────
export const getSpacePlanGrid   = (storeId) => request('/space-plan/grid' + (storeId ? `?storeId=${storeId}` : ''))
export const saveSpacePlanCounts = (storeId, cells) => request('/space-plan/counts', { method: 'POST', body: { store_id: storeId, cells } })
export const getSpacePlanReport = (storeId) => request('/space-plan/report' + (storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''))
// Admin
export const adminListSpaceEquipment   = () => request('/admin/space-plan/equipment')
export const adminUpdateSpaceEquipment = (id, updates) => request(`/admin/space-plan/equipment/${id}`, { method: 'PATCH', body: updates })
export const adminGetSpacePlanned      = (storeId) => request(`/admin/space-plan/planned?storeId=${storeId}`)
export const adminSetSpacePlanned      = (store_id, equipment_id, planned_count) => request('/admin/space-plan/planned', { method: 'PATCH', body: { store_id, equipment_id, planned_count } })

// Manager mobile dashboard rollup (today + 7-day heatmap, scope-aware).
export const getManagerOverview       = () => request('/manager/overview')

// Admin activity report — paginated task_record_events with optional date
// + user filters. Returns { events, total, limit, offset, has_more }.
export const adminListActivity = (params = {}) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v))
  return request('/admin/activity' + (q.toString() ? `?${q}` : ''))
}

// ── Product Query board ───────────────────────────────────────────────
export const listProductQuestions   = ()        => request('/product-questions')
export const getProductQuestion     = (id)      => request(`/product-questions/${id}`)
export const createProductQuestion  = (body)    => request('/product-questions',           { method: 'POST',  body })
export const answerProductQuestion  = (id, b)   => request(`/product-questions/${id}/answers`, { method: 'POST',  body: b })
export const closeProductQuestion   = (id)      => request(`/product-questions/${id}`,     { method: 'PATCH', body: { status: 'closed' } })

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
