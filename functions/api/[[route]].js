/**
 * Cloudflare Pages Functions — catch-all handler for /api/*
 *
 * Env vars (set in Cloudflare Pages dashboard, and in .dev.vars for local dev):
 *   SUPABASE_URL       e.g. https://xxxx.supabase.co     (set in wrangler.toml [vars])
 *   SUPABASE_ANON_KEY  eyJ...                             (Cloudflare Secret)
 *   SESSION_SECRET     long random string                 (Cloudflare Secret)
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

  // Build URLSearchParams from a plain object. If a value is an array,
  // each item is appended as a separate param with the same key — this is how
  // PostgREST expresses range filters like `created_at=gte.X & created_at=lte.Y`.
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
      const q = buildQuery(params)
      const res = await fetch(`${url}/rest/v1/${table}?${q}`, { headers })
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
      const q = buildQuery(filterParams)
      const res = await fetch(`${url}/rest/v1/${table}?${q}`, {
        method: 'PATCH', headers, body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    async remove(table, filterParams) {
      const q = buildQuery(filterParams)
      const res = await fetch(`${url}/rest/v1/${table}?${q}`, {
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

// ── Session tokens (HMAC-SHA256, no library) ────────────────────────────────

const STORE_TOKEN_HOURS      = 24
const BACKOFFICE_TOKEN_HOURS = 12

const b64urlEncode = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

const b64urlDecode = (str) => {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : ''
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function signToken(payload, secret) {
  const enc  = new TextEncoder()
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)))
  const key  = await hmacKey(secret)
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`
}

async function verifyTokenSig(token, secret) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  try {
    const key = await hmacKey(secret)
    const ok  = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), new TextEncoder().encode(parts[0]))
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  return verifyTokenSig(token, env.SESSION_SECRET)
}

// ── Response helpers ────────────────────────────────────────────────────────

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const err = (msg, status = 400) => json({ error: msg }, status)

// ── CSV builder ─────────────────────────────────────────────────────────────

function toCSV(rows) {
  const cols = ['product_code', 'description', 'uom', 'quantity', 'status', 'store_name', 'created_at']
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = cols.join(',')
  const lines  = rows.map(r => cols.map(c => escape(r[c])).join(','))
  return [header, ...lines].join('\n') + '\n'
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context
  const url    = new URL(request.url)
  const path   = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/'
  const method = request.method

  if (!env.SESSION_SECRET) return err('SESSION_SECRET not configured on server', 500)

  const db = sb(env)

  try {

    // ── Public: list stores (login screen needs this) ─────────────────────
    if (path === '/stores' && method === 'GET') {
      const stores = await db.select('stores', {
        select: 'id,store_code,store_name,region,is_active',
        order:  'store_name.asc'
      })
      return json(stores)
    }

    // ── Public: store PIN verification ────────────────────────────────────
    if (path === '/stores/verify-pin' && method === 'POST') {
      const { storeId, pin } = await request.json()
      if (!storeId || !pin) return err('storeId and pin required', 400)

      const [store] = await db.select('stores', {
        select: 'id,store_code,store_name,region,pin_hash',
        id: `eq.${storeId}`
      })
      if (!store) return err('Store not found', 404)

      const ok = await verifyPin(db, store.pin_hash, String(pin))
      if (!ok) return err('Incorrect PIN', 401)

      const token = await signToken({
        mode:    'store',
        storeId: store.id,
        exp:     Date.now() + STORE_TOKEN_HOURS * 3600_000
      }, env.SESSION_SECRET)

      return json({
        ok:    true,
        token,
        store: {
          id:         store.id,
          store_code: store.store_code,
          store_name: store.store_name,
          region:     store.region
        }
      })
    }

    // ── Public: back-office PIN verification ──────────────────────────────
    if (path === '/backoffice/verify-pin' && method === 'POST') {
      const { pin } = await request.json()
      if (!pin) return err('pin required', 400)

      const [setting] = await db.select('app_settings', {
        select: 'value',
        key:    'eq.backoffice_pin_hash'
      })
      if (!setting?.value) return err('Back office PIN not configured', 500)

      const ok = await verifyPin(db, setting.value, String(pin))
      if (!ok) return err('Incorrect PIN', 401)

      const token = await signToken({
        mode:    'backoffice',
        storeId: null,
        exp:     Date.now() + BACKOFFICE_TOKEN_HOURS * 3600_000
      }, env.SESSION_SECRET)

      return json({ ok: true, token })
    }

    // ── All endpoints below require a valid token ─────────────────────────
    const session = await authenticate(request, env)
    if (!session) return err('Unauthorized', 401)
    const isBO = session.mode === 'backoffice'

    // ── GET /product-records ──────────────────────────────────────────────
    if (path === '/product-records' && method === 'GET') {
      const p      = url.searchParams
      const status = p.get('status')
      // Back office may optionally filter by a specific store; store users can't.
      const queryStoreId = isBO ? p.get('storeId') : session.storeId

      const params = {
        select: 'id,product_code,description,uom,quantity,status,store_id,created_at,completed_at,store_completed_at,marked_for_deletion',
        order:  'created_at.desc'
      }
      if (queryStoreId) params['store_id'] = `eq.${queryStoreId}`
      if (status)       params['status']   = `eq.${status}`

      const records = await db.select('product_records', params)
      return json(records)
    }

    // ── POST /product-records ─────────────────────────────────────────────
    if (path === '/product-records' && method === 'POST') {
      const body = await request.json()
      const now  = new Date().toISOString()

      // Store users can only create records for their own store.
      const store_id = isBO ? (body.store_id || null) : session.storeId

      const inserted = await db.insert('product_records', {
        store_id,
        product_code:    body.product_code,
        description:     body.description || null,
        uom:             body.uom,
        quantity:        body.quantity,
        status:          body.status || 'pending',
        marked_for_deletion: false,
        created_at:      now,
        updated_at:      now
      })
      return json(inserted[0] ?? inserted, 201)
    }

    // ── PATCH /product-records/:id ────────────────────────────────────────
    const recMatch = path.match(/^\/product-records\/([a-f0-9-]+)$/)
    if (recMatch && method === 'PATCH') {
      const id      = recMatch[1]
      const updates = await request.json()

      const filter = { id: `eq.${id}` }
      // Store users can only update their own store's records.
      if (!isBO) filter['store_id'] = `eq.${session.storeId}`

      const updated = await db.update('product_records', filter, {
        ...updates,
        updated_at: new Date().toISOString()
      })
      if (!updated.length) return err('Record not found or not allowed', 404)
      return json(updated[0])
    }

    // ── DELETE /product-records/:id ───────────────────────────────────────
    if (recMatch && method === 'DELETE') {
      const id = recMatch[1]

      const filter = { id: `eq.${id}` }
      if (!isBO) {
        // Store can only delete their own records that are store_completed.
        filter['store_id'] = `eq.${session.storeId}`
        filter['status']   = `eq.store_completed`
      }

      const removed = await db.remove('product_records', filter)
      if (!removed.length) return err('Record not found or not allowed', 404)
      return json({ ok: true })
    }

    // ── GET /products/lookup ──────────────────────────────────────────────
    if (path === '/products/lookup' && method === 'GET') {
      const code = url.searchParams.get('code')
      if (!code) return json(null)
      const results = await db.select('products', {
        select:     'product_id,description,uom',
        product_id: `eq.${code}`,
        limit:      '1'
      })
      return json(results[0] ?? null)
    }

    // ── GET /reports/product-records (CSV) ────────────────────────────────
    if (path === '/reports/product-records' && method === 'GET') {
      const p       = url.searchParams
      const from    = p.get('from')   // ISO datetime, e.g. 2026-04-15T09:30
      const to      = p.get('to')
      const storeId = isBO ? p.get('storeId') : session.storeId

      // Build a single created_at filter as an array so both gte and lte
      // become separate query params (PostgREST handles AND on same column).
      const dateRange = []
      if (from) dateRange.push(`gte.${new Date(from).toISOString()}`)
      if (to)   dateRange.push(`lte.${new Date(to).toISOString()}`)

      const params = {
        select: 'product_code,description,uom,quantity,status,store_id,created_at',
        order:  'created_at.asc'
      }
      if (dateRange.length) params['created_at'] = dateRange
      if (storeId && storeId !== 'all') params['store_id'] = `eq.${storeId}`

      const records = await db.select('product_records', params)

      // Join store_name from the stores list (small table, cached per request).
      const stores  = await db.select('stores', { select: 'id,store_name' })
      const nameOf  = Object.fromEntries(stores.map(s => [s.id, s.store_name]))
      const withStore = records.map(r => ({ ...r, store_name: nameOf[r.store_id] || '' }))

      const csv = toCSV(withStore)
      const filename = `product-records-${(from || 'start').slice(0, 10)}-to-${(to || 'now').slice(0, 10)}.csv`

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
