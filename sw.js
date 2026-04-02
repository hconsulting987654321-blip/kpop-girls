const CACHE_NAME = 'kpop-v2';

const ASSETS = [
  './',
  './index.html',
  './dance.html',
  './stars.html',
  './memory.html',
  './quiz.html',
  './habillage.html',
  './avatar.html',
  './carte.html',
  './karaoke.html',
  './coloriage.html',
  './puzzle.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700;800&display=swap'
];

// Install: cache all core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first, then network (and update cache in background)
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      // Return cached version immediately if available
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Update cache in background with fresh version
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed, return nothing (cached version already served)
      });

      return cached || fetchPromise;
    })
  );
});
