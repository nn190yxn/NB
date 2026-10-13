const CACHE_NAME = 'dingweipai-shell-v4'
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
  // 静态资源：先走网络，断了才回缓存。
  // 以前是「缓存优先」——改了代码刷新页面还是拿到旧文件，等于第二台「热更新没生效」的机器；
  // 打包产物虽然带哈希，但桌面端和本机服务都可能同名覆盖，不值得为省一次请求冒这个险。
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone()
      void caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
    }
    return response
  }).catch(() => caches.match(event.request).then(cached => cached || (requestUrl.pathname === '/' ? caches.match('/') : undefined))))
})
