const CACHE_NAME = 'kurastream-2026.10.05-security-v1';
// @@SHELL_ASSETS_START (scripts/build.mjs replaces this list with the hashed build files)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/style.css?v=2026.10.05-security',
  '/css/fonts.css',
  '/assets/fonts/inter-latin-300-700.woff2',
  '/assets/fonts/outfit-latin-400-800.woff2',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/catalog.css',
  '/css/player.css',
  '/css/admin.css',
  '/css/responsive.css',
  '/assets/illustrations/poster_placeholder.svg',
  '/assets/illustrations/backdrop_placeholder.svg',
  '/assets/illustrations/empty_watchlist.svg',
  '/assets/illustrations/empty_history.svg',
  '/assets/illustrations/empty_search.svg',
  '/assets/branding/brand_mark.svg',
  '/js/main.js',
  '/js/main.js?v=2026.10.05-security',
  '/player.js',
  '/player.js?v=2026.10.05-security',
  '/js/core/router.js',
  '/js/core/auth.js',
  '/js/core/api.js',
  '/js/core/state.js',
  '/js/core/ui.js',
  '/js/core/icons.js',
  '/js/core/http.js',
  '/js/core/dialogs.js',
  '/js/boot/perf_mode.js',
  '/js/boot/error_log.js',
  '/js/boot/sw_register.js',
  '/js/modules/admin_sidebar.js',
  '/js/player/tracks.js',
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
  '/js/modules/app_download.js',
  '/js/modules/card_popover_preview.js',
  '/js/modules/hero_carousel.js',
  '/js/modules/player_scrub_preview.js',
  '/js/modules/player_tracks_modal.js',
  '/js/modules/player_audio_enhancer.js',
  '/vendor/lucide/lucide.min.js',
  '/manifest.json',
  '/offline.html'
];
// @@SHELL_ASSETS_END


// Runtime entries (posters, avatars) beyond the shell are kept to a bounded number so the cache cannot grow forever.
const MAX_RUNTIME_ENTRIES = 400;

async function trimRuntimeCache(cache) {
  const shell = new Set(SHELL_ASSETS.map((asset) => new URL(asset, self.location.origin).href));
  const runtime = (await cache.keys()).filter((request) => !shell.has(request.url));
  for (const request of runtime.slice(0, Math.max(0, runtime.length - MAX_RUNTIME_ENTRIES))) {
    await cache.delete(request);
  }
}

function putInCache(request, response, { trim = false } = {}) {
  if (!response || response.status !== 200) return Promise.resolve();
  const copy = response.clone();
  return caches.open(CACHE_NAME).then(async (cache) => {
    await cache.put(request, copy);
    if (trim) await trimRuntimeCache(cache);
  });
}

self.addEventListener('install', (event) => {
  // Each asset on its own: one missing file must not leave the whole shell uncached (addAll is all-or-nothing).
  // No skipWaiting here: the page shows "new version available" and asks the worker to take over (see 'message'),
  // so a tab never ends up with half of one version and half of another.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_ASSETS.map(async (asset) => {
        try {
          await cache.add(new Request(new URL(asset, self.location.origin), { cache: 'reload' }));
        } catch (err) {
          console.warn('[SW] Could not precache', asset, err);
        }
      }))
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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

  // Only this site's own files. Posters from TMDB/AniList and web fonts are not ours to cache (opaque responses
  // cannot be inspected, and a failed cross-origin fetch used to be answered with nothing at all).
  if (url.origin !== self.location.origin) {
    return;
  }

  // Strictly ignore video stream URLs, downloads, range requests, media files, and real-time SSE watch party
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('.mkv') ||
    url.pathname.endsWith('.mp4') ||
    url.pathname.endsWith('.webm') ||
    event.request.headers.has('range') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // The page: always the network first (it names the current script versions), the cached shell when offline.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          event.waitUntil(putInCache(event.request, networkResponse));
          return networkResponse;
        })
        .catch(async () => {
          // SPA: any offline navigation can be served by the cached shell before giving up.
          return (await caches.match(event.request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/')) ||
            caches.match('/offline.html');
        })
    );
    return;
  }

  // Hashed build files (/dist/): the name changes with the content, so a cached copy is always right.
  if (url.pathname.startsWith('/dist/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          event.waitUntil(putInCache(event.request, networkResponse));
          return networkResponse;
        });
      })
    );
    return;
  }

  // Scripts and styles that are not hashed (running from the sources): network first, so a deploy is never mixed
  // with older copies of its modules; the cache is only the offline fallback.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          event.waitUntil(putInCache(event.request, networkResponse));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Images, icons and the like: stale-while-revalidate with a bounded runtime cache.
  const isStaticAsset = url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.jpeg') ||
                        url.pathname.endsWith('.webp') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.woff2') ||
                        url.pathname.endsWith('.json') || url.pathname.endsWith('.ico');
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          event.waitUntil(putInCache(event.request, networkResponse, { trim: true }));
          return networkResponse;
        }).catch(() => cachedResponse);
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
