// ============================================================
// DGI Veille - Service Worker
// Cache des assets statiques pour fonctionnement offline
// (les appels API restent online évidemment)
// ============================================================

const CACHE_NAME = 'dgi-veille-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './data/stocks.js',
  './data/asia.js'
];

// Installation : on précache les assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoie les vieux caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch : stratégie network-first pour les APIs, cache-first pour les assets locaux
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Les appels API ne passent pas par le cache (toujours fresh)
  const isApiCall = url.hostname.includes('finance.yahoo.com')
    || url.hostname.includes('finnhub.io')
    || url.hostname.includes('anthropic.com')
    || url.hostname.includes('corsproxy.io')
    || url.hostname.includes('allorigins.win');

  if (isApiCall) {
    // Network only pour les APIs
    return;
  }

  // Cache-first pour le reste (assets statiques)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // Cache la réponse si même origine
        if (res.ok && url.origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
