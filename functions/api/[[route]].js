/**
 * Cloudflare Pages Functions — catch-all handler for /api/*
 *
 * Env vars:
 *   SUPABASE_URL       wrangler.toml [vars]
 *   SUPABASE_ANON_KEY  Cloudflare Secret
 *   SESSION_SECRET     Cloudflare Secret
 */

// ── Supabase REST helper ────────────────────────────────────────────────────

function sb(env) {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_ANON_KEY
  const headers = {
    'apikey':        key,
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  }

  const buildQuery = (params) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params || {})) {
      if (Array.isArray(v)) v.forEach(item => q.append(k, item))
      else q.append(k, v)
    }
    return q
  }

  return {
    async select(table, params = {}) {
      const res = await fetch(`${url}/rest/v1/${table}?${buildQuery(params)}`, { headers })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    // Like select, but also returns the total row count via PostgREST's
    // Content-Range header. Used by paginated endpoints to fill the UI's
    // "Showing N of M" indicator without a second query.
    async selectPage(table, params = {}) {
      const res = await fetch(`${url}/rest/v1/${table}?${buildQuery(params)}`, {
        headers: { ...headers, Prefer: 'count=exact' }
      })
      if (!res.ok) throw new Error(await res.text())
      const rows  = await res.json()
      const range = res.headers.get('content-range') || ''
      // Format: "0-99/1234" or "*/0"
      const totalStr = range.split('/')[1]
      const total    = totalStr && totalStr !== '*' ? Number(totalStr) : rows.length
      return { rows, total }
    },
    async insert(table, body) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST', headers, body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    async update(table, filterParams, body) {
      const res = await fetch(`${url}/rest/v1/${table}?${buildQuery(filterParams)}`, {
        method: 'PATCH', headers, body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    async remove(table, filterParams) {
      const res = await fetch(`${url}/rest/v1/${table}?${buildQuery(filterParams)}`, {
        method: 'DELETE', headers
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    async rpc(fn, body) {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers, body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    }
  }
}

async function verifyPin(db, hash, pin) {
  const [row] = await db.rpc('verify_pin', { hash, pin })
  return row?.result === true
}

// ── Session tokens ──────────────────────────────────────────────────────────

const STORE_TOKEN_HOURS      = 24
const BACKOFFICE_TOKEN_HOURS = 12

const b64urlEncode = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

const b64urlDecode = (str) => {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : ''
  return Uint8Array.from(atob((str + pad).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function signToken(payload, secret) {
  const enc  = new TextEncoder()
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)))
  const sig  = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body))
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`
}

async function verifyTokenSig(token, secret) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret),
      b64urlDecode(parts[1]), new TextEncoder().encode(parts[0]))
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch { return null }
}

async function authenticate(request, env) {
  const auth  = request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  return verifyTokenSig(token, env.SESSION_SECRET)
}

// ── Role helpers ───────────────────────────────────────────────────────────
// Role keys: sales_assistant · supervisor · assistant_store_manager ·
// store_manager · area_manager · support_admin · buying_manager ·
// buying_head · admin.
const STORE_ROLES    = ['sales_assistant', 'supervisor', 'assistant_store_manager', 'store_manager']
const BO_ROLES       = ['area_manager', 'support_admin', 'buying_manager', 'buying_head', 'admin']
const ADMIN_ROLES    = ['admin', 'buying_manager']
// Manager dashboard — anyone above shop-floor level. Same set as BO_ROLES
// plus store_manager + assistant_store_manager so an in-store manager can
// see their own store's rollup on their phone.
const MANAGER_ROLES  = ['store_manager', 'assistant_store_manager', ...BO_ROLES]
const TASK_CREATORS  = ['buying_manager', 'area_manager', 'buying_head', 'admin']

// Single role per user. The legacy `roles text[]` column on users is
// no longer read or written; it stays in the schema until a cleanup
// migration.
function hasRole(s, allowed) {
  return !!s && !!s.role && allowed.includes(s.role)
}

function isBackOffice(s)   { return hasRole(s, BO_ROLES) }
function isAdminRole(s)    { return hasRole(s, ADMIN_ROLES) }
function isManagerRole(s)  { return hasRole(s, MANAGER_ROLES) }
// Strict "admin" role only — used for top-of-stack stats like the capacity
// meters that buying_manager (also in ADMIN_ROLES) shouldn't see.
function isOnlyAdmin(s)    { return !!s && s.role === 'admin' }
function canCreateTasks(s) { return hasRole(s, TASK_CREATORS) }

function buildSessionForUser(_db, user) {
  return {
    user_id:                user.id,
    username:               user.username,
    display_name:           user.display_name,
    role:                   user.role,
    all_stores:             !!user.all_stores,
    store_ids:              Array.isArray(user.store_ids) ? user.store_ids : [],
    area_ids:               Array.isArray(user.area_ids)  ? user.area_ids  : [],
    can_access_hq_tasks:    user.can_access_hq_tasks    !== false,
    can_access_store_tasks: user.can_access_store_tasks !== false,
    // Legacy fields kept so any code still reading them keeps working.
    storeId: Array.isArray(user.store_ids) && user.store_ids.length === 1 ? user.store_ids[0] : null,
    mode:    STORE_ROLES.includes(user.role) ? 'store' : 'backoffice'
  }
}

// Resolve the session's store scope to a concrete set of store IDs.
// Returns null = no filter (admin / all_stores user).
// Returns [] = no stores at all (user shouldn't see anything).
async function scopedStoreIds(db, session) {
  if (!session) return []
  if (session.all_stores) return null
  const set = new Set(Array.isArray(session.store_ids) ? session.store_ids : [])
  if (Array.isArray(session.area_ids) && session.area_ids.length) {
    const stores = await db.select('stores', {
      select: 'id', area_id: `in.(${session.area_ids.join(',')})`, is_active: 'eq.true'
    })
    for (const s of stores) set.add(s.id)
  }
  return [...set]
}

function userCanAccessHQTasks(s)    { return !!s && s.can_access_hq_tasks    !== false }
function userCanAccessStoreTasks(s) { return !!s && s.can_access_store_tasks !== false }

// Append-only audit log writer. Records every transition of
// task_records.status (creation -> pending, HO completion, store
// clearing, bulk reviews). Best-effort -- a write failure does not
// abort the main operation; we just log to the Worker console.
async function writeTaskEvent(db, { record_id, from_status, to_status, session, note }) {
  try {
    await db.insert('task_record_events', {
      record_id,
      from_status:  from_status || null,
      to_status,
      by_user_id:   session?.user_id || null,
      by_user_name: session?.display_name || session?.username || 'unknown',
      note:         note || null
    })
  } catch (e) {
    console.warn('[audit] task_record_events write failed:', e?.message || e)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const err = (msg, status = 400) => json({ error: msg }, status)

// ── Store task period helpers (Phase 9E) ─────────────────────────────────
// period_key formats: '2026-05-17' daily · '2026-W21' weekly ·
// '2026-05' monthly · '2026' yearly · 'once_<template_id>' once-off.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
function periodKeyFor(template, date) {
  const iso = date.toISOString().slice(0, 10)
  switch (template.frequency) {
    case 'daily':    return iso
    case 'weekly':   return isoWeek(date)
    case 'monthly':  return iso.slice(0, 7)
    case 'yearly':   return iso.slice(0, 4)
    case 'once_off': return `once_${template.id}`
    default:         return iso
  }
}
function templateAppliesToStore(template, store) {
  switch (template.applies_to) {
    case 'all':    return true
    case 'area':   return Array.isArray(template.area_ids)  && template.area_ids.includes(store.area_id)
    case 'stores':
    case 'one':    return Array.isArray(template.store_ids) && template.store_ids.includes(store.id)
    default:       return false
  }
}

// Active in time? start_at/end_at form an optional window; null means open.
function templateActiveOnDate(template, date) {
  if (template.start_at && new Date(template.start_at) > date) return false
  if (template.end_at   && new Date(template.end_at)   < date) return false
  return true
}

// Does this template target the current logged-in user? Three rules:
//   - assigned_to_user_ids contains my user_id (explicit pick), OR
//   - assigned_to_roles array contains my role, OR
//   - legacy assigned_to_role matches my role or is 'all'.
function templateTargetsUser(template, session) {
  if (!session) return false
  if (Array.isArray(template.assigned_to_user_ids) && session.user_id && template.assigned_to_user_ids.includes(session.user_id)) return true
  if (Array.isArray(template.assigned_to_roles) && template.assigned_to_roles.length && template.assigned_to_roles.includes(session.role)) return true
  const role = template.assigned_to_role || 'all'
  return role === 'all' || role === session.role
}

// Lazy generator — called by /store-tasks/today. Reads active templates,
// figures out which ones apply to this store for the given date's period
// keys, and inserts any missing instances. Idempotent thanks to the
// UNIQUE (template_id, store_id, period_key) constraint.
async function ensureInstancesExist(db, env, storeId, date) {
  const [store] = await db.select('stores', { select: 'id,area_id', id: `eq.${storeId}`, limit: '1' })
  if (!store) return 0

  const templates = await db.select('store_task_templates', {
    select: 'id,frequency,applies_to,area_ids,store_ids,is_active,start_at,end_at',
    is_active: 'eq.true'
  })
  const dueIso = date.toISOString().slice(0, 10)
  const toInsert = []
  for (const t of templates) {
    if (!templateAppliesToStore(t, store)) continue
    if (!templateActiveOnDate(t, date))    continue
    toInsert.push({
      template_id: t.id,
      store_id:    store.id,
      period_key:  periodKeyFor(t, date),
      due_date:    dueIso,
      status:      'pending'
    })
  }
  if (!toInsert.length) return 0

  // Upsert ignoring conflicts on (template_id, store_id, period_key).
  const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/store_task_instances?on_conflict=template_id,store_id,period_key`, {
    method: 'POST',
    headers: {
      'apikey':        env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation,resolution=ignore-duplicates'
    },
    body: JSON.stringify(toInsert)
  })
  if (!upsertRes.ok) return 0
  const written = await upsertRes.json()
  return Array.isArray(written) ? written.length : 0
}

// CSV builder with custom column list. Each row is a flat object.
function toCSV(rows, cols) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n'
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context
  const url    = new URL(request.url)
  const path   = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/'
  const method = request.method

  if (!env.SESSION_SECRET) return err('SESSION_SECRET not configured', 500)
  const db = sb(env)

  try {

    // ── Public ────────────────────────────────────────────────────────────
    if (path === '/stores' && method === 'GET') {
      const rows = await db.select('stores', { select: 'id,store_code,store_name,region,area_id,is_active', order: 'store_name.asc' })
      return json(rows)
    }

    // Service-account read of the sync settings — lets the PowerShell job
    // pick up folder / file pattern / sheet edits made in Admin → Settings
    // without redeploying or editing the script.
    if (path === '/products/sync-config' && method === 'GET') {
      if (!env.PRODUCT_SYNC_SECRET) return err('PRODUCT_SYNC_SECRET not configured', 500)
      if ((request.headers.get('X-Sync-Secret') || '') !== env.PRODUCT_SYNC_SECRET) return err('Forbidden', 403)
      const wanted = ['product_sync_folder', 'product_sync_file_pattern', 'product_sync_sheet']
      const rows = await db.select('app_settings', {
        select: 'key,value',
        key:    `in.(${wanted.join(',')})`
      })
      const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]))
      return json({
        folder:       cfg.product_sync_folder       || '',
        file_pattern: cfg.product_sync_file_pattern || '*.xlsx',
        sheet:        cfg.product_sync_sheet        || '1'
      })
    }

    // Service-account bulk product sync — used by the scheduled
    // PowerShell job to push the daily product master Excel.
    // Auth: shared secret in the X-Sync-Secret header (set as a Cloudflare
    // Pages env var named PRODUCT_SYNC_SECRET). No JWT needed.
    if (path === '/products/sync' && method === 'POST') {
      if (!env.PRODUCT_SYNC_SECRET) return err('PRODUCT_SYNC_SECRET not configured', 500)
      const provided = request.headers.get('X-Sync-Secret') || ''
      if (provided !== env.PRODUCT_SYNC_SECRET) return err('Forbidden', 403)
      const rows = await request.json()
      if (!Array.isArray(rows) || !rows.length) return err('Empty payload', 400)

      const now = new Date().toISOString()
      const allSuppliers = await db.select('suppliers', { select: 'id,supplier_code,supplier_name,is_active' })
      const supplierByName = new Map(
        allSuppliers.filter(s => s.is_active && s.supplier_name).map(s => [s.supplier_name.trim().toLowerCase(), s.id])
      )
      const supplierByCode = new Map(
        allSuppliers.filter(s => s.is_active && s.supplier_code).map(s => [s.supplier_code.trim().toLowerCase(), s.id])
      )

      // Filtering rule (user request): a product row is only synced when its
      // supplier_code matches an active supplier in the suppliers table.
      // Anything else is dropped, which trims the 100k-row source file down
      // to the products we actually care about.
      const byId = new Map()
      let duplicates = 0
      let skippedNoSupplier = 0
      let skippedNoId = 0
      for (const r of rows) {
        if (!r?.product_id || !String(r.product_id).trim()) { skippedNoId++; continue }
        let supplier_id = r.supplier_id && /^[a-f0-9-]{36}$/.test(r.supplier_id) ? r.supplier_id : null
        if (!supplier_id && r.supplier_code) {
          const key = String(r.supplier_code).trim().toLowerCase()
          supplier_id = supplierByCode.get(key) || null
        }
        if (!supplier_id && r.supplier_name) {
          const key = String(r.supplier_name).trim().toLowerCase()
          supplier_id = supplierByName.get(key) || null
        }
        if (!supplier_id) { skippedNoSupplier++; continue }
        const row = {
          product_id:  String(r.product_id).trim(),
          description: r.description ? String(r.description).trim() : null,
          uom:         r.uom         ? String(r.uom).trim()         : null,
          category:    r.category    ? String(r.category).trim()    : null,
          supplier_id,
          is_active:   true,
          updated_at:  now
        }
        if (byId.has(row.product_id)) duplicates++
        byId.set(row.product_id, row)
      }
      const clean = Array.from(byId.values())
      if (!clean.length) return err(`No rows matched an active supplier. (received=${rows.length}, no_supplier_match=${skippedNoSupplier}, no_product_id=${skippedNoId})`, 400)

      // Server-side chunking — keeps each PostgREST round-trip small enough
      // that even an enormous file doesn't blow past the Workers payload or
      // CPU budget. 500 rows per chunk mirrors the manual UI's chunk size.
      const CHUNK = 500
      let written = 0
      for (let i = 0; i < clean.length; i += CHUNK) {
        const slice = clean.slice(i, i + CHUNK)
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/products?on_conflict=product_id`, {
          method: 'POST',
          headers: {
            'apikey':        env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=representation,resolution=merge-duplicates'
          },
          body: JSON.stringify(slice)
        })
        if (!res.ok) {
          const txt = await res.text()
          return err(`Chunk ${i / CHUNK + 1} failed at row ${i + 1}: ${txt.slice(0, 400)} (so far written: ${written})`, 502)
        }
        const w = await res.json()
        written += Array.isArray(w) ? w.length : 0
      }
      return json({
        ok: true,
        written,
        duplicates_collapsed: duplicates,
        received:             rows.length,
        skipped_no_supplier:  skippedNoSupplier,
        skipped_no_id:        skippedNoId,
        synced_at:            now
      })
    }

    // Single login flow — username + PIN. The legacy /stores/verify-pin
    // and /backoffice/verify-pin endpoints were removed in Phase 9J.
    if (path === '/users/verify-pin' && method === 'POST') {
      const { username, pin } = await request.json()
      if (!username || !pin) return err('username and pin required', 400)
      const [user] = await db.select('users', {
        select: 'id,username,display_name,role,store_id,store_ids,area_ids,all_stores,can_access_hq_tasks,can_access_store_tasks,pin_hash,is_active',
        username: `eq.${String(username).trim()}`,
        is_active: 'eq.true'
      })
      if (!user) return err('Unknown user', 401)
      if (!await verifyPin(db, user.pin_hash, String(pin))) return err('Incorrect PIN', 401)
      const session = buildSessionForUser(db, user)
      const hours = STORE_ROLES.includes(user.role) ? STORE_TOKEN_HOURS : BACKOFFICE_TOKEN_HOURS
      const token = await signToken({ ...session, exp: Date.now() + hours * 3600_000 }, env.SESSION_SECRET)
      return json({
        ok: true, token,
        user: {
          id: user.id, display_name: user.display_name, role: user.role,
          all_stores: !!user.all_stores,
          store_ids: user.store_ids || [],
          area_ids: user.area_ids || [],
          can_access_hq_tasks: user.can_access_hq_tasks !== false,
          can_access_store_tasks: user.can_access_store_tasks !== false
        }
      })
    }

    // ── Authenticated ─────────────────────────────────────────────────────
    const session = await authenticate(request, env)
    if (!session) return err('Unauthorized', 401)
    const isBO = isBackOffice(session)

    // ── Back-office admin: stores ─────────────────────────────────────────
    // All /admin/* endpoints require back-office mode.

    if (path === '/admin/stores' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('stores', {
        select: 'id,store_code,store_name,region,area_id,is_active,created_at',
        order:  'store_code.asc'
      })
      return json(rows)
    }

    if (path === '/admin/stores' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const { store_code, store_name, region, area_id, is_active } = await request.json()
      if (!store_code || !store_name) return err('store_code and store_name are required', 400)

      const inserted = await db.insert('stores', {
        store_code, store_name,
        region:    region || null,
        area_id:   area_id || null,
        is_active: is_active !== false
      })
      const s = inserted[0] ?? inserted
      return json({ id: s.id, store_code: s.store_code, store_name: s.store_name, region: s.region, area_id: s.area_id, is_active: s.is_active, created_at: s.created_at }, 201)
    }

    const adminStoreMatch = path.match(/^\/admin\/stores\/([a-f0-9-]+)$/)
    if (adminStoreMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id = adminStoreMatch[1]
      const body = await request.json()
      // Whitelist editable fields (never let the client overwrite pin_hash directly here).
      const updates = {}
      if (body.store_code !== undefined) updates.store_code = body.store_code
      if (body.store_name !== undefined) updates.store_name = body.store_name
      if (body.region     !== undefined) updates.region     = body.region
      if (body.area_id    !== undefined) updates.area_id    = body.area_id || null
      if (body.is_active  !== undefined) updates.is_active  = !!body.is_active
      if (!Object.keys(updates).length) return err('No editable fields supplied', 400)
      const updated = await db.update('stores', { id: `eq.${id}` }, updates)
      if (!updated.length) return err('Store not found', 404)
      const s = updated[0]
      return json({ id: s.id, store_code: s.store_code, store_name: s.store_name, region: s.region, is_active: s.is_active })
    }

    // ── Back-office admin: suppliers ─────────────────────────────────────

    if (path === '/admin/suppliers' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('suppliers', {
        select: 'id,supplier_code,supplier_name,is_active,created_at,updated_at',
        order:  'supplier_name.asc'
      })
      return json(rows)
    }

    if (path === '/admin/suppliers' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const { supplier_code, supplier_name, is_active } = await request.json()
      if (!supplier_name) return err('supplier_name required', 400)
      const inserted = await db.insert('suppliers', {
        supplier_code: supplier_code || null,
        supplier_name,
        is_active:     is_active !== false
      })
      return json(inserted[0] ?? inserted, 201)
    }

    // Bulk insert from a client-parsed CSV: body is an array of rows.
    // Each row: { supplier_code?, supplier_name }
    // Duplicates by supplier_code are upserted; supplier_name-only rows are
    // inserted as new (no dedupe — that's the admin's job for now).
    if (path === '/admin/suppliers/bulk' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await request.json()
      if (!Array.isArray(rows) || !rows.length) return err('Empty payload', 400)
      const clean = rows
        .filter(r => r && typeof r.supplier_name === 'string' && r.supplier_name.trim())
        .map(r => ({
          supplier_code: r.supplier_code?.trim() || null,
          supplier_name: r.supplier_name.trim(),
          is_active: true
        }))
      if (!clean.length) return err('No valid rows', 400)
      const inserted = await db.insert('suppliers', clean)
      return json({ inserted: inserted.length }, 201)
    }

    const adminSupplierMatch = path.match(/^\/admin\/suppliers\/([a-f0-9-]+)$/)
    if (adminSupplierMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id = adminSupplierMatch[1]
      const body = await request.json()
      const updates = {}
      if (body.supplier_code !== undefined) updates.supplier_code = body.supplier_code
      if (body.supplier_name !== undefined) updates.supplier_name = body.supplier_name
      if (body.is_active     !== undefined) updates.is_active     = !!body.is_active
      if (!Object.keys(updates).length) return err('No editable fields supplied', 400)
      updates.updated_at = new Date().toISOString()
      const updated = await db.update('suppliers', { id: `eq.${id}` }, updates)
      if (!updated.length) return err('Supplier not found', 404)
      return json(updated[0])
    }

    // ── Areas (read-only for any logged-in user — used in store forms) ───

    if (path === '/areas' && method === 'GET') {
      const rows = await db.select('areas', {
        select: 'id,area_code,area_name,is_active',
        is_active: 'eq.true',
        order: 'area_name.asc'
      })
      return json(rows)
    }

    // ── Back-office admin: users ─────────────────────────────────────────

    const USER_LIST_SELECT = 'id,username,display_name,role,store_id,store_ids,area_ids,all_stores,can_access_hq_tasks,can_access_store_tasks,email,phone,department,employee_code,start_date,notes,is_active,created_at,updated_at'

    if (path === '/admin/users' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('users', { select: USER_LIST_SELECT, order: 'role.asc,username.asc' })
      return json(rows)
    }

    // Employees view — all real people. Used to be HQ-only; in Phase 9J
    // every employee is managed in one place.
    if (path === '/admin/employees' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('users', {
        select: USER_LIST_SELECT,
        order: 'display_name.asc'
      })
      return json(rows)
    }

    if (path === '/admin/users' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const b = await request.json()
      if (!b.username || !b.display_name || !b.role) return err('username, display_name and role are required', 400)
      if (!b.pin || String(b.pin).length < 4) return err('PIN must be at least 4 characters', 400)
      if (![...STORE_ROLES, ...BO_ROLES].includes(b.role)) return err('Unknown role', 400)

      const [hashRow] = await db.rpc('hash_pin', { pin: String(b.pin) })
      if (!hashRow?.hash) return err('Could not hash PIN', 500)

      const safeStoreIds = Array.isArray(b.store_ids) ? b.store_ids.filter(x => /^[a-f0-9-]{36}$/.test(x)) : []
      const safeAreaIds  = Array.isArray(b.area_ids)  ? b.area_ids.filter(x  => /^[a-f0-9-]{36}$/.test(x))  : []

      const inserted = await db.insert('users', {
        username:               String(b.username).trim(),
        display_name:           String(b.display_name).trim(),
        role:                   b.role,
        // legacy store_id kept synced for backward compat (1st of store_ids)
        store_id:               safeStoreIds[0] || null,
        store_ids:              safeStoreIds,
        area_ids:               safeAreaIds,
        all_stores:             !!b.all_stores,
        can_access_hq_tasks:    b.can_access_hq_tasks    !== false,
        can_access_store_tasks: b.can_access_store_tasks !== false,
        email:                  b.email || null,
        phone:                  b.phone || null,
        department:             b.department || null,
        employee_code:          b.employee_code || null,
        start_date:             b.start_date || null,
        notes:                  b.notes || null,
        pin_hash:               hashRow.hash,
        is_active:              b.is_active !== false
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const adminUserMatch = path.match(/^\/admin\/users\/([a-f0-9-]+)$/)
    if (adminUserMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id = adminUserMatch[1]
      const b  = await request.json()
      const updates = {}

      if (b.username     !== undefined) updates.username     = String(b.username).trim()
      if (b.display_name !== undefined) updates.display_name = String(b.display_name).trim()
      if (b.role         !== undefined) {
        if (![...STORE_ROLES, ...BO_ROLES].includes(b.role)) return err('Unknown role', 400)
        updates.role = b.role
      }
      if (b.email         !== undefined) updates.email         = b.email || null
      if (b.phone         !== undefined) updates.phone         = b.phone || null
      if (b.department    !== undefined) updates.department    = b.department || null
      if (b.employee_code !== undefined) updates.employee_code = b.employee_code || null
      if (b.start_date    !== undefined) updates.start_date    = b.start_date || null
      if (b.notes         !== undefined) updates.notes         = b.notes || null
      if (b.is_active     !== undefined) updates.is_active     = !!b.is_active
      if (b.all_stores             !== undefined) updates.all_stores             = !!b.all_stores
      if (b.can_access_hq_tasks    !== undefined) updates.can_access_hq_tasks    = !!b.can_access_hq_tasks
      if (b.can_access_store_tasks !== undefined) updates.can_access_store_tasks = !!b.can_access_store_tasks
      if (Array.isArray(b.store_ids)) {
        const safe = b.store_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
        updates.store_ids = safe
        // Keep legacy store_id in sync with the first one (or NULL).
        updates.store_id  = safe[0] || null
      }
      if (Array.isArray(b.area_ids)) {
        updates.area_ids = b.area_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
      }

      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString()
        const updated = await db.update('users', { id: `eq.${id}` }, updates)
        if (!updated.length) return err('User not found', 404)
      }
      return json({ ok: true })
    }

    const adminUserPinMatch = path.match(/^\/admin\/users\/([a-f0-9-]+)\/reset-pin$/)
    if (adminUserPinMatch && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id = adminUserPinMatch[1]
      const { pin } = await request.json()
      if (!pin || String(pin).length < 4) return err('PIN must be at least 4 characters', 400)
      const [hashRow] = await db.rpc('hash_pin', { pin: String(pin) })
      const updated = await db.update('users', { id: `eq.${id}` }, { pin_hash: hashRow.hash, updated_at: new Date().toISOString() })
      if (!updated.length) return err('User not found', 404)
      return json({ ok: true })
    }

    // ── Back-office admin: areas ─────────────────────────────────────────

    if (path === '/admin/areas' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('areas', {
        select: 'id,area_code,area_name,is_active,created_at,updated_at',
        order:  'area_name.asc'
      })
      return json(rows)
    }

    if (path === '/admin/areas' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const { area_code, area_name, is_active } = await request.json()
      if (!area_name) return err('area_name is required', 400)
      const inserted = await db.insert('areas', {
        area_code: area_code || null,
        area_name,
        is_active: is_active !== false
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const adminAreaMatch = path.match(/^\/admin\/areas\/([a-f0-9-]+)$/)
    if (adminAreaMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id = adminAreaMatch[1]
      const body = await request.json()
      const updates = {}
      if (body.area_code !== undefined) updates.area_code = body.area_code
      if (body.area_name !== undefined) updates.area_name = body.area_name
      if (body.is_active !== undefined) updates.is_active = !!body.is_active
      if (!Object.keys(updates).length) return err('No editable fields supplied', 400)
      updates.updated_at = new Date().toISOString()
      const updated = await db.update('areas', { id: `eq.${id}` }, updates)
      if (!updated.length) return err('Area not found', 404)
      return json(updated[0])
    }

    // ── Back-office admin: lookup_options (reason codes, DRS sizes) ──────

    if (path === '/admin/lookup-options' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const kind = url.searchParams.get('kind')
      const params = {
        select: 'id,kind,label,task_types,sort_order,is_active,created_at',
        order:  'kind.asc,sort_order.asc,label.asc'
      }
      if (kind) params.kind = `eq.${kind}`
      return json(await db.select('lookup_options', params))
    }

    if (path === '/admin/lookup-options' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const { kind, label, task_types = [], sort_order = 0 } = await request.json()
      if (!kind || !label) return err('kind and label required', 400)
      const inserted = await db.insert('lookup_options', {
        kind, label, task_types, sort_order, is_active: true
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const adminLookupMatch = path.match(/^\/admin\/lookup-options\/([a-f0-9-]+)$/)
    if (adminLookupMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id   = adminLookupMatch[1]
      const body = await request.json()
      const updates = {}
      if (body.label       !== undefined) updates.label       = body.label
      if (body.task_types  !== undefined) updates.task_types  = body.task_types
      if (body.sort_order  !== undefined) updates.sort_order  = Number(body.sort_order) || 0
      if (body.is_active   !== undefined) updates.is_active   = !!body.is_active
      if (!Object.keys(updates).length) return err('No editable fields supplied', 400)
      const updated = await db.update('lookup_options', { id: `eq.${id}` }, updates)
      if (!updated.length) return err('Option not found', 404)
      return json(updated[0])
    }

    if (adminLookupMatch && method === 'DELETE') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      await db.remove('lookup_options', { id: `eq.${adminLookupMatch[1]}` })
      return json({ ok: true })
    }

    // ── Back-office admin: products master ───────────────────────────────

    if (path === '/admin/products' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const limit = url.searchParams.get('limit') || '100'
      const q     = url.searchParams.get('q')
      const params = {
        select: 'id,product_id,description,uom,category,supplier_id,suppliers(supplier_name),is_active,updated_at',
        order:  'updated_at.desc',
        limit
      }
      if (q) params['or'] = `(product_id.ilike.*${q}*,description.ilike.*${q}*)`
      const rows = await db.select('products', params)
      return json(rows.map(r => ({ ...r, supplier_name: r.suppliers?.supplier_name || null, suppliers: undefined })))
    }

    // PATCH /admin/products/:id — used by the inline supplier picker on the
    // products admin page.
    const adminProductMatch = path.match(/^\/admin\/products\/([a-f0-9-]+)$/)
    if (adminProductMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id   = adminProductMatch[1]
      const body = await request.json()
      const updates = {}
      if (body.description !== undefined) updates.description = body.description || null
      if (body.uom         !== undefined) updates.uom         = body.uom         || null
      if (body.category    !== undefined) updates.category    = body.category    || null
      if (body.supplier_id !== undefined) updates.supplier_id = body.supplier_id || null
      if (body.is_active   !== undefined) updates.is_active   = !!body.is_active
      if (!Object.keys(updates).length) return err('No editable fields supplied', 400)
      updates.updated_at = new Date().toISOString()
      const updated = await db.update('products', { id: `eq.${id}` }, updates)
      if (!updated.length) return err('Product not found', 404)
      return json(updated[0])
    }

    if (path === '/admin/products/count' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      // Use a HEAD request with count=exact to get just the total
      const headRes = await fetch(`${env.SUPABASE_URL}/rest/v1/products?select=id`, {
        method: 'HEAD',
        headers: {
          'apikey':         env.SUPABASE_ANON_KEY,
          'Authorization':  `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Prefer':         'count=exact',
          'Range-Unit':     'items',
          'Range':          '0-0'
        }
      })
      const cr = headRes.headers.get('content-range') || ''
      const total = Number(cr.split('/')[1]) || 0
      return json({ count: total })
    }

    // Bulk upsert from a client-parsed CSV (key = product_id).
    // Optional supplier_name column is resolved to supplier_id by name match
    // (case-insensitive) against active suppliers; unknown names are ignored.
    if (path === '/admin/products/bulk' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await request.json()
      if (!Array.isArray(rows) || !rows.length) return err('Empty payload', 400)
      const now = new Date().toISOString()

      // Pre-load suppliers once for the supplier_name → supplier_id map.
      const allSuppliers = await db.select('suppliers', { select: 'id,supplier_name,is_active' })
      const supplierByName = new Map(
        allSuppliers
          .filter(s => s.is_active)
          .map(s => [s.supplier_name.trim().toLowerCase(), s.id])
      )

      const mapped = rows
        .filter(r => r?.product_id && String(r.product_id).trim())
        .map(r => {
          // Either explicit supplier_id, or look up by supplier_name.
          let supplier_id = r.supplier_id && /^[a-f0-9-]{36}$/.test(r.supplier_id) ? r.supplier_id : null
          if (!supplier_id && r.supplier_name) {
            const key = String(r.supplier_name).trim().toLowerCase()
            supplier_id = supplierByName.get(key) || null
          }
          return {
            product_id:  String(r.product_id).trim(),
            description: r.description?.trim() || null,
            uom:         r.uom?.trim() || null,
            category:    r.category?.trim() || null,
            supplier_id,
            is_active:   true,
            updated_at:  now
          }
        })
      // Deduplicate by product_id within this payload — Postgres rejects
      // ON CONFLICT updates that touch the same row twice in one statement.
      // Last occurrence wins so a CSV can list a corrected row after an
      // earlier mistake without crashing the import.
      const byId  = new Map()
      let duplicates = 0
      for (const row of mapped) {
        if (byId.has(row.product_id)) duplicates++
        byId.set(row.product_id, row)
      }
      const clean = Array.from(byId.values())
      if (!clean.length) return err('No valid rows', 400)
      const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/products?on_conflict=product_id`, {
        method: 'POST',
        headers: {
          'apikey':        env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(clean)
      })
      if (!upsertRes.ok) {
        const txt = await upsertRes.text()
        return err(`Import failed: ${txt.slice(0, 400)}`, 400)
      }
      const written = await upsertRes.json()
      return json({ written: written.length, duplicates_collapsed: duplicates })
    }

    // ── Back-office admin: settings ──────────────────────────────────────

    // GET /admin/capacity — DB + storage usage, restricted to the strict
    // 'admin' role only. Limits are pulled from app_settings so they can be
    // edited if the Supabase plan is upgraded.
    if (path === '/admin/capacity' && method === 'GET') {
      if (!isOnlyAdmin(session)) return err('Forbidden', 403)
      // Call the SECURITY DEFINER RPC via PostgREST.
      const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_capacity_stats`, {
        method: 'POST',
        headers: {
          'apikey':         env.SUPABASE_ANON_KEY,
          'Authorization':  `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type':   'application/json'
        },
        body: '{}'
      })
      if (!rpcRes.ok) return err(`Capacity RPC failed: ${await rpcRes.text()}`, 502)
      const stats = await rpcRes.json()
      const settings = await db.select('app_settings', {
        select: 'key,value',
        key: 'in.(capacity_db_limit_bytes,capacity_storage_limit_bytes)'
      })
      const byKey = Object.fromEntries(settings.map(r => [r.key, Number(r.value) || 0]))
      return json({
        db: {
          used_bytes:  Number(stats.db_size_bytes) || 0,
          limit_bytes: byKey.capacity_db_limit_bytes || 524288000
        },
        storage: {
          used_bytes:    Number(stats.storage_bytes) || 0,
          limit_bytes:   byKey.capacity_storage_limit_bytes || 1073741824,
          object_count:  Number(stats.storage_object_count) || 0
        },
        computed_at: stats.computed_at
      })
    }

    if (path === '/admin/settings' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('app_settings', { select: 'key,value,updated_at', order: 'key.asc' })
      // Hide the back-office PIN hash — it's a secret.
      return json(rows.filter(r => r.key !== 'backoffice_pin_hash'))
    }

    if (path === '/admin/settings' && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const updates = await request.json()  // { key: value, ... }
      const now = new Date().toISOString()
      const rows = Object.entries(updates)
        .filter(([k]) => k !== 'backoffice_pin_hash')
        .map(([key, value]) => ({ key, value: String(value), updated_at: now }))
      if (!rows.length) return err('Nothing to update', 400)
      const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
        method: 'POST',
        headers: {
          'apikey':        env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(rows)
      })
      if (!upsertRes.ok) throw new Error(await upsertRes.text())
      return json(await upsertRes.json())
    }

    // POST /admin/cleanup/task-records — delete cleared/store_completed task
    // records older than scan_record_retention_days. The records stay in the
    // DB forever otherwise; this is the hatch the admin pulls when storage
    // pressure is high.
    // GET /admin/activity?from=&to=&user=&limit= — paginated audit ledger
    // view for the Admin Reports page. Returns chronological events with
    // store + record details for context.
    if (path === '/admin/activity' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const p = url.searchParams
      const from   = p.get('from')
      const to     = p.get('to')
      const userId = p.get('user_id')
      const limit  = Math.min(Math.max(1, Number(p.get('limit')) || 200), 1000)
      const offset = Math.max(0, Number(p.get('offset')) || 0)

      const params = {
        select: 'id,record_id,from_status,to_status,by_user_id,by_user_name,at,note',
        order:  'at.desc',
        limit:  String(limit),
        offset: String(offset)
      }
      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString()}`)
      if (to)   range.push(`lte.${new Date(to).toISOString()}`)
      if (range.length) params['at'] = range
      if (userId) params['by_user_id'] = `eq.${userId}`

      const { rows, total } = await db.selectPage('task_record_events', params)
      return json({ events: rows, total, limit, offset, has_more: offset + rows.length < total })
    }

    if (path === '/admin/cleanup/task-records' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const [setting] = await db.select('app_settings', { select: 'value', key: 'eq.scan_record_retention_days' })
      const days = Math.max(1, Number(setting?.value || 90))
      const cutoff = new Date(Date.now() - days * 86400000).toISOString()
      const removed = await db.remove('task_records', {
        status:     `in.(cleared,store_completed)`,
        updated_at: `lt.${cutoff}`
      })
      return json({ deleted: removed.length, days, cutoff })
    }

    // POST /admin/cleanup/photos — delete photos older than photo_retention_days.
    if (path === '/admin/cleanup/photos' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const [setting] = await db.select('app_settings', { select: 'value', key: 'eq.photo_retention_days' })
      const days = Math.max(1, Number(setting?.value || 7))

      const old = await db.rpc('list_old_photos', { days })
      let deleted = 0, failed = 0
      for (const o of old) {
        const dRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/task-photos/${o.name}`, {
          method:  'DELETE',
          headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}` }
        })
        if (dRes.ok || dRes.status === 404) deleted++
        else failed++
      }
      return json({ deleted, failed, days, scanned: old.length })
    }

    // /admin/stores/:id/reset-pin removed in Phase 9J — stores no longer
    // have their own PIN. Manage employee PINs under /admin/employees.

    // ── Store task templates (Phase 9D) ──────────────────────────────────

    if (path === '/admin/task-templates' && method === 'GET') {
      if (!canCreateTasks(session) && !isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('store_task_templates', {
        // Explicit column list -- avoids shipping audit columns or future
        // additions unintentionally, and lets PostgREST plan a narrower scan.
        select: 'id,title,description,instructions,category,frequency,due_window,priority,requires_photo,requires_notes,applies_to,area_ids,store_ids,assigned_to_role,assigned_to_roles,assigned_to_user_ids,blocks,start_at,end_at,is_active,sort_order,created_at,updated_at',
        order: 'sort_order.asc,title.asc',
        limit: '1000'
      })
      return json(rows)
    }

    if (path === '/admin/task-templates' && method === 'POST') {
      if (!canCreateTasks(session)) return err('Forbidden', 403)
      const b = await request.json()
      if (!b.title || !b.title.trim()) return err('Title is required', 400)
      if (!['daily','weekly','monthly','yearly','once_off'].includes(b.frequency || 'daily'))
        return err('Invalid frequency', 400)
      if (!['all','area','stores','one'].includes(b.applies_to || 'all'))
        return err('Invalid applies_to', 400)

      const inserted = await db.insert('store_task_templates', {
        title:                b.title.trim(),
        description:          b.description || null,
        instructions:         b.instructions || null,
        category:             b.category || null,
        frequency:            b.frequency || 'daily',
        due_window:           b.due_window || null,
        requires_photo:       !!b.requires_photo,
        requires_notes:       !!b.requires_notes,
        applies_to:           b.applies_to || 'all',
        area_ids:             Array.isArray(b.area_ids)  ? b.area_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))  : [],
        store_ids:            Array.isArray(b.store_ids) ? b.store_ids.filter(x => /^[a-f0-9-]{36}$/.test(x)) : [],
        assigned_to_role:     b.assigned_to_role || 'all',
        assigned_to_roles:    Array.isArray(b.assigned_to_roles)    ? b.assigned_to_roles    : [],
        assigned_to_user_ids: Array.isArray(b.assigned_to_user_ids) ? b.assigned_to_user_ids.filter(x => /^[a-f0-9-]{36}$/.test(x)) : [],
        start_at:             b.start_at || null,
        end_at:               b.end_at || null,
        blocks:               Array.isArray(b.blocks) ? b.blocks : [],
        priority:             b.priority || null,
        is_active:            b.is_active !== false,
        sort_order:           Number(b.sort_order) || 0,
        created_by:           session.user_id || null
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const adminTemplateMatch = path.match(/^\/admin\/task-templates\/([a-f0-9-]+)$/)
    if (adminTemplateMatch && method === 'PATCH') {
      if (!canCreateTasks(session)) return err('Forbidden', 403)
      const id = adminTemplateMatch[1]
      const b  = await request.json()
      const u  = { updated_at: new Date().toISOString() }
      for (const k of ['title','description','instructions','category','frequency','due_window','applies_to','assigned_to_role','priority','start_at','end_at']) {
        if (b[k] !== undefined) u[k] = b[k]
      }
      if (b.requires_photo !== undefined) u.requires_photo = !!b.requires_photo
      if (b.requires_notes !== undefined) u.requires_notes = !!b.requires_notes
      if (b.is_active      !== undefined) u.is_active      = !!b.is_active
      if (b.sort_order     !== undefined) u.sort_order     = Number(b.sort_order) || 0
      if (Array.isArray(b.area_ids))             u.area_ids             = b.area_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
      if (Array.isArray(b.store_ids))            u.store_ids            = b.store_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
      if (Array.isArray(b.assigned_to_roles))    u.assigned_to_roles    = b.assigned_to_roles
      if (Array.isArray(b.assigned_to_user_ids)) u.assigned_to_user_ids = b.assigned_to_user_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
      if (Array.isArray(b.blocks))               u.blocks               = b.blocks
      const updated = await db.update('store_task_templates', { id: `eq.${id}` }, u)
      if (!updated.length) return err('Template not found', 404)
      return json(updated[0])
    }

    if (adminTemplateMatch && method === 'DELETE') {
      if (!canCreateTasks(session)) return err('Forbidden', 403)
      // Soft delete — keep instance history intact.
      const updated = await db.update('store_task_templates', { id: `eq.${adminTemplateMatch[1]}` }, { is_active: false, updated_at: new Date().toISOString() })
      if (!updated.length) return err('Template not found', 404)
      return json({ ok: true })
    }

    // ── Store task instances (Phase 9E) ──────────────────────────────────

    // Read-only catalogue of templates for the picker (lighter than admin view).
    if (path === '/task-templates' && method === 'GET') {
      const rows = await db.select('store_task_templates', {
        select: 'id,title,frequency,category,applies_to,assigned_to_role,is_active,sort_order',
        is_active: 'eq.true',
        order: 'sort_order.asc,title.asc'
      })
      return json(rows)
    }

    if (path === '/store-tasks/today' && method === 'GET') {
      if (!userCanAccessStoreTasks(session)) return err('Store tasks disabled for this account', 403)
      const today    = new Date()
      const todayIso = today.toISOString().slice(0, 10)
      const explicit = url.searchParams.get('storeId')

      const SELECT = 'id,template_id,store_id,period_key,due_date,status,completed_at,photo_url,notes,answers,' +
        'store_task_templates(title,description,instructions,category,frequency,due_window,requires_photo,requires_notes,assigned_to_role,assigned_to_roles,assigned_to_user_ids,blocks,priority)'

      const scope = await scopedStoreIds(db, session)
      // Single-store path: generate today's instances lazily.
      if (explicit && explicit !== 'all') {
        if (scope !== null && !scope.includes(explicit)) return json([])
        await ensureInstancesExist(db, env, explicit, today)
        const rows = await db.select('store_task_instances', {
          select: SELECT,
          store_id: `eq.${explicit}`,
          due_date: `eq.${todayIso}`,
          order: 'created_at.asc'
        })
        const visible = rows.filter(r => templateTargetsUser(r.store_task_templates || {}, session))
        return json(visible)
      }

      // Multi-store (aggregate) view.
      const params = { select: SELECT, due_date: `eq.${todayIso}`, order: 'created_at.asc', limit: '500' }
      if (scope !== null) {
        if (!scope.length) return json([])
        params['store_id'] = `in.(${scope.join(',')})`
      }
      const rows = await db.select('store_task_instances', params)
      return json(rows)
    }

    // POST /store-tasks/generate — manual trigger (BO / task creators).
    if (path === '/store-tasks/generate' && method === 'POST') {
      if (!canCreateTasks(session)) return err('Forbidden', 403)
      const b   = await request.json().catch(() => ({}))
      const day = b.date ? new Date(b.date) : new Date()
      const targetStoreId = b.storeId

      let stores = []
      if (targetStoreId && targetStoreId !== 'all') {
        stores = [{ id: targetStoreId }]
      } else {
        stores = await db.select('stores', { select: 'id,area_id', is_active: 'eq.true' })
      }
      let created = 0
      for (const s of stores) {
        created += await ensureInstancesExist(db, env, s.id, day)
      }
      return json({ created, day: day.toISOString().slice(0, 10), stores: stores.length })
    }

    // PATCH /store-tasks/:id/complete  body: { photo_url?, notes?, answers? }
    const instCompleteMatch = path.match(/^\/store-tasks\/([a-f0-9-]+)\/complete$/)
    if (instCompleteMatch && method === 'PATCH') {
      const id   = instCompleteMatch[1]
      const body = await request.json().catch(() => ({}))

      if (!userCanAccessStoreTasks(session)) return err('Store tasks disabled for this account', 403)
      const [inst] = await db.select('store_task_instances', {
        select: 'id,store_id,template_id,status,store_task_templates(requires_photo,requires_notes,blocks)',
        id: `eq.${id}`,
        limit: '1'
      })
      if (!inst) return err('Instance not found', 404)
      const scope = await scopedStoreIds(db, session)
      if (scope !== null && !scope.includes(inst.store_id)) return err('Forbidden', 403)

      const t      = inst.store_task_templates || {}
      const blocks = Array.isArray(t.blocks) ? t.blocks : []
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {}

      // Legacy mode (no blocks): enforce the simple requires_photo / notes flags.
      if (!blocks.length) {
        if (t.requires_photo && !body.photo_url) return err('A photo is required for this task.', 400)
        if (t.requires_notes && !(body.notes && String(body.notes).trim())) return err('Notes are required for this task.', 400)
      } else {
        // Block-builder mode: validate required answers per block type.
        for (const b of blocks) {
          if (!b.required) continue
          const v = answers[b.id]
          const empty =
            v === undefined || v === null || v === '' ||
            (Array.isArray(v) && v.length === 0)
          if (empty) return err(`"${b.label || b.type}" is required.`, 400)
        }
      }

      const updated = await db.update('store_task_instances', { id: `eq.${id}` }, {
        status:       'completed',
        photo_url:    body.photo_url || null,
        notes:        body.notes ? String(body.notes).trim() : null,
        answers,
        completed_by: session.user_id || null,
        completed_at: new Date().toISOString()
      })
      if (!updated.length) return err('Instance not found', 404)
      return json(updated[0])
    }

    // GET /reports/store-tasks?from=&to=&storeId=&template_id=
    // CSV of completed/pending store task instances with answers flattened
    // (one column per defined block, plus the raw JSON for safety).
    if (path === '/reports/store-tasks' && method === 'GET') {
      if (!userCanAccessStoreTasks(session)) return err('Store tasks disabled for this account', 403)
      const p          = url.searchParams
      const from       = p.get('from')
      const to         = p.get('to')
      const explicit   = p.get('storeId')
      const templateId = p.get('template_id')
      const scope      = await scopedStoreIds(db, session)

      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString().slice(0,10)}`)
      if (to)   range.push(`lte.${new Date(to).toISOString().slice(0,10)}`)

      const params = {
        select: 'id,template_id,store_id,period_key,due_date,status,completed_at,answers,notes,photo_url,store_task_templates(title,category,blocks)',
        order:  'due_date.asc,created_at.asc',
        limit:  '5000'
      }
      const csvList = (s) => (s || '').split(',').map(x => x.trim()).filter(x => x && x !== 'all')
      const emptyCsv = () => new Response('template,store_name,due_date,status,completed_at\n', {
        headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="store-tasks-empty.csv"' }
      })

      if (range.length) params['due_date'] = range
      const tplWanted = csvList(templateId)
      if (tplWanted.length) {
        params['template_id'] = tplWanted.length === 1 ? `eq.${tplWanted[0]}` : `in.(${tplWanted.join(',')})`
      }
      const storesWanted = csvList(explicit)
      if (storesWanted.length) {
        const allowed = scope === null ? storesWanted : storesWanted.filter(id => scope.includes(id))
        if (!allowed.length) return emptyCsv()
        params['store_id'] = allowed.length === 1 ? `eq.${allowed[0]}` : `in.(${allowed.join(',')})`
      } else if (scope !== null) {
        if (!scope.length) return emptyCsv()
        params['store_id'] = `in.(${scope.join(',')})`
      }

      const [rows, stores, users] = await Promise.all([
        db.select('store_task_instances', params),
        db.select('stores', { select: 'id,store_name' }),
        db.select('users', { select: 'id,display_name' })
      ])
      const storeName = Object.fromEntries(stores.map(s => [s.id, s.store_name]))
      const userName  = Object.fromEntries(users.map(u => [u.id, u.display_name]))

      // Build the union of all block labels across the matching templates
      // so the CSV has stable columns.
      const blockCols = new Set()
      for (const r of rows) {
        const blocks = r.store_task_templates?.blocks
        if (!Array.isArray(blocks)) continue
        for (const b of blocks) if (b?.label) blockCols.add(b.label)
      }
      const blockLabels = [...blockCols]

      const baseCols = ['template','store_name','due_date','period_key','status','completed_at','completed_by','notes','photo_url']
      const cols     = [...baseCols, ...blockLabels, 'answers_json']
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`

      const flat = rows.map(r => {
        const t       = r.store_task_templates || {}
        const blocks  = Array.isArray(t.blocks) ? t.blocks : []
        const ans     = r.answers && typeof r.answers === 'object' ? r.answers : {}
        const labelTo = {}
        for (const b of blocks) {
          if (!b?.label) continue
          const v = ans[b.id]
          labelTo[b.label] = Array.isArray(v) ? v.join('; ') : (v === null || v === undefined ? '' : String(v))
        }
        return {
          template:     t.title || '',
          store_name:   storeName[r.store_id] || '',
          due_date:     r.due_date || '',
          period_key:   r.period_key || '',
          status:       r.status || '',
          completed_at: r.completed_at || '',
          completed_by: r.completed_by ? (userName[r.completed_by] || '') : '',
          notes:        r.notes || '',
          photo_url:    r.photo_url || '',
          answers_json: JSON.stringify(ans),
          ...labelTo
        }
      })

      const header = cols.join(',')
      const lines  = flat.map(r => cols.map(c => esc(r[c])).join(','))
      const csv    = [header, ...lines].join('\n') + '\n'
      const filename = `store-tasks-${(from || 'start').slice(0,10)}-to-${(to || 'now').slice(0,10)}.csv`
      return new Response(csv, {
        headers: {
          'Content-Type':        'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      })
    }

    // GET /reports/store-tasks/json?from=&to=&storeId=&template_id=
    // Same filter shape, returns JSON for on-screen rendering.
    if (path === '/reports/store-tasks/json' && method === 'GET') {
      if (!userCanAccessStoreTasks(session)) return err('Store tasks disabled for this account', 403)
      const p          = url.searchParams
      const from       = p.get('from')
      const to         = p.get('to')
      const explicit   = p.get('storeId')
      const templateId = p.get('template_id')
      const scope      = await scopedStoreIds(db, session)

      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString().slice(0,10)}`)
      if (to)   range.push(`lte.${new Date(to).toISOString().slice(0,10)}`)

      const params = {
        select: 'id,template_id,store_id,period_key,due_date,status,completed_at,completed_by,answers,notes,photo_url,store_task_templates(title,category,blocks)',
        order:  'due_date.desc',
        limit:  '500'
      }
      const csvJson = (s) => (s || '').split(',').map(x => x.trim()).filter(x => x && x !== 'all')

      if (range.length) params['due_date'] = range
      const tplWantedJ = csvJson(templateId)
      if (tplWantedJ.length) {
        params['template_id'] = tplWantedJ.length === 1 ? `eq.${tplWantedJ[0]}` : `in.(${tplWantedJ.join(',')})`
      }
      const storesWantedJ = csvJson(explicit)
      if (storesWantedJ.length) {
        const allowed = scope === null ? storesWantedJ : storesWantedJ.filter(id => scope.includes(id))
        if (!allowed.length) return json([])
        params['store_id'] = allowed.length === 1 ? `eq.${allowed[0]}` : `in.(${allowed.join(',')})`
      } else if (scope !== null) {
        if (!scope.length) return json([])
        params['store_id'] = `in.(${scope.join(',')})`
      }
      const rows = await db.select('store_task_instances', params)
      return json(rows)
    }

    // GET /store-tasks/stats?storeId=&from=&to=
    if (path === '/store-tasks/stats' && method === 'GET') {
      if (!userCanAccessStoreTasks(session)) return err('Store tasks disabled for this account', 403)
      const p = url.searchParams
      const from = p.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const to   = p.get('to')   || new Date().toISOString().slice(0, 10)
      const explicit = p.get('storeId')
      const scope = await scopedStoreIds(db, session)

      const params = {
        select: 'store_id,status',
        and: `(due_date.gte.${from},due_date.lte.${to})`,
        limit: '5000'
      }
      if (explicit && explicit !== 'all') {
        if (scope !== null && !scope.includes(explicit)) {
          return json({ per_store: [], overall: { total: 0, completed: 0, pending: 0, missed: 0, completion_pct: 0 } })
        }
        params['store_id'] = `eq.${explicit}`
      } else if (scope !== null) {
        if (!scope.length) return json({ per_store: [], overall: { total: 0, completed: 0, pending: 0, missed: 0, completion_pct: 0 } })
        params['store_id'] = `in.(${scope.join(',')})`
      }

      const rows = await db.select('store_task_instances', params)
      const perStore = {}
      let total = 0, completed = 0, pending = 0, missed = 0
      for (const r of rows) {
        total++
        if (r.status === 'completed') completed++
        else if (r.status === 'missed') missed++
        else pending++
        const k = r.store_id
        if (!perStore[k]) perStore[k] = { store_id: k, total: 0, completed: 0, pending: 0, missed: 0 }
        perStore[k].total++
        perStore[k][r.status] = (perStore[k][r.status] || 0) + 1
      }
      // Join store names
      const stores = await db.select('stores', { select: 'id,store_name' })
      const nameOf = Object.fromEntries(stores.map(s => [s.id, s.store_name]))
      const per_store = Object.values(perStore).map(s => ({
        ...s,
        store_name: nameOf[s.store_id] || '',
        completion_pct: s.total ? Math.round((s.completed * 100) / s.total) : 0
      })).sort((a, b) => b.total - a.total)
      return json({ per_store, overall: { total, completed, pending, missed, completion_pct: total ? Math.round((completed * 100) / total) : 0 } })
    }

    // GET /dashboard/stats?from=&to=&storeId=&storeIds=a,b,c
    if (path === '/dashboard/stats' && method === 'GET') {
      const p = url.searchParams
      const from = p.get('from')
      const to   = p.get('to')
      const explicit = p.get('storeId')
      const multi    = (p.get('storeIds') || '').split(',').map(s => s.trim()).filter(Boolean)
      const scope = await scopedStoreIds(db, session)
      const empty = () => json({ totals: { all: 0, pending: 0, completed: 0, no_change_needed: 0, store_completed: 0 }, by_task_type: [], by_store: [], by_day: [], recent: [] })

      // Resolve which store_ids the SQL should see (null = no scope filter,
      // [] = nothing accessible, [...] = explicit set).
      let storeIds = null
      if (multi.length) {
        storeIds = scope === null ? multi : multi.filter(id => scope.includes(id))
        if (!storeIds.length) return empty()
      } else if (explicit && explicit !== 'all') {
        if (scope !== null && !scope.includes(explicit)) return empty()
        storeIds = [explicit]
      } else if (scope !== null) {
        if (!scope.length) return empty()
        storeIds = scope
      }

      // Push all the heavy aggregation into Postgres -- the RPC returns a
      // single JSON blob with totals, by_task_type, by_store, by_day, recent.
      // Saves a 5000-row Worker fetch on every dashboard load.
      const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/dashboard_stats`, {
        method: 'POST',
        headers: {
          'apikey':        env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          p_from:      from ? new Date(from).toISOString() : null,
          p_to:        to   ? new Date(to).toISOString()   : null,
          p_store_ids: storeIds
        })
      })
      if (!rpcRes.ok) {
        return err(`Dashboard RPC failed: ${await rpcRes.text()}`, 502)
      }
      const stats = await rpcRes.json()

      // RPC's by_day only includes days that had records -- fill the
      // missing days so the chart shows a continuous 14-day window.
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const byDay = Object.fromEntries((stats.by_day || []).map(d => [d.date, d.count]))
      const filled = []
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10)
        filled.push({ date: d, count: byDay[d] || 0 })
      }
      stats.by_day = filled
      // Hide by_store for non-BO -- only HO needs the per-store split.
      if (!isBO) stats.by_store = []
      return json(stats)
    }

    // GET /manager/overview — phone-friendly rollup for store/area managers.
    // Returns:
    //   - totals: chain-wide-but-scoped KPI numbers for today
    //   - per_store: rollup row per store the user can see
    //   - by_day_7: each store's last-7-days completion % for the heatmap
    if (path === '/manager/overview' && method === 'GET') {
      if (!isManagerRole(session)) return err('Forbidden', 403)
      const scope = await scopedStoreIds(db, session)
      if (scope !== null && !scope.length) {
        return json({ totals: { ho_today:0, ho_pending:0, ho_to_clear:0, store_completion_pct:0, photos_today:0 }, per_store: [], by_day_7: [] })
      }

      // Date helpers — today + 7-day window in UTC for the DB filters.
      const todayUTC    = new Date(); todayUTC.setUTCHours(0,0,0,0)
      const sevenAgo    = new Date(todayUTC.getTime() - 6 * 86400000)
      const todayISO    = todayUTC.toISOString()
      const sevenAgoStr = sevenAgo.toISOString().slice(0, 10)
      const todayDate   = todayUTC.toISOString().slice(0, 10)

      const storeFilter = scope === null ? null : scope
      const inFilter    = storeFilter ? `in.(${storeFilter.join(',')})` : null

      // 1) Stores in scope (for names + ordering).
      const storeParams = { select: 'id,store_name,store_code,is_active', order: 'store_name.asc', is_active: 'eq.true' }
      if (inFilter) storeParams['id'] = inFilter
      const stores = await db.select('stores', storeParams)
      if (!stores.length) {
        return json({ totals: { ho_today:0, ho_pending:0, ho_to_clear:0, store_completion_pct:0, photos_today:0 }, per_store: [], by_day_7: [] })
      }
      const allStoreIds = stores.map(s => s.id)
      const storeIdInFilter = `in.(${allStoreIds.join(',')})`

      // 2) HO task_records for the last 7 days, scoped, excluding cleared.
      const trParams = {
        select: 'id,store_id,status,photo_product_url,photo_barcode_url,created_at',
        store_id: storeIdInFilter,
        created_at: `gte.${sevenAgo.toISOString()}`,
        status: 'neq.cleared',
        limit: '5000'
      }
      const taskRecords = await db.select('task_records', trParams)

      // 3) Store-task instances for the last 7 days (for completion %).
      const stiParams = {
        select: 'id,store_id,status,due_date,completed_at,photo_url,answers',
        store_id: storeIdInFilter,
        due_date: `gte.${sevenAgoStr}`,
        limit: '5000'
      }
      const instances = await db.select('store_task_instances', stiParams)

      // ── Aggregate per store ─────────────────────────────────────────────
      const perStore = {}
      for (const s of stores) {
        perStore[s.id] = {
          store_id: s.id,
          store_name: s.store_name,
          store_code: s.store_code,
          ho_today: 0,
          ho_pending: 0,
          ho_to_clear: 0,
          tasks_today_total: 0,
          tasks_today_done: 0,
          completion_pct: 0,
          photos_today: 0
        }
      }

      // HO records
      for (const r of taskRecords) {
        const row = perStore[r.store_id]; if (!row) continue
        const onToday = String(r.created_at).slice(0,10) === todayDate
        if (onToday) row.ho_today += 1
        if (r.status === 'pending')                         row.ho_pending += 1
        if (r.status === 'completed' || r.status === 'no_change_needed') row.ho_to_clear += 1
        if (onToday && (r.photo_product_url || r.photo_barcode_url)) row.photos_today += 1
      }

      // Store-task instances today + 7-day heatmap
      const heatmapBuckets = {} // { store_id: { 'YYYY-MM-DD': { done, total } } }
      for (const i of instances) {
        const sid  = i.store_id
        const date = i.due_date
        if (!heatmapBuckets[sid]) heatmapBuckets[sid] = {}
        if (!heatmapBuckets[sid][date]) heatmapBuckets[sid][date] = { done: 0, total: 0 }
        heatmapBuckets[sid][date].total += 1
        if (i.status === 'completed') heatmapBuckets[sid][date].done += 1
        if (date === todayDate) {
          const row = perStore[sid]; if (!row) continue
          row.tasks_today_total += 1
          if (i.status === 'completed') row.tasks_today_done += 1
          if (i.photo_url) row.photos_today += 1
        }
      }
      for (const row of Object.values(perStore)) {
        row.completion_pct = row.tasks_today_total
          ? Math.round((row.tasks_today_done / row.tasks_today_total) * 100)
          : null
      }

      // ── 7-day heatmap series ──────────────────────────────────────────
      const dayKeys = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayUTC.getTime() - i * 86400000)
        dayKeys.push(d.toISOString().slice(0, 10))
      }
      const by_day_7 = Object.values(perStore).map(row => {
        const days = dayKeys.map(d => {
          const b = heatmapBuckets[row.store_id]?.[d]
          if (!b || !b.total) return { date: d, pct: null }
          return { date: d, pct: Math.round((b.done / b.total) * 100) }
        })
        return { store_id: row.store_id, store_name: row.store_name, days }
      })

      // ── Totals across all of the user's stores ──────────────────────
      const totals = { ho_today: 0, ho_pending: 0, ho_to_clear: 0, photos_today: 0,
                       tasks_today_total: 0, tasks_today_done: 0 }
      for (const r of Object.values(perStore)) {
        totals.ho_today          += r.ho_today
        totals.ho_pending        += r.ho_pending
        totals.ho_to_clear       += r.ho_to_clear
        totals.photos_today      += r.photos_today
        totals.tasks_today_total += r.tasks_today_total
        totals.tasks_today_done  += r.tasks_today_done
      }
      totals.store_completion_pct = totals.tasks_today_total
        ? Math.round((totals.tasks_today_done / totals.tasks_today_total) * 100)
        : null

      return json({
        totals,
        per_store: Object.values(perStore).sort((a,b) =>
          // Worst first: lowest completion %, then most pending HO.
          (a.completion_pct ?? 101) - (b.completion_pct ?? 101) ||
          b.ho_pending - a.ho_pending
        ),
        by_day_7,
        as_of: new Date().toISOString()
      })
    }

    // GET /task-types
    if (path === '/task-types' && method === 'GET') {
      const rows = await db.select('task_types', {
        select: 'code,name,frequency,sort_order,is_active',
        is_active: 'eq.true',
        order: 'sort_order.asc'
      })
      return json(rows)
    }

    // GET /lookup-options?kind=reason_code&task_type=C
    if (path === '/lookup-options' && method === 'GET') {
      const kind     = url.searchParams.get('kind')
      const taskType = url.searchParams.get('task_type')
      if (!kind) return err('kind required', 400)
      const params = { select: 'id,kind,label,task_types,sort_order,is_active', kind: `eq.${kind}`, is_active: 'eq.true', order: 'sort_order.asc' }
      if (taskType) params['task_types'] = `cs.{${taskType}}`  // array contains
      const rows = await db.select('lookup_options', params)
      return json(rows)
    }

    // GET /suppliers
    if (path === '/suppliers' && method === 'GET') {
      const rows = await db.select('suppliers', {
        select: 'id,supplier_code,supplier_name,is_active',
        is_active: 'eq.true',
        order: 'supplier_name.asc'
      })
      return json(rows)
    }

    // ── Photos ────────────────────────────────────────────────────────────
    // POST /photos/upload   multipart/form-data: file, slot, tempId
    if (path === '/photos/upload' && method === 'POST') {
      const form   = await request.formData()
      const file   = form.get('file')
      const slot   = String(form.get('slot') || '')
      const tempId = String(form.get('tempId') || '')

      if (!file || !slot || !tempId) return err('file, slot, tempId required', 400)
      if (!['product', 'barcode', 'store_task'].includes(slot)) return err('Invalid slot', 400)
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(tempId))   return err('Invalid tempId', 400)
      // Hard cap so a giant phone-camera upload can't blow the Worker memory
      // budget. 25 MB is comfortably above a 4K JPEG / a normal PDF receipt.
      const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
      if (file.size && file.size > MAX_UPLOAD_BYTES) {
        return err(`File too large (${Math.round(file.size / 1024 / 1024)} MB) — max is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, 413)
      }

      // Derive an extension. Photos always end up as .jpg (client compresses
      // to JPEG before sending). For store_task uploads we keep whatever the
      // browser told us so PDFs / CSVs / docs stay viewable. Fallback: .bin.
      const extFromMime = (mime) => {
        const m = String(mime || '').toLowerCase()
        if (m.startsWith('image/jpeg') || m.startsWith('image/jpg')) return 'jpg'
        if (m.startsWith('image/png'))  return 'png'
        if (m.startsWith('image/webp')) return 'webp'
        if (m.startsWith('image/'))     return 'jpg'
        if (m === 'application/pdf')    return 'pdf'
        if (m === 'text/csv')           return 'csv'
        if (m === 'text/plain')         return 'txt'
        if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
        if (m === 'application/vnd.ms-excel') return 'xls'
        if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
        if (m === 'application/msword') return 'doc'
        return 'bin'
      }
      const ext = (slot === 'product' || slot === 'barcode')
        ? 'jpg'                                   // these are always compressed images
        : extFromMime(file.type)                  // store_task — keep the actual format

      // store_task photos / files live under their own prefix so retention
      // rules can target each kind separately if needed.
      const objectPath = slot === 'store_task'
        ? `store-tasks/${tempId}.${ext}`
        : `${tempId}/${slot}.${ext}`
      const uploadUrl  = `${env.SUPABASE_URL}/storage/v1/object/task-photos/${objectPath}`

      const upRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey':        env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type':  file.type || 'application/octet-stream',
          'x-upsert':      'true'
        },
        body: await file.arrayBuffer()
      })
      if (!upRes.ok) return err(`Storage upload failed: ${await upRes.text()}`, 500)

      return json({
        url:  `${env.SUPABASE_URL}/storage/v1/object/public/task-photos/${objectPath}`,
        path: objectPath
      })
    }

    // DELETE /photos?path=<objectPath>   — cleanup on cancel / save failure
    if (path === '/photos' && method === 'DELETE') {
      const objectPath = url.searchParams.get('path') || ''
      const isProductPhoto = /^[a-zA-Z0-9-]{8,64}\/(product|barcode)\.(jpg|png|webp)$/.test(objectPath)
      const isStorePhoto   = /^store-tasks\/[a-zA-Z0-9-]{8,64}\.[a-z0-9]{2,5}$/.test(objectPath)
      if (!isProductPhoto && !isStorePhoto) return err('Invalid path', 400)
      const delUrl = `${env.SUPABASE_URL}/storage/v1/object/task-photos/${objectPath}`
      const dRes   = await fetch(delUrl, {
        method:  'DELETE',
        headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}` }
      })
      if (!dRes.ok && dRes.status !== 404) return err(`Storage delete failed: ${await dRes.text()}`, 500)
      return json({ ok: true })
    }

    // GET /products/lookup
    // Joins suppliers so the scan-result UI can show "Supplier: X" subtly.
    if (path === '/products/lookup' && method === 'GET') {
      const code = url.searchParams.get('code')
      if (!code) return json(null)
      const rows = await db.select('products', {
        select: 'product_id,description,uom,supplier_id,suppliers(supplier_name)',
        product_id: `eq.${code}`,
        limit: '1'
      })
      const r = rows[0]
      if (!r) return json(null)
      return json({
        product_id:    r.product_id,
        description:   r.description,
        uom:           r.uom,
        supplier_id:   r.supplier_id,
        supplier_name: r.suppliers?.supplier_name || null
      })
    }

    // ── Task records ──────────────────────────────────────────────────────

    if (path === '/task-records' && method === 'GET') {
      if (!userCanAccessHQTasks(session)) return err('HQ tasks disabled for this account', 403)
      const p = url.searchParams
      const taskType  = p.get('task_type')
      const status    = p.get('status')
      const from      = p.get('from')
      const to        = p.get('to')
      const explicit  = p.get('storeId')

      // Pagination -- caps mean a single request can never blow the Worker
      // budget even at 55-store scale. Default 200 rows / max 1000.
      const MAX_LIMIT     = 1000
      const DEFAULT_LIMIT = 200
      const reqLimit  = Number(p.get('limit'))  || DEFAULT_LIMIT
      const limit     = Math.min(Math.max(1, reqLimit), MAX_LIMIT)
      const offset    = Math.max(0, Number(p.get('offset')) || 0)

      const empty = () => json({ records: [], total: 0, limit, offset, has_more: false })

      const includeCleared = p.get('includeCleared') === '1'
      const scope = await scopedStoreIds(db, session)
      // null = unrestricted; otherwise filter to the scope's stores.
      const params = {
        select: 'id,task_type,store_id,supplier_id,supplier_name_text,suppliers(supplier_name),product_code,product_barcode,product_name_label,description,uom,quantity,notes,photo_product_url,photo_barcode_url,details,status,review_notes,reviewed_at,marked_for_deletion,completed_at,store_completed_at,cleared_at,created_at,updated_at',
        order:  'created_at.desc',
        limit:  String(limit),
        offset: String(offset)
      }
      const csv = (s) => (s || '').split(',').map(x => x.trim()).filter(x => x && x !== 'all')
      const storesWanted = csv(explicit)
      if (storesWanted.length) {
        const allowed = scope === null ? storesWanted : storesWanted.filter(id => scope.includes(id))
        if (!allowed.length) return empty()
        params['store_id'] = allowed.length === 1 ? `eq.${allowed[0]}` : `in.(${allowed.join(',')})`
      } else if (scope !== null) {
        if (!scope.length) return empty()
        params['store_id'] = `in.(${scope.join(',')})`
      }
      const tt = csv(taskType)
      if (tt.length) params['task_type'] = tt.length === 1 ? `eq.${tt[0]}` : `in.(${tt.join(',')})`
      const ss = csv(status)
      if (ss.length)                       params['status'] = ss.length === 1 ? `eq.${ss[0]}` : `in.(${ss.join(',')})`
      else if (!includeCleared)            params['status'] = `neq.cleared`

      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString()}`)
      if (to)   range.push(`lte.${new Date(to).toISOString()}`)
      if (range.length) params['created_at'] = range

      // selectPage returns total via PostgREST count=exact.
      const { rows, total } = await db.selectPage('task_records', params)
      const flat = rows.map(r => ({
        ...r,
        supplier_name: r.suppliers?.supplier_name || r.supplier_name_text || null,
        suppliers:     undefined
      }))
      return json({
        records:  flat,
        total,
        limit,
        offset,
        has_more: offset + flat.length < total
      })
    }

    // Bulk review (back office) — mark many records as completed or
    // no_change_needed, with an optional shared review note.
    if (path === '/task-records/bulk-review' && method === 'POST') {
      if (!isBackOffice(session)) return err('Forbidden', 403)
      const { ids, status, review_notes } = await request.json()
      if (!Array.isArray(ids) || !ids.length)        return err('ids required', 400)
      if (!['completed', 'no_change_needed'].includes(status))
                                                     return err('Invalid status', 400)
      // PostgREST allows only safe-looking UUIDs in filter values.
      const safeIds = ids.filter(i => /^[a-f0-9-]{36}$/.test(i))
      if (!safeIds.length) return err('No valid ids', 400)

      const now     = new Date().toISOString()
      const updates = { status, reviewed_at: now, updated_at: now }
      if (status === 'completed') updates.completed_at = now
      if (review_notes !== undefined) updates.review_notes = review_notes || null

      // Capture pre-update statuses so the audit ledger gets accurate
      // from_status values per record.
      const pre = await db.select('task_records', {
        select: 'id,status',
        id: `in.(${safeIds.join(',')})`
      })
      const preMap = Object.fromEntries(pre.map(r => [r.id, r.status]))

      const updated = await db.update('task_records', { id: `in.(${safeIds.join(',')})` }, updates)

      for (const r of updated) {
        if (preMap[r.id] !== status) {
          await writeTaskEvent(db, {
            record_id:   r.id,
            from_status: preMap[r.id] || null,
            to_status:   status,
            session,
            note:        review_notes || null
          })
        }
      }
      return json({ updated: updated.length })
    }

    // GET /task-records/:id/events -- immutable history for one record.
    const recEventsMatch = path.match(/^\/task-records\/([a-f0-9-]+)\/events$/)
    if (recEventsMatch && method === 'GET') {
      if (!userCanAccessHQTasks(session)) return err('HQ tasks disabled for this account', 403)
      const recId = recEventsMatch[1]
      // Scope: a non-BO user can only read events for records in their own stores.
      const scope = await scopedStoreIds(db, session)
      if (scope !== null) {
        const [own] = await db.select('task_records', {
          select: 'store_id', id: `eq.${recId}`, limit: '1'
        })
        if (!own || !scope.includes(own.store_id)) return err('Record not found or not allowed', 404)
      }
      const rows = await db.select('task_record_events', {
        select: 'id,record_id,from_status,to_status,by_user_id,by_user_name,at,note',
        record_id: `eq.${recId}`,
        order: 'at.asc'
      })
      return json(rows)
    }

    if (path === '/task-records' && method === 'POST') {
      if (!userCanAccessHQTasks(session)) return err('HQ tasks disabled for this account', 403)
      const body = await request.json()
      if (!body.task_type) return err('task_type required', 400)

      const now = new Date().toISOString()

      // Determine which store this record belongs to.
      // - Admin / all_stores users: take body.store_id verbatim (or null).
      // - Single-store users: snap to their one store.
      // - Multi-store users: body.store_id required, must be in scope.
      const scope = await scopedStoreIds(db, session)
      let store_id
      if (scope === null) {
        store_id = body.store_id || null
      } else if (scope.length === 1) {
        store_id = scope[0]
      } else if (scope.length === 0) {
        return err('No stores assigned to this account', 403)
      } else {
        if (!body.store_id) return err('store_id required — pick one of your stores', 400)
        if (!scope.includes(body.store_id)) return err('store_id is not in your scope', 403)
        store_id = body.store_id
      }

      const inserted = await db.insert('task_records', {
        task_type:           body.task_type,
        store_id,
        supplier_id:         body.supplier_id || null,
        supplier_name_text:  body.supplier_name_text || null,
        product_code:        body.product_code || null,
        product_barcode:     body.product_barcode || null,
        product_name_label:  body.product_name_label || null,
        description:         body.description || null,
        uom:                 body.uom || null,
        quantity:            body.quantity ?? null,
        notes:               body.notes || null,
        photo_product_url:   body.photo_product_url || null,
        photo_barcode_url:   body.photo_barcode_url || null,
        details:             body.details || {},
        status:              body.status || 'pending',
        marked_for_deletion: false,
        created_at:          now,
        updated_at:          now
      })
      const created = Array.isArray(inserted) ? inserted[0] : inserted
      if (created?.id) {
        await writeTaskEvent(db, {
          record_id:   created.id,
          from_status: null,
          to_status:   created.status || 'pending',
          session,
          note:        'Created'
        })
      }
      return json(created ?? inserted, 201)
    }

    const recMatch = path.match(/^\/task-records\/([a-f0-9-]+)$/)
    if (recMatch && method === 'PATCH') {
      if (!userCanAccessHQTasks(session)) return err('HQ tasks disabled for this account', 403)
      const id      = recMatch[1]
      const updates = await request.json()
      const filter  = { id: `eq.${id}` }
      const scope = await scopedStoreIds(db, session)
      if (scope !== null) {
        if (!scope.length) return err('Record not found or not allowed', 404)
        filter['store_id'] = `in.(${scope.join(',')})`
      }
      // If the back office is moving the record to a reviewed status,
      // stamp reviewed_at automatically so the UI doesn't have to.
      if (isBO && (updates.status === 'completed' || updates.status === 'no_change_needed') && !updates.reviewed_at) {
        updates.reviewed_at = new Date().toISOString()
      }
      // Store action: marking a HO-completed record as 'cleared' once it's been
      // processed in the POs. Stamp cleared_at server-side; the record stays in
      // the database but is hidden from the default form/report views.
      if (updates.status === 'cleared' && !updates.cleared_at) {
        updates.cleared_at = new Date().toISOString()
      }
      // Capture the pre-update status so we can write a precise from->to
      // audit row only if the status actually changes.
      let preStatus = null
      if (updates.status !== undefined) {
        const [pre] = await db.select('task_records', { select: 'status', id: `eq.${id}`, limit: '1' })
        preStatus = pre?.status || null
      }
      const updated = await db.update('task_records', filter, { ...updates, updated_at: new Date().toISOString() })
      if (!updated.length) return err('Record not found or not allowed', 404)
      if (updates.status !== undefined && updates.status !== preStatus) {
        await writeTaskEvent(db, {
          record_id:   id,
          from_status: preStatus,
          to_status:   updates.status,
          session,
          note:        updates.review_notes || null
        })
      }
      return json(updated[0])
    }

    if (recMatch && method === 'DELETE') {
      if (!userCanAccessHQTasks(session)) return err('HQ tasks disabled for this account', 403)
      const id     = recMatch[1]
      const filter = { id: `eq.${id}` }
      const scope = await scopedStoreIds(db, session)
      if (scope !== null) {
        if (!scope.length) return err('Record not found or not allowed', 404)
        filter['store_id'] = `in.(${scope.join(',')})`
        if (!isBO) filter['status'] = `eq.store_completed`
      }
      const removed = await db.remove('task_records', filter)
      if (!removed.length) return err('Record not found or not allowed', 404)
      return json({ ok: true })
    }

    // ── Reports ───────────────────────────────────────────────────────────
    if (path === '/reports/task-records' && method === 'GET') {
      if (!userCanAccessHQTasks(session)) return err('HQ tasks disabled for this account', 403)
      const p        = url.searchParams
      const from     = p.get('from')
      const to       = p.get('to')
      const explicit = p.get('storeId')
      const taskType = p.get('task_type')
      const scope    = await scopedStoreIds(db, session)

      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString()}`)
      if (to)   range.push(`lte.${new Date(to).toISOString()}`)

      const includeCleared = p.get('includeCleared') === '1'
      const params = {
        select: 'id,task_type,store_id,supplier_id,supplier_name_text,product_code,product_barcode,product_name_label,description,uom,quantity,notes,photo_product_url,photo_barcode_url,details,status,review_notes,created_at',
        order:  'created_at.asc'
      }
      if (range.length) params['created_at'] = range
      const statusCsvList = (p.get('status') || '').split(',').map(s => s.trim()).filter(s => s && s !== 'all')
      if (statusCsvList.length) {
        params['status'] = statusCsvList.length === 1 ? `eq.${statusCsvList[0]}` : `in.(${statusCsvList.join(',')})`
      } else if (!includeCleared) {
        params['status'] = `neq.cleared`
      }
      const emptyCsv = () => new Response('', { headers: { 'Content-Type': 'text/csv;charset=utf-8' } })
      const csv2 = (s) => (s || '').split(',').map(x => x.trim()).filter(x => x && x !== 'all')

      // Scope-aware store filter — comma-separated list supported.
      const storesWanted = csv2(explicit)
      if (storesWanted.length) {
        const allowed = scope === null ? storesWanted : storesWanted.filter(id => scope.includes(id))
        if (!allowed.length) return emptyCsv()
        params['store_id'] = allowed.length === 1 ? `eq.${allowed[0]}` : `in.(${allowed.join(',')})`
      } else if (scope !== null) {
        if (!scope.length) return emptyCsv()
        params['store_id'] = `in.(${scope.join(',')})`
      }
      const ttCsv = csv2(taskType)
      if (ttCsv.length) params['task_type'] = ttCsv.length === 1 ? `eq.${ttCsv[0]}` : `in.(${ttCsv.join(',')})`

      const records   = await db.select('task_records', params)
      const stores    = await db.select('stores',    { select: 'id,store_name' })
      const suppliers = await db.select('suppliers', { select: 'id,supplier_name' })
      const storeName    = Object.fromEntries(stores.map(s    => [s.id, s.store_name]))
      const supplierName = Object.fromEntries(suppliers.map(s => [s.id, s.supplier_name]))

      const flat = records.map(r => ({
        task_type:         r.task_type,
        store_name:        storeName[r.store_id] || '',
        product_code:      r.product_code || '',
        product_barcode:   r.product_barcode || '',
        description:       r.description || r.product_name_label || '',
        uom:               r.uom || '',
        quantity:          r.quantity ?? '',
        supplier:          r.supplier_id ? (supplierName[r.supplier_id] || '') : (r.supplier_name_text || ''),
        notes:             r.notes || '',
        status:            r.status,
        review_notes:      r.review_notes || '',
        photo_product_url: r.photo_product_url || '',
        photo_barcode_url: r.photo_barcode_url || '',
        details:           JSON.stringify(r.details || {}),
        created_at:        r.created_at
      }))

      const cols = ['task_type','store_name','product_code','product_barcode','description','uom','quantity','supplier','notes','status','review_notes','photo_product_url','photo_barcode_url','details','created_at']
      const csv  = toCSV(flat, cols)
      const filename = `task-records-${(from || 'start').slice(0,10)}-to-${(to || 'now').slice(0,10)}.csv`

      return new Response(csv, {
        headers: {
          'Content-Type':        'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      })
    }

    // ── Product Query board ──────────────────────────────────────────────
    // Standalone chain-wide notice board. Any signed-in user can list / post
    // / answer. Closed threads are invisible to every user (asker included).
    // Only the asker can close their own thread; no delete, no moderation.

    if (path === '/product-questions' && method === 'GET') {
      // Always filters to status='open' -- closed threads are invisible.
      const rows = await db.select('product_questions', {
        select: 'id,photo_url,notes,store_id,created_by,created_by_name,status,created_at',
        status: 'eq.open',
        order:  'created_at.desc',
        limit:  '200'
      })
      // Stamp answer counts in one batched query.
      if (rows.length) {
        const ids = rows.map(r => r.id)
        const counts = await db.select('product_question_answers', {
          select:      'question_id',
          question_id: `in.(${ids.join(',')})`
        })
        const byQ = {}
        for (const c of counts) byQ[c.question_id] = (byQ[c.question_id] || 0) + 1
        for (const r of rows) r.answer_count = byQ[r.id] || 0
      }
      return json(rows)
    }

    if (path === '/product-questions' && method === 'POST') {
      const body = await request.json()
      if (!body.photo_url || typeof body.photo_url !== 'string') return err('photo_url required', 400)
      // Asker's store: their single store if scope.length === 1, else nullable.
      const scope = await scopedStoreIds(db, session)
      const store_id = (scope && scope.length === 1) ? scope[0] : (body.store_id || null)
      if (scope !== null && store_id && !scope.includes(store_id)) return err('store_id not in scope', 403)

      const inserted = await db.insert('product_questions', {
        photo_url:       body.photo_url,
        notes:           body.notes ? String(body.notes).trim() : null,
        store_id,
        created_by:      session.user_id || null,
        created_by_name: session.display_name || session.username || 'unknown',
        status:          'open'
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const pqOne = path.match(/^\/product-questions\/([a-f0-9-]+)$/)
    if (pqOne && method === 'GET') {
      const id = pqOne[1]
      const [q] = await db.select('product_questions', {
        select: 'id,photo_url,notes,store_id,created_by,created_by_name,status,created_at,resolved_at',
        id:     `eq.${id}`,
        limit:  '1'
      })
      if (!q || q.status !== 'open') return err('Not found', 404)
      const answers = await db.select('product_question_answers', {
        select:      'id,photo_url,notes,store_id,by_user_id,by_user_name,at',
        question_id: `eq.${id}`,
        order:       'at.asc'
      })
      return json({ ...q, answers })
    }

    if (pqOne && method === 'PATCH') {
      // Only the asker can close their own question (status -> 'closed').
      const id = pqOne[1]
      const body = await request.json()
      if (body.status !== 'closed') return err('Only status=closed is supported', 400)
      const [q] = await db.select('product_questions', {
        select: 'created_by,status', id: `eq.${id}`, limit: '1'
      })
      if (!q) return err('Not found', 404)
      if (q.status === 'closed') return json({ ok: true, already_closed: true })
      if (q.created_by !== session.user_id) return err('Only the asker can close this thread', 403)
      const updated = await db.update('product_questions', { id: `eq.${id}` }, {
        status: 'closed', resolved_at: new Date().toISOString()
      })
      return json(updated[0] || { ok: true })
    }

    const pqAns = path.match(/^\/product-questions\/([a-f0-9-]+)\/answers$/)
    if (pqAns && method === 'POST') {
      const qid = pqAns[1]
      const body = await request.json()
      if (!body.notes || !String(body.notes).trim()) return err('notes required', 400)
      // Reject answers on closed threads (UI hides them anyway).
      const [q] = await db.select('product_questions', { select: 'status', id: `eq.${qid}`, limit: '1' })
      if (!q) return err('Question not found', 404)
      if (q.status !== 'open') return err('This thread is closed', 409)
      const scope = await scopedStoreIds(db, session)
      const store_id = (scope && scope.length === 1) ? scope[0] : (body.store_id || null)
      const inserted = await db.insert('product_question_answers', {
        question_id:  qid,
        photo_url:    body.photo_url || null,
        notes:        String(body.notes).trim(),
        store_id,
        by_user_id:   session.user_id || null,
        by_user_name: session.display_name || session.username || 'unknown'
      })
      return json(inserted[0] ?? inserted, 201)
    }

    return err('Not found', 404)

  } catch (e) {
    console.error(e)
    return err(e.message || 'Internal error', 500)
  }
}
