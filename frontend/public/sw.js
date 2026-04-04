const CACHE_NAME = 'taki-pos-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest']
const API_PREFIXES = [
  '/auth',
  '/tables',
  '/orders',
  '/kitchen',
  '/cash',
  '/cash-register',
  '/kpis',
  '/menu',
  '/catalog',
  '/customers',
  '/finance',
  '/inventory',
  '/salons',
  '/admin',
  '/bills',
]
const STATIC_DESTINATIONS = new Set(['style', 'script', 'worker', 'image', 'font'])

function isCacheableResponse(response) {
  return response && response.ok && response.type !== 'opaque'
}

function isBackendRequest(requestUrl, request) {
  if (request.headers.has('Authorization') || request.headers.has('X-QR-Token')) {
    return true
  }

  if (requestUrl.origin !== self.location.origin) {
    return true
  }

  return API_PREFIXES.some((prefix) => requestUrl.pathname.startsWith(prefix))
}

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_NAME)

  try {
    const response = await fetch(request)
    if (isCacheableResponse(response)) {
      await cache.put('/index.html', response.clone())
    }
    return response
  } catch {
    const cached = await cache.match('/index.html')
    if (cached) return cached
    throw new Error('offline')
  }
}

async function staleWhileRevalidateAsset(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => cached)

  return cached || networkPromise
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)

  if (isBackendRequest(requestUrl, event.request)) {
    event.respondWith(fetch(event.request))
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event.request))
    return
  }

  if (
    requestUrl.origin === self.location.origin &&
    (STATIC_DESTINATIONS.has(event.request.destination) || requestUrl.pathname === '/manifest.webmanifest')
  ) {
    event.respondWith(staleWhileRevalidateAsset(event.request))
  }
})
