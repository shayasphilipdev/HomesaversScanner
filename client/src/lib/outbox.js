// Offline outbox backed by IndexedDB.
//
// Two record kinds:
//   { kind: 'simple',      body }                — plain POST /task-records
//   { kind: 'with_photos', body, photos:{product, barcode} } — Task B
//
// All records carry a client-generated `id` (uuid) used both as the IDB key
// and as the photo-storage namespace, so retries don't double-write photos.
//
// Drain sequence is best-effort, in arrival order. Failures stay in the
// queue and are retried next time the app comes online.

import { getToken } from './api.js'

const DB_NAME = 'hs_outbox'
const STORE   = 'requests'
const VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx(db, mode = 'readonly') {
  const t = db.transaction(STORE, mode)
  return { store: t.objectStore(STORE), done: new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error) }) }
}

function newId() {
  return (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function notifyChanged() {
  window.dispatchEvent(new Event('hs:outbox-changed'))
}

export async function add(record) {
  const id = record.id || newId()
  const db = await openDB()
  const { store, done } = tx(db, 'readwrite')
  store.add({ id, createdAt: Date.now(), attempts: 0, ...record })
  await done
  notifyChanged()
  return id
}

export async function getAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt))
    req.onerror   = () => reject(req.error)
  })
}

export async function count() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export async function remove(id) {
  const db = await openDB()
  const { store, done } = tx(db, 'readwrite')
  store.delete(id)
  await done
  notifyChanged()
}

// Server-side failure: bump the attempt counter and (after the cap) mark
// the item as 'failed' so the auto-drain stops trying it. The user can
// reset and retry by tapping the offline pill — see resetFailed() below.
const MAX_ATTEMPTS = 5

async function bump(id) {
  const db = await openDB()
  const { store, done } = tx(db, 'readwrite')
  const get = store.get(id)
  await new Promise(res => { get.onsuccess = () => res() })
  const rec = get.result
  if (rec) {
    rec.attempts = (rec.attempts || 0) + 1
    if (rec.attempts >= MAX_ATTEMPTS) rec.status = 'failed'
    store.put(rec)
  }
  await done
}

export async function resetFailed() {
  const db = await openDB()
  const all = await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  const stuck = all.filter(r => r.status === 'failed')
  if (!stuck.length) return 0
  const { store, done } = tx(db, 'readwrite')
  for (const r of stuck) {
    r.status   = undefined
    r.attempts = 0
    store.put(r)
  }
  await done
  notifyChanged()
  return stuck.length
}

export async function failedCount() {
  const all = await getAll()
  return all.filter(r => r.status === 'failed').length
}

// Clear the failed flag on a single record so the next drain picks it
// back up. Used by the Sync inspector's per-row "Retry" button.
export async function markRetry(id) {
  const db = await openDB()
  const { store, done } = tx(db, 'readwrite')
  const get = store.get(id)
  await new Promise(res => { get.onsuccess = () => res() })
  const rec = get.result
  if (rec) {
    rec.status   = undefined
    rec.attempts = 0
    store.put(rec)
  }
  await done
  notifyChanged()
}

// ── Sync ────────────────────────────────────────────────────────────────────

async function uploadPhotoRaw(blob, slot, tempId, token) {
  const fd = new FormData()
  fd.append('file', blob, `${slot}.jpg`)
  fd.append('slot', slot)
  fd.append('tempId', tempId)
  const res = await fetch('/api/photos/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  })
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`)
  return res.json()
}

async function postRecord(body, token) {
  const res = await fetch('/api/task-records', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Record save failed (${res.status})`)
  return res.json()
}

let _draining = false

export async function drain() {
  if (_draining) return { synced: 0, failed: 0, skipped: true }
  _draining = true
  try {
    const token = getToken()
    if (!token) return { synced: 0, failed: 0, noToken: true }
    if (!navigator.onLine) return { synced: 0, failed: 0, offline: true }

    const items = await getAll()
    let synced = 0, failed = 0, skipped = 0

    for (const item of items) {
      // Honour the failed flag — these are dead-letter until the user
      // taps the pill (resetFailed) or removes them.
      if (item.status === 'failed') { skipped++; continue }

      try {
        if (item.kind === 'with_photos' && item.photos) {
          const { product, barcode } = item.photos
          const p = await uploadPhotoRaw(product, 'product', item.id, token)
          const b = await uploadPhotoRaw(barcode, 'barcode', item.id, token)
          await postRecord({ ...item.body, photo_product_url: p.url, photo_barcode_url: b.url }, token)
        } else {
          await postRecord(item.body, token)
        }
        await remove(item.id)
        synced++
      } catch (e) {
        failed++
        if (isOfflineError(e) || !navigator.onLine) {
          // Pure network failure — leave the item untouched and stop the
          // drain. We'll try again on the next online / visibility event.
          break
        }
        // Server-side error: it counts against this record's attempts.
        await bump(item.id)
      }
    }
    if (synced) notifyChanged()
    return { synced, failed, skipped }
  } finally {
    _draining = false
  }
}

// Convenience to detect a fetch network failure raised by our api.request().
export function isOfflineError(err) {
  if (!err) return false
  if (!navigator.onLine) return true
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  return /network error|failed to fetch|networkerror|load failed/.test(msg)
}
