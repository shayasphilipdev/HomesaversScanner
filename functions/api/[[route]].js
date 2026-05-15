/**
 * Cloudflare Pages Functions — catch-all handler for /api/*
 *
 * Env vars (set in Cloudflare Pages dashboard, and in .dev.vars for local dev):
 *   SUPABASE_URL       e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY  eyJ...
 *   BCRYPT_ROUNDS      optional, default 10
 */

// ── Supabase REST helper ────────────────────────────────────────────────────

function sb(env) {
  const url  = env.SUPABASE_URL
  const key  = env.SUPABASE_ANON_KEY

  const headers = {
    'apikey':        key,
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  }

  return {
    async select(table, params = {}) {
      const q = new URLSearchParams(params)
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
    async update(table, id, body) {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH', headers, body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    async delete(table, id) {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
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

// ── PIN verification (constant-time compare via Supabase RPC) ───────────────
// Uses a Supabase SQL function `verify_pin(hash text, pin text)` that runs
// crypt(pin, hash) = hash — bcrypt in-database, never in CF Worker.

async function verifyPin(db, hash, pin) {
  const [row] = await db.rpc('verify_pin', { hash, pin })
  return row?.result === true
}

// ── Response helpers ─────────────────────────────────────────────────────────

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const err = (msg, status = 400) => json({ error: msg }, status)

// ── CSV builder ───────────────────────────────────────────────────────────────

function toCSV(rows) {
  if (!rows.length) return 'product_code,description,uom,quantity,status,store,created_at\n'
  const cols = ['product_code','description','uom','quantity','status','store_name','created_at']
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = cols.join(',')
  const lines  = rows.map(r => cols.map(c => escape(r[c])).join(','))
  return [header, ...lines].join('\n')
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context
  const url    = new URL(request.url)
  const path   = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/'
  const method = request.method

  const db = sb(env)

  try {

    // ── GET /stores ──────────────────────────────────────────────────────────
    if (path === '/stores' && method === 'GET') {
      const stores = await db.select('stores', { select: 'id,store_code,store_name,region,is_active', order: 'store_name.asc' })
      return json(stores)
    }

    // ── POST /stores/verify-pin ──────────────────────────────────────────────
    if (path === '/stores/verify-pin' && method === 'POST') {
      const { storeId, pin } = await request.json()
      const [store] = await db.select('stores', { select: 'pin_hash', id: `eq.${storeId}` })
      if (!store) return err('Store not found', 404)
      const ok = await verifyPin(db, store.pin_hash, String(pin))
      if (!ok) return err('Incorrect PIN', 401)
      return json({ ok: true })
    }

    // ── POST /backoffice/verify-pin ──────────────────────────────────────────
    if (path === '/backoffice/verify-pin' && method === 'POST') {
      const { pin } = await request.json()
      const [setting] = await db.select('app_settings', { select: 'value', key: 'eq.backoffice_pin_hash' })
      if (!setting) return err('Back office PIN not configured', 500)
      const ok = await verifyPin(db, setting.value, String(pin))
      if (!ok) return err('Incorrect PIN', 401)
      return json({ ok: true })
    }

    // ── GET /product-records ─────────────────────────────────────────────────
    if (path === '/product-records' && method === 'GET') {
      const p      = url.searchParams
      const mode   = p.get('mode')
      const storeId= p.get('storeId')
      const status = p.get('status')

      const params = {
        select: 'id,product_code,description,uom,quantity,status,store_id,created_at,completed_at,store_completed_at,marked_for_deletion',
        order: 'created_at.desc'
      }

      // Store users only see their own store
      if (mode !== 'backoffice' && storeId) {
        params['store_id'] = `eq.${storeId}`
      }

      if (status) params['status'] = `eq.${status}`

      const records = await db.select('product_records', params)
      return json(records)
    }

    // ── POST /product-records ────────────────────────────────────────────────
    if (path === '/product-records' && method === 'POST') {
      const body = await request.json()
      const now  = new Date().toISOString()
      const inserted = await db.insert('product_records', {
        store_id:        body.store_id || null,
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

    // ── PATCH /product-records/:id ───────────────────────────────────────────
    const patchMatch = path.match(/^\/product-records\/([a-f0-9-]+)$/)
    if (patchMatch && method === 'PATCH') {
      const id      = patchMatch[1]
      const updates = await request.json()
      const updated = await db.update('product_records', id, { ...updates, updated_at: new Date().toISOString() })
      return json(updated[0] ?? updated)
    }

    // ── DELETE /product-records/:id ──────────────────────────────────────────
    const deleteMatch = path.match(/^\/product-records\/([a-f0-9-]+)$/)
    if (deleteMatch && method === 'DELETE') {
      await db.delete('product_records', deleteMatch[1])
      return json({ ok: true })
    }

    // ── GET /products/lookup ─────────────────────────────────────────────────
    if (path === '/products/lookup' && method === 'GET') {
      const code    = url.searchParams.get('code')
      const results = await db.select('products', {
        select: 'product_id,description,uom',
        product_id: `eq.${code}`,
        limit: 1
      })
      return json(results[0] ?? null)
    }

    // ── GET /reports/product-records ─────────────────────────────────────────
    if (path === '/reports/product-records' && method === 'GET') {
      const p       = url.searchParams
      const from    = p.get('from')
      const to      = p.get('to')
      const storeId = p.get('storeId')
      const mode    = p.get('mode')

      const params = {
        select: 'product_code,description,uom,quantity,status,store_id,created_at',
        order:  'created_at.asc'
      }

      if (from) params['created_at'] = `gte.${from}T00:00:00Z`
      if (to)   params['created_at'] = `lte.${to}T23:59:59Z`
      if (mode !== 'backoffice' && storeId) params['store_id'] = `eq.${storeId}`

      const records = await db.select('product_records', params)
      const csv     = toCSV(records)

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="product-records-${from}-to-${to}.csv"`
        }
      })
    }

    return err('Not found', 404)

  } catch (e) {
    console.error(e)
    return err(e.message || 'Internal error', 500)
  }
}
