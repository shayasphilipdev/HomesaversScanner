/* Homesavers Scanner — service worker
   Strategy:
     /api/*           → never intercept (let the app handle outbox + auth)
     navigation reqs  → stale-while-revalidate against the cached SPA shell
     /assets/*        → cache-first (Vite hashes filenames, so they're immutable)
     everything else  → pass through

   Bump CACHE_VERSION on cache-shape changes to evict old shells. */

const CACHE_VERSION = 'v1'
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

  // SPA shell — stale-while-revalidate.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache  = await caches.open(CACHE_NAME)
      const cached = await cache.match('/')
      const network = fetch('/').then(res => {
        if (res && res.ok) cache.put('/', res.clone())
        return res
      }).catch(() => null)
      return cached || (await network) || new Response('Offline', { status: 503, statusText: 'Offline' })
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
