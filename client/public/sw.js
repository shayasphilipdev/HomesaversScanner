/* Homesavers Scanner — service worker
   Strategy:
     /api/*           → never intercept (let the app handle outbox + auth)
     navigation reqs  → NETWORK-FIRST against the SPA shell, fall back to
                        cache only when offline. Guarantees an online user
                        always gets the freshest index.html (and therefore
                        the freshest hashed bundle) on the very first load
                        after a deploy — no second reload needed.
     /assets/*        → cache-first (Vite hashes filenames, so they're immutable)
     everything else  → pass through

   Every deploy adds a new set of hashed /assets/ files and nothing removed the
   old ones, so a handheld kept every version it had ever loaded. After an
   online navigation, pruneOldAssets() drops cached assets the live version no
   longer references that were cached more than ASSET_GRACE_MS ago.

   Bump CACHE_VERSION on cache-shape changes to evict old shells. */

const CACHE_VERSION = 'v3'
const CACHE_NAME    = `homesavers-${CACHE_VERSION}`
const SHELL         = ['/', '/manifest.webmanifest']
// A tab still open on the previous version may lazy-load its own chunks; a week
// is far longer than any tab stays open across a deploy.
const ASSET_GRACE_MS = 7 * 86400000
const PRUNE_EVERY_MS = 6 * 3600000
let lastPrune = 0

// Hashed asset files a document mentions, as "/assets/<name>". The shell says
// "/assets/index-Ab12cd.js"; bundles name their lazy chunks "./xlsx-Ab12cd.js".
function assetRefs(text) {
  const out = new Set()
  for (const m of text.matchAll(/(?:\/?assets\/|\.\/)([\w-]+-[\w-]{6,}\.(?:js|css))/g)) out.add('/assets/' + m[1])
  return out
}

async function pruneOldAssets(shellHtml) {
  if (Date.now() - lastPrune < PRUNE_EVERY_MS) return
  const cache = await caches.open(CACHE_NAME)
  const keep = assetRefs(shellHtml)
  // The live version's lazy chunks (e.g. the Excel library) are only named
  // inside its bundles, so wait until those bundles are cached and readable.
  for (const p of keep) if (!(await cache.match(p))) return
  lastPrune = Date.now()
  const queue = [...keep]
  while (queue.length) {
    const res = await cache.match(queue.pop())
    if (!res) continue
    for (const q of assetRefs(await res.text())) {
      if (!keep.has(q)) { keep.add(q); queue.push(q) }
    }
  }
  const now = Date.now()
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname
    if (!path.startsWith('/assets/') || keep.has(path)) continue
    const res = await cache.match(req)
    const cachedAt = Date.parse(res?.headers.get('date') || '')
    // No usable date means the age is unknown: keep it rather than guess.
    if (Number.isFinite(cachedAt) && now - cachedAt > ASSET_GRACE_MS) await cache.delete(req)
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(url) } catch {}
    }))
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Don't touch API calls or third-party origins.
  if (url.pathname.startsWith('/api/')) return
  if (url.origin !== self.location.origin) return

  // SPA shell — network-first. Fetch the live index.html; only fall back to
  // the cached shell if the network is unavailable (genuine offline). This
  // is what stops users being stuck on a stale bundle after a deploy.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        const res = await fetch('/')
        if (res && res.ok) {
          cache.put('/', res.clone())
          // Online with a fresh shell: the moment old versions can be judged.
          // Never allowed to affect the response itself.
          try { event.waitUntil(res.clone().text().then(pruneOldAssets).catch(() => {})) } catch { /* ignore */ }
        }
        return res
      } catch {
        return (await cache.match('/')) || new Response('Offline', { status: 503, statusText: 'Offline' })
      }
    })())
    return
  }

  // Hashed Vite assets — cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(req)
      if (cached) return cached
      try {
        const res = await fetch(req)
        if (res && res.ok) cache.put(req, res.clone())
        return res
      } catch {
        return cached || new Response('Offline', { status: 503 })
      }
    })())
  }
})
