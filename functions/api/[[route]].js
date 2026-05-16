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

// ── Role helpers (Phase 9B) ────────────────────────────────────────────────
const STORE_ROLES    = ['sales_assistant', 'store_manager']
const BO_ROLES       = ['area_manager', 'support_admin', 'buying_manager', 'commercial_manager', 'director']
const ADMIN_ROLES    = ['director', 'buying_manager']
const TASK_CREATORS  = ['buying_manager', 'area_manager', 'commercial_manager', 'director']

function isBackOffice(s) {
  if (!s) return false
  if (s.role && BO_ROLES.includes(s.role)) return true
  // Backward-compat: pre-9B tokens only had `mode`.
  return s.mode === 'backoffice'
}
function isAdminRole(s)    { return !!s && (ADMIN_ROLES.includes(s.role)   || s.mode === 'backoffice') }
function canCreateTasks(s) { return !!s && TASK_CREATORS.includes(s.role) }

async function buildSessionForUser(db, user) {
  // Pull the user's area memberships (only matters for area_manager).
  let area_ids = []
  if (user.role === 'area_manager') {
    const rows = await db.select('user_areas', { select: 'area_id', user_id: `eq.${user.id}` })
    area_ids = rows.map(r => r.area_id)
  }
  return {
    user_id:      user.id,
    username:     user.username,
    display_name: user.display_name,
    role:         user.role,
    storeId:      user.store_id || null,
    area_ids,
    // legacy `mode` for any code still checking it
    mode:         STORE_ROLES.includes(user.role) ? 'store' : 'backoffice'
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

// Lazy generator — called by /store-tasks/today. Reads active templates,
// figures out which ones apply to this store for the given date's period
// keys, and inserts any missing instances. Idempotent thanks to the
// UNIQUE (template_id, store_id, period_key) constraint.
async function ensureInstancesExist(db, env, storeId, date) {
  const [store] = await db.select('stores', { select: 'id,area_id', id: `eq.${storeId}`, limit: '1' })
  if (!store) return 0

  const templates = await db.select('store_task_templates', {
    select: 'id,frequency,applies_to,area_ids,store_ids,is_active',
    is_active: 'eq.true'
  })
  const dueIso = date.toISOString().slice(0, 10)
  const toInsert = []
  for (const t of templates) {
    if (!templateAppliesToStore(t, store)) continue
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
      const rows = await db.select('stores', { select: 'id,store_code,store_name,region,is_active', order: 'store_name.asc' })
      return json(rows)
    }

    // Store login: pick a store + PIN. Resolves to that store's default
    // user (the seeded sales_assistant). Same UX as before; backed by the
    // users table since Phase 9B.
    if (path === '/stores/verify-pin' && method === 'POST') {
      const { storeId, pin } = await request.json()
      if (!storeId || !pin) return err('storeId and pin required', 400)
      const [store] = await db.select('stores', { select: 'id,store_code,store_name,region,area_id', id: `eq.${storeId}` })
      if (!store) return err('Store not found', 404)

      // Find the default user for this store (sales_assistant, active).
      // If multiple users exist for the store we still pick sales_assistant —
      // managers will log in via the new Staff tab with their own username.
      const users = await db.select('users', {
        select: 'id,username,display_name,role,store_id,pin_hash,is_active',
        store_id: `eq.${storeId}`,
        is_active: 'eq.true',
        order: 'role.asc'
      })
      // Try sales_assistant first, then any other store-attached active user.
      const user = users.find(u => u.role === 'sales_assistant') || users[0]
      if (!user) return err('No active user for this store', 404)
      if (!await verifyPin(db, user.pin_hash, String(pin))) return err('Incorrect PIN', 401)

      const session = await buildSessionForUser(db, user)
      const token = await signToken(
        { ...session, exp: Date.now() + STORE_TOKEN_HOURS * 3600_000 },
        env.SESSION_SECRET
      )
      return json({
        ok: true, token,
        store: { id: store.id, store_code: store.store_code, store_name: store.store_name, region: store.region, area_id: store.area_id },
        user:  { id: user.id, display_name: user.display_name, role: user.role }
      })
    }

    // Legacy back-office PIN flow (preserved for backward compat with any
    // bookmarked clients). Resolves to the director user.
    if (path === '/backoffice/verify-pin' && method === 'POST') {
      const { pin } = await request.json()
      if (!pin) return err('pin required', 400)
      const [user] = await db.select('users', {
        select: 'id,username,display_name,role,store_id,pin_hash,is_active',
        username: 'eq.director', is_active: 'eq.true'
      })
      if (!user) return err('Back office user not configured', 500)
      if (!await verifyPin(db, user.pin_hash, String(pin))) return err('Incorrect PIN', 401)
      const session = await buildSessionForUser(db, user)
      const token = await signToken(
        { ...session, exp: Date.now() + BACKOFFICE_TOKEN_HOURS * 3600_000 },
        env.SESSION_SECRET
      )
      return json({ ok: true, token, user: { id: user.id, display_name: user.display_name, role: user.role } })
    }

    // New: staff login (username + PIN). Used by every non-store role and
    // by any extra named user attached to a store.
    if (path === '/users/verify-pin' && method === 'POST') {
      const { username, pin } = await request.json()
      if (!username || !pin) return err('username and pin required', 400)
      const [user] = await db.select('users', {
        select: 'id,username,display_name,role,store_id,pin_hash,is_active',
        username: `eq.${String(username).trim()}`,
        is_active: 'eq.true'
      })
      if (!user) return err('Unknown user', 401)
      if (!await verifyPin(db, user.pin_hash, String(pin))) return err('Incorrect PIN', 401)
      const session = await buildSessionForUser(db, user)
      const hours = STORE_ROLES.includes(user.role) ? STORE_TOKEN_HOURS : BACKOFFICE_TOKEN_HOURS
      const token = await signToken({ ...session, exp: Date.now() + hours * 3600_000 }, env.SESSION_SECRET)
      return json({
        ok: true, token,
        user: { id: user.id, display_name: user.display_name, role: user.role, store_id: user.store_id }
      })
    }

    // ── Authenticated ─────────────────────────────────────────────────────
    const session = await authenticate(request, env)
    if (!session) return err('Unauthorized', 401)
    const isBO = isBackOffice(session)

    // ── Back-office admin: stores ─────────────────────────────────────────
    // All /admin/* endpoints require back-office mode.

    if (path === '/admin/stores' && method === 'GET') {
      if (!isBO) return err('Forbidden', 403)
      const rows = await db.select('stores', {
        select: 'id,store_code,store_name,region,area_id,is_active,created_at',
        order:  'store_code.asc'
      })
      return json(rows)
    }

    if (path === '/admin/stores' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
      const { store_code, store_name, region, area_id, pin, is_active } = await request.json()
      if (!store_code || !store_name) return err('store_code and store_name are required', 400)
      if (!pin || String(pin).length < 4) return err('PIN must be at least 4 characters', 400)

      // Hash the PIN via the existing bcrypt extension.
      const [hashRow] = await db.rpc('hash_pin', { pin: String(pin) })
      if (!hashRow?.hash) return err('Could not hash PIN', 500)

      const inserted = await db.insert('stores', {
        store_code, store_name,
        region:    region || null,
        area_id:   area_id || null,
        is_active: is_active !== false,
        pin_hash:  hashRow.hash
      })
      const s = inserted[0] ?? inserted
      return json({ id: s.id, store_code: s.store_code, store_name: s.store_name, region: s.region, area_id: s.area_id, is_active: s.is_active, created_at: s.created_at }, 201)
    }

    const adminStoreMatch = path.match(/^\/admin\/stores\/([a-f0-9-]+)$/)
    if (adminStoreMatch && method === 'PATCH') {
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
      const rows = await db.select('suppliers', {
        select: 'id,supplier_code,supplier_name,is_active,created_at,updated_at',
        order:  'supplier_name.asc'
      })
      return json(rows)
    }

    if (path === '/admin/suppliers' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
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

    if (path === '/admin/users' && method === 'GET') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('users', {
        select: 'id,username,display_name,role,store_id,is_active,created_at,updated_at',
        order:  'role.asc,username.asc'
      })
      // attach area_ids per user (only matters for area_managers, but cheap)
      const links = await db.select('user_areas', { select: 'user_id,area_id' })
      const byUser = {}
      for (const l of links) (byUser[l.user_id] ||= []).push(l.area_id)
      return json(rows.map(r => ({ ...r, area_ids: byUser[r.id] || [] })))
    }

    if (path === '/admin/users' && method === 'POST') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const { username, display_name, role, store_id, area_ids, pin, is_active } = await request.json()
      if (!username || !display_name || !role) return err('username, display_name and role are required', 400)
      if (!pin || String(pin).length < 4) return err('PIN must be at least 4 characters', 400)
      if (![...STORE_ROLES, ...BO_ROLES].includes(role)) return err('Unknown role', 400)

      const [hashRow] = await db.rpc('hash_pin', { pin: String(pin) })
      if (!hashRow?.hash) return err('Could not hash PIN', 500)

      const inserted = await db.insert('users', {
        username: String(username).trim(),
        display_name: String(display_name).trim(),
        role,
        store_id: store_id || null,
        pin_hash: hashRow.hash,
        is_active: is_active !== false
      })
      const u = inserted[0] ?? inserted

      if (role === 'area_manager' && Array.isArray(area_ids) && area_ids.length) {
        await db.insert('user_areas', area_ids.filter(a => /^[a-f0-9-]{36}$/.test(a)).map(area_id => ({ user_id: u.id, area_id })))
      }
      return json({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, store_id: u.store_id, is_active: u.is_active }, 201)
    }

    const adminUserMatch = path.match(/^\/admin\/users\/([a-f0-9-]+)$/)
    if (adminUserMatch && method === 'PATCH') {
      if (!isAdminRole(session)) return err('Forbidden', 403)
      const id = adminUserMatch[1]
      const body = await request.json()
      const updates = {}
      if (body.username     !== undefined) updates.username     = String(body.username).trim()
      if (body.display_name !== undefined) updates.display_name = String(body.display_name).trim()
      if (body.role         !== undefined) {
        if (![...STORE_ROLES, ...BO_ROLES].includes(body.role)) return err('Unknown role', 400)
        updates.role = body.role
      }
      if (body.store_id     !== undefined) updates.store_id     = body.store_id || null
      if (body.is_active    !== undefined) updates.is_active    = !!body.is_active
      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString()
        const updated = await db.update('users', { id: `eq.${id}` }, updates)
        if (!updated.length) return err('User not found', 404)
      }
      // Replace area assignments if explicitly supplied.
      if (Array.isArray(body.area_ids)) {
        await db.remove('user_areas', { user_id: `eq.${id}` })
        const safe = body.area_ids.filter(a => /^[a-f0-9-]{36}$/.test(a))
        if (safe.length) {
          await db.insert('user_areas', safe.map(area_id => ({ user_id: id, area_id })))
        }
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
      if (!isBO) return err('Forbidden', 403)
      const rows = await db.select('areas', {
        select: 'id,area_code,area_name,is_active,created_at,updated_at',
        order:  'area_name.asc'
      })
      return json(rows)
    }

    if (path === '/admin/areas' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
      const kind = url.searchParams.get('kind')
      const params = {
        select: 'id,kind,label,task_types,sort_order,is_active,created_at',
        order:  'kind.asc,sort_order.asc,label.asc'
      }
      if (kind) params.kind = `eq.${kind}`
      return json(await db.select('lookup_options', params))
    }

    if (path === '/admin/lookup-options' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
      const { kind, label, task_types = [], sort_order = 0 } = await request.json()
      if (!kind || !label) return err('kind and label required', 400)
      const inserted = await db.insert('lookup_options', {
        kind, label, task_types, sort_order, is_active: true
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const adminLookupMatch = path.match(/^\/admin\/lookup-options\/([a-f0-9-]+)$/)
    if (adminLookupMatch && method === 'PATCH') {
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
      await db.remove('lookup_options', { id: `eq.${adminLookupMatch[1]}` })
      return json({ ok: true })
    }

    // ── Back-office admin: products master ───────────────────────────────

    if (path === '/admin/products' && method === 'GET') {
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
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
      if (!isBO) return err('Forbidden', 403)
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

      const clean = rows
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
      if (!upsertRes.ok) throw new Error(await upsertRes.text())
      const written = await upsertRes.json()
      return json({ written: written.length })
    }

    // ── Back-office admin: settings ──────────────────────────────────────

    if (path === '/admin/settings' && method === 'GET') {
      if (!isBO) return err('Forbidden', 403)
      const rows = await db.select('app_settings', { select: 'key,value,updated_at', order: 'key.asc' })
      // Hide the back-office PIN hash — it's a secret.
      return json(rows.filter(r => r.key !== 'backoffice_pin_hash'))
    }

    if (path === '/admin/settings' && method === 'PATCH') {
      if (!isBO) return err('Forbidden', 403)
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

    // POST /admin/cleanup/photos — delete photos older than photo_retention_days.
    if (path === '/admin/cleanup/photos' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
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

    const adminPinMatch = path.match(/^\/admin\/stores\/([a-f0-9-]+)\/reset-pin$/)
    if (adminPinMatch && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
      const id  = adminPinMatch[1]
      const { pin } = await request.json()
      if (!pin || String(pin).length < 4) return err('PIN must be at least 4 characters', 400)
      const [hashRow] = await db.rpc('hash_pin', { pin: String(pin) })
      if (!hashRow?.hash) return err('Could not hash PIN', 500)
      const updated = await db.update('stores', { id: `eq.${id}` }, { pin_hash: hashRow.hash })
      if (!updated.length) return err('Store not found', 404)
      return json({ ok: true })
    }

    // ── Store task templates (Phase 9D) ──────────────────────────────────

    if (path === '/admin/task-templates' && method === 'GET') {
      if (!canCreateTasks(session) && !isAdminRole(session)) return err('Forbidden', 403)
      const rows = await db.select('store_task_templates', {
        select: '*',
        order: 'sort_order.asc,title.asc'
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
        title:            b.title.trim(),
        description:      b.description || null,
        instructions:     b.instructions || null,
        category:         b.category || null,
        frequency:        b.frequency || 'daily',
        due_window:       b.due_window || null,
        requires_photo:   !!b.requires_photo,
        requires_notes:   !!b.requires_notes,
        applies_to:       b.applies_to || 'all',
        area_ids:         Array.isArray(b.area_ids)  ? b.area_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))  : [],
        store_ids:        Array.isArray(b.store_ids) ? b.store_ids.filter(x => /^[a-f0-9-]{36}$/.test(x)) : [],
        assigned_to_role: b.assigned_to_role || 'all',
        priority:         b.priority || null,
        is_active:        b.is_active !== false,
        sort_order:       Number(b.sort_order) || 0,
        created_by:       session.user_id || null
      })
      return json(inserted[0] ?? inserted, 201)
    }

    const adminTemplateMatch = path.match(/^\/admin\/task-templates\/([a-f0-9-]+)$/)
    if (adminTemplateMatch && method === 'PATCH') {
      if (!canCreateTasks(session)) return err('Forbidden', 403)
      const id = adminTemplateMatch[1]
      const b  = await request.json()
      const u  = { updated_at: new Date().toISOString() }
      for (const k of ['title','description','instructions','category','frequency','due_window','applies_to','assigned_to_role','priority']) {
        if (b[k] !== undefined) u[k] = b[k]
      }
      if (b.requires_photo !== undefined) u.requires_photo = !!b.requires_photo
      if (b.requires_notes !== undefined) u.requires_notes = !!b.requires_notes
      if (b.is_active      !== undefined) u.is_active      = !!b.is_active
      if (b.sort_order     !== undefined) u.sort_order     = Number(b.sort_order) || 0
      if (Array.isArray(b.area_ids))  u.area_ids  = b.area_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
      if (Array.isArray(b.store_ids)) u.store_ids = b.store_ids.filter(x => /^[a-f0-9-]{36}$/.test(x))
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
      // Sales assistants / store managers see their own store. BO sees an
      // optional storeId. Area managers default to all stores in their area.
      const storeId = isBO ? url.searchParams.get('storeId') : session.storeId
      const today   = new Date()
      const todayIso = today.toISOString().slice(0, 10)
      if (!storeId || storeId === 'all') {
        // Aggregate view — return all instances due today across all
        // visible stores. Used by stats / inbox-style listings.
        const params = {
          select: 'id,template_id,store_id,period_key,due_date,status,completed_at,photo_url,notes,store_task_templates(title,category,frequency,due_window,requires_photo,requires_notes,assigned_to_role,priority)',
          due_date: `eq.${todayIso}`,
          order: 'created_at.asc',
          limit: '500'
        }
        // For area_manager — scope to their area's stores.
        if (session.role === 'area_manager' && session.area_ids?.length) {
          const stores = await db.select('stores', { select: 'id', area_id: `in.(${session.area_ids.join(',')})` })
          const ids = stores.map(s => s.id)
          if (!ids.length) return json([])
          params['store_id'] = `in.(${ids.join(',')})`
        }
        const rows = await db.select('store_task_instances', params)
        return json(rows)
      }
      // Single-store path — ensure instances exist, then return them.
      await ensureInstancesExist(db, env, storeId, today)
      const rows = await db.select('store_task_instances', {
        select: 'id,template_id,store_id,period_key,due_date,status,completed_at,photo_url,notes,store_task_templates(title,category,frequency,due_window,requires_photo,requires_notes,assigned_to_role,priority)',
        store_id: `eq.${storeId}`,
        due_date: `eq.${todayIso}`,
        order: 'created_at.asc'
      })
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

    // PATCH /store-tasks/:id/complete  body: { photo_url?, notes? }
    const instCompleteMatch = path.match(/^\/store-tasks\/([a-f0-9-]+)\/complete$/)
    if (instCompleteMatch && method === 'PATCH') {
      const id = instCompleteMatch[1]
      const body = await request.json().catch(() => ({}))

      // Load the instance + its template so we can enforce requires_photo/notes.
      const [inst] = await db.select('store_task_instances', {
        select: 'id,store_id,template_id,status,store_task_templates(requires_photo,requires_notes)',
        id: `eq.${id}`,
        limit: '1'
      })
      if (!inst) return err('Instance not found', 404)

      // Authorization: store users can only complete their own store's items.
      if (!isBO && inst.store_id !== session.storeId) return err('Forbidden', 403)

      const t = inst.store_task_templates
      if (t?.requires_photo && !body.photo_url) return err('A photo is required for this task.', 400)
      if (t?.requires_notes && !(body.notes && String(body.notes).trim())) return err('Notes are required for this task.', 400)

      const updated = await db.update('store_task_instances', { id: `eq.${id}` }, {
        status:       'completed',
        photo_url:    body.photo_url || null,
        notes:        body.notes ? String(body.notes).trim() : null,
        completed_by: session.user_id || null,
        completed_at: new Date().toISOString()
      })
      if (!updated.length) return err('Instance not found', 404)
      return json(updated[0])
    }

    // GET /store-tasks/stats?storeId=&from=&to=
    if (path === '/store-tasks/stats' && method === 'GET') {
      const p = url.searchParams
      const from = p.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const to   = p.get('to')   || new Date().toISOString().slice(0, 10)
      const storeId = isBO ? p.get('storeId') : session.storeId

      const params = {
        select: 'store_id,status',
        and: `(due_date.gte.${from},due_date.lte.${to})`,
        limit: '5000'
      }
      if (storeId && storeId !== 'all') params['store_id'] = `eq.${storeId}`
      if (!storeId && session.role === 'area_manager' && session.area_ids?.length) {
        const stores = await db.select('stores', { select: 'id', area_id: `in.(${session.area_ids.join(',')})` })
        const ids = stores.map(s => s.id)
        if (ids.length) params['store_id'] = `in.(${ids.join(',')})`
        else return json({ per_store: [], overall: { total: 0, completed: 0, pending: 0, missed: 0 } })
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

    // GET /dashboard/stats?from=&to=&storeId=
    if (path === '/dashboard/stats' && method === 'GET') {
      const p = url.searchParams
      const from = p.get('from')
      const to   = p.get('to')
      const queryStoreId = isBO ? p.get('storeId') : session.storeId

      const params = {
        select: 'id,task_type,store_id,product_code,product_barcode,status,created_at',
        order:  'created_at.desc',
        limit:  '5000'
      }
      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString()}`)
      if (to)   range.push(`lte.${new Date(to).toISOString()}`)
      if (range.length)                            params['created_at'] = range
      if (queryStoreId && queryStoreId !== 'all') params['store_id']   = `eq.${queryStoreId}`

      const records = await db.select('task_records', params)

      const totals = { all: records.length, pending: 0, completed: 0, no_change_needed: 0, store_completed: 0 }
      const byTask = {}, byStore = {}, byDay = {}

      // Build a continuous 14-day window so the line chart has flat days too.
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400000)
        byDay[d.toISOString().slice(0, 10)] = 0
      }

      for (const r of records) {
        totals[r.status] = (totals[r.status] || 0) + 1
        byTask[r.task_type] = (byTask[r.task_type] || 0) + 1
        if (r.store_id) byStore[r.store_id] = (byStore[r.store_id] || 0) + 1
        const d = String(r.created_at).slice(0, 10)
        if (d in byDay) byDay[d] = (byDay[d] || 0) + 1
      }

      const [taskTypes, stores] = await Promise.all([
        db.select('task_types', { select: 'code,name' }),
        isBO ? db.select('stores', { select: 'id,store_name' }) : Promise.resolve([])
      ])
      const taskName  = Object.fromEntries(taskTypes.map(t => [t.code, t.name]))
      const storeName = Object.fromEntries(stores.map(s => [s.id, s.store_name]))

      return json({
        totals,
        by_task_type: Object.entries(byTask)
          .map(([code, count]) => ({ code, name: taskName[code] || code, count }))
          .sort((a, b) => b.count - a.count),
        by_store: isBO
          ? Object.entries(byStore)
              .map(([id, count]) => ({ id, store_name: storeName[id] || '', count }))
              .sort((a, b) => b.count - a.count)
          : [],
        by_day: Object.entries(byDay)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        recent: records.slice(0, 10).map(r => ({
          id:           r.id,
          task_type:    r.task_type,
          store_id:     r.store_id,
          store_name:   storeName[r.store_id] || '',
          product:      r.product_code || r.product_barcode || '',
          status:       r.status,
          created_at:   r.created_at
        }))
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

      // store_task photos live under their own prefix so the existing
      // retention rules can target each kind separately if needed.
      const objectPath = slot === 'store_task'
        ? `store-tasks/${tempId}.jpg`
        : `${tempId}/${slot}.jpg`
      const uploadUrl  = `${env.SUPABASE_URL}/storage/v1/object/task-photos/${objectPath}`

      const upRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey':        env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type':  file.type || 'image/jpeg',
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
      const isProductPhoto = /^[a-zA-Z0-9-]{8,64}\/(product|barcode)\.jpg$/.test(objectPath)
      const isStorePhoto   = /^store-tasks\/[a-zA-Z0-9-]{8,64}\.jpg$/.test(objectPath)
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
      const p = url.searchParams
      const queryStoreId = isBO ? p.get('storeId') : session.storeId
      const taskType     = p.get('task_type')
      const status       = p.get('status')
      const from         = p.get('from')
      const to           = p.get('to')

      const params = {
        select: 'id,task_type,store_id,supplier_id,supplier_name_text,product_code,product_barcode,product_name_label,description,uom,quantity,notes,photo_product_url,photo_barcode_url,details,status,review_notes,reviewed_at,marked_for_deletion,completed_at,store_completed_at,created_at,updated_at',
        order: 'created_at.desc'
      }
      if (queryStoreId && queryStoreId !== 'all') params['store_id']  = `eq.${queryStoreId}`
      if (taskType && taskType !== 'all')          params['task_type'] = `eq.${taskType}`
      if (status)                                  params['status']    = `eq.${status}`

      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString()}`)
      if (to)   range.push(`lte.${new Date(to).toISOString()}`)
      if (range.length) params['created_at'] = range

      const rows = await db.select('task_records', params)
      return json(rows)
    }

    // Bulk review (back office) — mark many records as completed or
    // no_change_needed, with an optional shared review note.
    if (path === '/task-records/bulk-review' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
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

      const updated = await db.update('task_records', { id: `in.(${safeIds.join(',')})` }, updates)
      return json({ updated: updated.length })
    }

    if (path === '/task-records' && method === 'POST') {
      const body = await request.json()
      if (!body.task_type) return err('task_type required', 400)

      const now = new Date().toISOString()
      const store_id = isBO ? (body.store_id || null) : session.storeId

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
      return json(inserted[0] ?? inserted, 201)
    }

    const recMatch = path.match(/^\/task-records\/([a-f0-9-]+)$/)
    if (recMatch && method === 'PATCH') {
      const id      = recMatch[1]
      const updates = await request.json()
      const filter  = { id: `eq.${id}` }
      if (!isBO) filter['store_id'] = `eq.${session.storeId}`
      // If the back office is moving the record to a reviewed status,
      // stamp reviewed_at automatically so the UI doesn't have to.
      if (isBO && (updates.status === 'completed' || updates.status === 'no_change_needed') && !updates.reviewed_at) {
        updates.reviewed_at = new Date().toISOString()
      }
      const updated = await db.update('task_records', filter, { ...updates, updated_at: new Date().toISOString() })
      if (!updated.length) return err('Record not found or not allowed', 404)
      return json(updated[0])
    }

    if (recMatch && method === 'DELETE') {
      const id     = recMatch[1]
      const filter = { id: `eq.${id}` }
      if (!isBO) {
        filter['store_id'] = `eq.${session.storeId}`
        filter['status']   = `eq.store_completed`
      }
      const removed = await db.remove('task_records', filter)
      if (!removed.length) return err('Record not found or not allowed', 404)
      return json({ ok: true })
    }

    // ── Reports ───────────────────────────────────────────────────────────
    if (path === '/reports/task-records' && method === 'GET') {
      const p        = url.searchParams
      const from     = p.get('from')
      const to       = p.get('to')
      const storeId  = isBO ? p.get('storeId') : session.storeId
      const taskType = p.get('task_type')

      const range = []
      if (from) range.push(`gte.${new Date(from).toISOString()}`)
      if (to)   range.push(`lte.${new Date(to).toISOString()}`)

      const params = {
        select: 'id,task_type,store_id,supplier_id,supplier_name_text,product_code,product_barcode,product_name_label,description,uom,quantity,notes,details,status,review_notes,created_at',
        order:  'created_at.asc'
      }
      if (range.length)                            params['created_at'] = range
      if (storeId && storeId !== 'all')            params['store_id']   = `eq.${storeId}`
      if (taskType && taskType !== 'all')          params['task_type']  = `eq.${taskType}`

      const records   = await db.select('task_records', params)
      const stores    = await db.select('stores',    { select: 'id,store_name' })
      const suppliers = await db.select('suppliers', { select: 'id,supplier_name' })
      const storeName    = Object.fromEntries(stores.map(s    => [s.id, s.store_name]))
      const supplierName = Object.fromEntries(suppliers.map(s => [s.id, s.supplier_name]))

      const flat = records.map(r => ({
        task_type:       r.task_type,
        store_name:      storeName[r.store_id] || '',
        product_code:    r.product_code || '',
        product_barcode: r.product_barcode || '',
        description:     r.description || r.product_name_label || '',
        uom:             r.uom || '',
        quantity:        r.quantity ?? '',
        supplier:        r.supplier_id ? (supplierName[r.supplier_id] || '') : (r.supplier_name_text || ''),
        notes:           r.notes || '',
        status:          r.status,
        review_notes:    r.review_notes || '',
        details:         JSON.stringify(r.details || {}),
        created_at:      r.created_at
      }))

      const cols = ['task_type','store_name','product_code','product_barcode','description','uom','quantity','supplier','notes','status','review_notes','details','created_at']
      const csv  = toCSV(flat, cols)
      const filename = `task-records-${(from || 'start').slice(0,10)}-to-${(to || 'now').slice(0,10)}.csv`

      return new Response(csv, {
        headers: {
          'Content-Type':        'text/csv;charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      })
    }

    return err('Not found', 404)

  } catch (e) {
    console.error(e)
    return err(e.message || 'Internal error', 500)
  }
}
