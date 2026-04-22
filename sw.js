const VERSION = '2';
const SHELL_CACHE = 'jigsaw-shell-v' + VERSION;
const IMG_CACHE = 'jigsaw-images';
const API_CACHE = 'jigsaw-api';
const FONT_CACHE = 'jigsaw-fonts';

const SHELL_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/game.js',
  '/js/sounds.js',
  '/js/scoring.js',
  '/js/identity.js',
  '/js/leaderboard.js',
  '/js/fakename.js',
  '/js/vendor/vue.global.prod.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('jigsaw-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/images/')) {
    e.respondWith(cacheFirst(e.request, IMG_CACHE));
    return;
  }

  if (url.pathname === '/api/packs') {
    e.respondWith(networkFirst(e.request, API_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(staleWhileRevalidate(e.request, FONT_CACHE));
    return;
  }

  if (e.request.destination === 'document' || url.pathname.match(/\.(js|css|json)$/) || SHELL_URLS.includes(url.pathname)) {
    e.respondWith(staleWhileRevalidate(e.request, SHELL_CACHE));
    return;
  }
});

self.addEventListener('message', e => {
  if (e.data?.type === 'cache-urls') {
    const { urls, id } = e.data;
    cacheUrls(urls, id, e.source);
  }
  if (e.data?.type === 'query-cached') {
    const { urls } = e.data;
    queryCached(urls, e.source);
  }
});

async function cacheUrls(urls, id, client) {
  const cache = await caches.open(IMG_CACHE);
  let done = 0;
  for (const url of urls) {
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      }
    } catch { /* skip failed */ }
    done++;
    if (done % 5 === 0 || done === urls.length) {
      client.postMessage({ type: 'cache-progress', id, done, total: urls.length });
    }
  }
}

async function queryCached(urls, client) {
  const cache = await caches.open(IMG_CACHE);
  const cached = [];
  for (const url of urls) {
    if (await cache.match(url)) cached.push(url);
  }
  client.postMessage({ type: 'query-cached-result', cached });
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
