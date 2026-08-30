const CACHE_NAME = 'dingweipai-shell-v3'
const SHELL = ['/', '/manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return
  if (event.request.mode === 'navigate' || requestUrl.pathname === '/') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
      }
      return response
    }).catch(() => caches.match('/')))
    return
  }
  event.respondWith(caches.match(event.request).then(cached => {
    const network = fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
      }
      return response
    })
    if (cached) {
      void network.catch(() => undefined)
      return cached
    }
    return network.catch(() => caches.match('/'))
  }))
})
