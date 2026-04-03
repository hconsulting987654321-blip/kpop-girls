const CACHE_NAME = 'kpop-v3';

const CORE_ASSETS = [
  './',
  './index.html',
  './landing.html',
  './splash.html',
  './achievements.html',
  './parents.html',
  './mentions.html',
  // 15 game pages
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
  './course.html',
  './studio.html',
  './defile.html',
  './pet.html',
  './photobooth.html',
  // Assets
  './manifest.json',
  './favicon.svg',
  './icon-192.svg',
  './icon-512.svg'
];

const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700;800&display=swap'
];

// Install: cache all core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache core assets (local files - must all succeed)
      await cache.addAll(CORE_ASSETS);
      // Cache fonts separately (external - don't fail install if unavailable)
      for (const url of FONT_URLS) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('Font cache skipped:', url, e);
        }
      }
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

// Fetch strategies
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Google Fonts: cache-first (they rarely change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // Local HTML files: cache-first for fast offline, update in background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        // Fire network request in background to update cache
        const networkFetch = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => null);

        // Return cached immediately if available, else wait for network
        if (cached) return cached;

        return networkFetch.then(response => {
          if (response) return response;
          // Offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cached => {
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
