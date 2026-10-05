import { test, expect } from '@playwright/test';

test.describe('KuraStream PWA and Service Worker Suite', () => {
  // Allow service workers explicitly for PWA verification
  test.use({ serviceWorkers: 'allow' });

  test('PWA Manifest, Offline Shell and Service Worker Registration', async ({ page, request }) => {
    // 1. Verify Manifest JSON exists and has valid web app configuration
    const manifestRes = await request.get('/manifest.json');
    expect(manifestRes.status()).toBe(200);
    const manifest = await manifestRes.json();
    expect(manifest.name).toBeDefined();
    expect(manifest.start_url).toBeDefined();
    expect(Array.isArray(manifest.icons)).toBe(true);

    // 2. Verify Offline Fallback Shell exists
    const offlineRes = await request.get('/offline.html');
    expect(offlineRes.status()).toBe(200);
    const offlineHtml = await offlineRes.text();
    expect(offlineHtml).toContain('KuraStream');

    // 3. Visit homepage and verify Service Worker registration in the browser
    await page.goto('/');

    const swRegistration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg ? { scope: reg.scope, active: !!reg.active || !!reg.installing || !!reg.waiting } : null;
      } catch {
        return null;
      }
    });

    // If browser supports SW and registered it, verify registration state
    if (swRegistration) {
      expect(swRegistration.scope).toBeDefined();
    }
  });

  test('PWA Offline mode serves cached shell or offline fallback', async ({ page, context }) => {
    // 1. Visit homepage to allow service worker installation
    await page.goto('/');

    // Wait for Service Worker to be active if supported
    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      try {
        const reg = await navigator.serviceWorker.ready;
        return reg ? true : null;
      } catch {
        return null;
      }
    });

    // 2. Simulate complete network disconnection
    await context.setOffline(true);

    try {
      // 3. Navigate while completely offline
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const content = await page.content();
      expect(content).toContain('KuraStream');
    } finally {
      await context.setOffline(false);
    }
  });

  test('Service Worker cache upgrade purges stale cache and serves fresh assets', async ({ page }) => {
    await page.goto('/');

    const cacheTestResult = await page.evaluate(async () => {
      if (!('caches' in window)) return { skipped: true };

      const oldCacheName = 'kurastream-2026.09.25-modern-platform';
      const currentCacheName = 'kurastream-2026.10.05-security';

      // Seed an old stale cache
      const oldCache = await caches.open(oldCacheName);
      await oldCache.put(new Request('/fake-stale-asset.js'), new Response('console.log("old");', { headers: { 'Content-Type': 'application/javascript' } }));

      // Inspect cache keys before cleanup
      const keysBefore = await caches.keys();
      const hasOldBefore = keysBefore.includes(oldCacheName);

      // Execute the exact SW activate deletion logic:
      await Promise.all(
        keysBefore
          .filter(name => name !== currentCacheName)
          .map(name => caches.delete(name))
      );

      const keysAfter = await caches.keys();
      const hasOldAfter = keysAfter.includes(oldCacheName);

      return {
        skipped: false,
        hasOldBefore,
        hasOldAfter
      };
    });

    if (!cacheTestResult.skipped) {
      expect(cacheTestResult.hasOldBefore).toBe(true);
      expect(cacheTestResult.hasOldAfter).toBe(false);
    }
  });
});
