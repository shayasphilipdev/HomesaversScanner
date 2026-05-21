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

   Bump CACHE_VERSION on cache-shape changes to evict old shells. */

const CACHE_VERSION = 'v2'
const CACHE_NAME    = `homesavers-${CACHE_VERSION}`
const SHELL         = ['/', '/manifest.webmanifest']

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
        if (res && res.ok) cache.put('/', res.clone())
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
