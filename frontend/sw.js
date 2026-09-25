const CACHE_NAME = 'kurastream-2026.09.25-modern-platform';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/style.css?v=2026.09.25-modern-platform',
  '/js/main.js',
  '/js/main.js?v=2026.09.25-modern-platform',
  '/player.js',
  '/player.js?v=2026.09.25-modern-platform',
  '/js/core/router.js',
  '/js/core/auth.js',
  '/js/core/api.js',
  '/js/core/state.js',
  '/js/features/player/player_controller.js',
  '/js/features/player/qr_generator.js',
  '/js/modules/navigation.js',
  '/js/modules/party.js',
  '/js/modules/auth.js',
  '/js/modules/admin_status.js',
  '/js/modules/admin_staging.js',
  '/js/modules/admin_library.js',
  '/js/modules/admin_import.js',
  '/js/modules/admin_console.js',
  '/js/modules/catalog.js',
  '/js/modules/card_popover_preview.js',
  '/js/modules/hero_ambient_glow.js',
  '/js/modules/catalog_episode_tracker.js',
  '/js/modules/player_scrub_preview.js',
  '/js/modules/player_tracks_modal.js',
  '/js/modules/player_audio_enhancer.js',
  '/js/modules/player_shortcuts_hud.js',
  '/js/modules/player_smart_skip.js',
  '/vendor/lucide/lucide.min.js',
  '/manifest.json',
  '/offline.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const requests = SHELL_ASSETS.map(asset => new Request(new URL(asset, self.location.origin), { cache: 'reload' }));
      return cache.addAll(requests).catch((err) => {
        console.warn('[SW] Pre-caching shell assets non-fatal error:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strictly ignore video stream URLs, downloads, range requests, media files, and real-time SSE watch party
  if (
    url.pathname.startsWith('/api/stream') ||
    url.pathname.startsWith('/api/party') ||
    url.pathname.endsWith('.mkv') ||
    url.pathname.endsWith('.mp4') ||
    url.pathname.endsWith('.webm') ||
    event.request.headers.has('range') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Cache-first strategy for app shell assets
  const isShellAsset = SHELL_ASSETS.some((asset) => {
    return url.pathname === asset || (asset === '/' && (url.pathname === '' || url.pathname === '/'));
  }) || url.pathname.startsWith('/assets/branding/');

  if (isShellAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Revalidate cache in background
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const copy = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate for other static assets
  const isStaticAsset = url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || 
                        url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || 
                        url.pathname.endsWith('.svg') || url.pathname.endsWith('.woff2');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        }).catch(() => {});
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Network-first with offline fallback for navigation
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
      })
  );
});
self.addEventListener('notificationclick', (event) => { event.notification.close(); event.waitUntil(clients.matchAll({ type: 'window' }).then((clientList) => { for (const client of clientList) { if (client.url === '/' && 'focus' in client) return client.focus(); } if (clients.openWindow) return clients.openWindow('/'); })); });
