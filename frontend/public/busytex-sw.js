// Service Worker (runs in ServiceWorkerGlobalScope: `self`, `caches`, `clients` are ambient globals).
// Persistently caches the LaTeX engine assets (texlyre-busytex WASM + TeX Live `.data`
// collections, ~120 MB) in Cache Storage. Unlike the HTTP cache, Cache Storage survives HARD reloads and
// dev reloads (where Vite serves public/ without immutable headers), so the engine boots without
// re-downloading ~120 MB every time.
//
// Engine-agnostic by design (§3.14): it matches by URL path (/assets/busytex/*), independent of which TeX
// engine ships there — so swapping texlyre-busytex → MIT busytex needs no change here. Only those assets
// are touched; every other request (app shell, Supabase, HMR, …) passes straight through to the network.

const CACHE = 'astronote-busytex-assets-v1'
const PREFIX = '/assets/busytex/'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop superseded cache versions so a bumped CACHE name reclaims space.
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith('astronote-busytex-assets-') && k !== CACHE).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Only same-origin busytex assets, GET only. Everything else uses default network handling.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return
  event.respondWith(cacheFirst(request))
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  // Only persist complete, OK responses — skip 206 range/opaque/errors so we never cache a partial.
  if (response.ok && response.status === 200) {
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}
