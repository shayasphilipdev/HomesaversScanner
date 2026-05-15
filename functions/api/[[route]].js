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

// ── Helpers ──────────────────────────────────────────────────────────────────

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const err = (msg, status = 400) => json({ error: msg }, status)

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

    if (path === '/stores/verify-pin' && method === 'POST') {
      const { storeId, pin } = await request.json()
      if (!storeId || !pin) return err('storeId and pin required', 400)
      const [store] = await db.select('stores', { select: 'id,store_code,store_name,region,pin_hash', id: `eq.${storeId}` })
      if (!store) return err('Store not found', 404)
      if (!await verifyPin(db, store.pin_hash, String(pin))) return err('Incorrect PIN', 401)
      const token = await signToken(
        { mode: 'store', storeId: store.id, exp: Date.now() + STORE_TOKEN_HOURS * 3600_000 },
        env.SESSION_SECRET
      )
      return json({ ok: true, token, store: { id: store.id, store_code: store.store_code, store_name: store.store_name, region: store.region } })
    }

    if (path === '/backoffice/verify-pin' && method === 'POST') {
      const { pin } = await request.json()
      if (!pin) return err('pin required', 400)
      const [setting] = await db.select('app_settings', { select: 'value', key: 'eq.backoffice_pin_hash' })
      if (!setting?.value) return err('Back office PIN not configured', 500)
      if (!await verifyPin(db, setting.value, String(pin))) return err('Incorrect PIN', 401)
      const token = await signToken(
        { mode: 'backoffice', storeId: null, exp: Date.now() + BACKOFFICE_TOKEN_HOURS * 3600_000 },
        env.SESSION_SECRET
      )
      return json({ ok: true, token })
    }

    // ── Authenticated ─────────────────────────────────────────────────────
    const session = await authenticate(request, env)
    if (!session) return err('Unauthorized', 401)
    const isBO = session.mode === 'backoffice'

    // ── Back-office admin: stores ─────────────────────────────────────────
    // All /admin/* endpoints require back-office mode.

    if (path === '/admin/stores' && method === 'GET') {
      if (!isBO) return err('Forbidden', 403)
      const rows = await db.select('stores', {
        select: 'id,store_code,store_name,region,is_active,created_at',
        order:  'store_code.asc'
      })
      return json(rows)
    }

    if (path === '/admin/stores' && method === 'POST') {
      if (!isBO) return err('Forbidden', 403)
      const { store_code, store_name, region, pin, is_active } = await request.json()
      if (!store_code || !store_name) return err('store_code and store_name are required', 400)
      if (!pin || String(pin).length < 4) return err('PIN must be at least 4 characters', 400)

      // Hash the PIN via the existing bcrypt extension.
      const [hashRow] = await db.rpc('hash_pin', { pin: String(pin) })
      if (!hashRow?.hash) return err('Could not hash PIN', 500)

      const inserted = await db.insert('stores', {
        store_code, store_name,
        region:    region || null,
        is_active: is_active !== false,
        pin_hash:  hashRow.hash
      })
      const s = inserted[0] ?? inserted
      return json({ id: s.id, store_code: s.store_code, store_name: s.store_name, region: s.region, is_active: s.is_active, created_at: s.created_at }, 201)
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
      if (body.is_active  !== undefined) updates.is_active  = !!body.is_active
      if (!Object.keys(updates).length) return err('No editable fields supplied', 400)
      const updated = await db.update('stores', { id: `eq.${id}` }, updates)
      if (!updated.length) return err('Store not found', 404)
      const s = updated[0]
      return json({ id: s.id, store_code: s.store_code, store_name: s.store_name, region: s.region, is_active: s.is_active })
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
      if (!['product', 'barcode'].includes(slot)) return err('slot must be product or barcode', 400)
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(tempId))   return err('Invalid tempId', 400)

      const objectPath = `${tempId}/${slot}.jpg`
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
      if (!/^[a-zA-Z0-9-]{8,64}\/(product|barcode)\.jpg$/.test(objectPath))
        return err('Invalid path', 400)
      const delUrl = `${env.SUPABASE_URL}/storage/v1/object/task-photos/${objectPath}`
      const dRes   = await fetch(delUrl, {
        method:  'DELETE',
        headers: { 'apikey': env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}` }
      })
      if (!dRes.ok && dRes.status !== 404) return err(`Storage delete failed: ${await dRes.text()}`, 500)
      return json({ ok: true })
    }

    // GET /products/lookup
    if (path === '/products/lookup' && method === 'GET') {
      const code = url.searchParams.get('code')
      if (!code) return json(null)
      const rows = await db.select('products', {
        select: 'product_id,description,uom', product_id: `eq.${code}`, limit: '1'
      })
      return json(rows[0] ?? null)
    }

    // ── Task records ──────────────────────────────────────────────────────

    if (path === '/task-records' && method === 'GET') {
      const p = url.searchParams
      const queryStoreId = isBO ? p.get('storeId') : session.storeId
      const taskType     = p.get('task_type')
      const status       = p.get('status')

      const params = {
        select: 'id,task_type,store_id,supplier_id,supplier_name_text,product_code,product_barcode,product_name_label,description,uom,quantity,notes,photo_product_url,photo_barcode_url,details,status,marked_for_deletion,completed_at,store_completed_at,created_at,updated_at',
        order: 'created_at.desc'
      }
      if (queryStoreId && queryStoreId !== 'all') params['store_id']  = `eq.${queryStoreId}`
      if (taskType)                                params['task_type'] = `eq.${taskType}`
      if (status)                                  params['status']    = `eq.${status}`

      const rows = await db.select('task_records', params)
      return json(rows)
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
        select: 'id,task_type,store_id,supplier_id,supplier_name_text,product_code,product_barcode,product_name_label,description,uom,quantity,notes,details,status,created_at',
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
        details:         JSON.stringify(r.details || {}),
        created_at:      r.created_at
      }))

      const cols = ['task_type','store_name','product_code','product_barcode','description','uom','quantity','supplier','notes','status','details','created_at']
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
