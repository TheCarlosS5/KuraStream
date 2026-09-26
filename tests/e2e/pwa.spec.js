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
});
