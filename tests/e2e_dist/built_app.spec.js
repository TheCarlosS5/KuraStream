import { test, expect } from '@playwright/test';

// Requires `npm run build` first (npm run test:e2e:dist does both).

test('the built app boots: hashed bundles load, icons render, no errors in the console', async ({ page }) => {
  const problems = [];
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });
  page.on('pageerror', (error) => problems.push(String(error)));
  const failed = [];
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().includes('/api/')) failed.push(`${res.status()} ${res.url()}`); });

  await page.goto('/');
  await expect(page.locator('.app-header')).toBeVisible();
  // Only the built page references /dist/; a source page would list /js/main.js.
  const scripts = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')));
  expect(scripts.some((src) => /^\/dist\/main-[A-Za-z0-9]{8}\.js$/.test(src))).toBeTruthy();
  expect(scripts.some((src) => src.includes('/js/main.js'))).toBeFalsy();

  // Icons: the Lucide subset replaced the <i data-lucide> placeholders with inline SVG.
  await expect.poll(async () => page.locator('.app-header svg.lucide').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => typeof window.lucide.createIcons)).toBe('function');

  expect(failed, `failed requests: ${failed.join(', ')}`).toEqual([]);
  expect(problems.filter((p) => !/debug-log|401|Failed to load resource/.test(p)), problems.join('\n')).toEqual([]);
});

test('hashed files are cached forever and the page itself is revalidated', async ({ request }) => {
  const page = await request.get('/');
  expect(page.headers()['cache-control']).toContain('no-cache');
  const html = await page.text();
  const main = html.match(/\/dist\/main-[A-Za-z0-9]{8}\.js/)[0];
  const asset = await request.get(main);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['cache-control']).toContain('immutable');
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain(main);
  expect(sw.headers()['service-worker-allowed']).toBe('/');
});

test('the admin panel chunk is only requested when it is needed', async ({ page }) => {
  const chunks = [];
  page.on('request', (req) => { if (req.url().includes('admin_sidebar-')) chunks.push(req.url()); });
  await page.goto('/');
  await expect(page.locator('.app-header')).toBeVisible();
  expect(chunks).toEqual([]);
});
