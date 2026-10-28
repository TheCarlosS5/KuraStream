import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Automated accessibility audit (axe-core, WCAG 2.1 A/AA rules) of the main screens with hermetic API mocks.
// Contrast is reported separately (see the last test): it depends on the theme and is judged by people.
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const show = { id: 'axe-show', title: 'Frieren', synopsis: 'Una maga elfa viaja.', rating: 8.9, year: 2023, genres: 'Fantasía, Aventura', poster_path: '', backdrop_path: '', media_type: 'anime', age_rating: 'TV-14', status: 'finished' };
const episode = { id: 'axe-ep-1', show_id: 'axe-show', season_number: 1, episode_number: 1, title: 'El fin del viaje', synopsis: 'Comienza.', duration: 1440, video_codec: 'h264', container: 'mp4', audio_tracks: [], subtitle_tracks: [] };
const json = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page, { signedIn = true, admin = false } = {}) {
  await page.route('**/api/shows', json([show]));
  await page.route('**/api/shows/axe-show', json({ show, episodes: [episode], seasons: { 1: [episode] } }));
  await page.route('**/api/comments**', json({ success: true, comments: [{ id: 'c1', profile_name: 'Ana', content: 'Genial', created_at: '2026-10-05T10:00:00Z', can_delete: true }] }));
  await page.route('**/api/history/continue**', json([]));
  await page.route('**/api/history**', json([]));
  await page.route('**/api/favorites**', json([]));
  await page.route('**/api/notifications**', json({ success: true, unread_count: 0, notifications: [] }));
  await page.route('**/api/recommendations**', json({ success: true, groups: [] }));
  await page.route('**/api/list-status**', json({ success: true, statuses: {} }));
  await page.route('**/api/ratings**', json({ success: true, ratings: {} }));
  await page.route('**/api/user/**', json({ success: true, stats: { total_time_seconds: 100, watched_episodes: 1, completed_shows: 0, top_genre: 'Fantasía', genres_breakdown: { 'Fantasía': 1 } }, preferences: {}, summary: { year: 2026, episodes_watched: 0 } }));
  await page.route('**/api/profiles**', json({ success: true, profiles: [{ id: 'p1', name: 'Principal', color: '#3b82f6', is_kids: false, has_pin: false }] }));
  await page.route('**/api/admin/users**', json({ success: true, users: [{ username: 'ana', role: 'user', disabled: false, profile_count: 1, created_at: '2026-09-01T10:00:00Z', last_login_at: null, last_watched_at: null }] }));
  await page.route('**/api/admin/**', json({}));
  if (signedIn) {
    await page.addInitScript(({ admin }) => {
      const payload = btoa(JSON.stringify({ username: 'ana', role: admin ? 'admin' : 'user', exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '');
      localStorage.setItem('kurastream_jwt', `e30.${payload}.sig`);
      localStorage.setItem('kurastream_user', JSON.stringify({ username: 'ana', role: admin ? 'admin' : 'user' }));
      localStorage.setItem('kurastream_active_profile', JSON.stringify({ id: 'p1', name: 'Principal', color: '#3b82f6' }));
    }, { admin });
  }
}

async function audit(page, { includeContrast = false } = {}) {
  await page.evaluate(axeSource);
  return page.evaluate(async (includeContrast) => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: includeContrast } },
    });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  }, includeContrast);
}

const SCREENS = [
  ['home', '#/', {}],
  ['show detail', '#/show/axe-show', {}],
  ['settings', '#/settings', {}],
  ['stats', '#/stats', {}],
  ['my list', '#/mylist', {}],
  ['profiles', '#/profiles', {}],
  ['admin: users', '#/admin', { admin: true, click: '.admin-nav-item[data-target="admin-sub-users"]' }],
  ['admin: timings', '#/admin', { admin: true, click: '.admin-nav-item[data-target="admin-sub-timings"]' }],
];

for (const [name, hash, opts] of SCREENS) {
  test(`axe: ${name} has no structural accessibility violations`, async ({ page }) => {
    await mock(page, { admin: Boolean(opts.admin) });
    await page.goto(`/${hash}`);
    await page.waitForTimeout(700);
    if (opts.click) { await page.click(opts.click); await page.waitForTimeout(400); }
    const violations = await audit(page);
    expect(violations, `${name}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
  });
}

test('axe: login and profile dialogs', async ({ page }) => {
  await mock(page, { signedIn: false });
  await page.goto('/');
  await page.click('#btn-login-trigger');
  await page.waitForSelector('#login-modal', { state: 'visible' });
  const violations = await audit(page);
  expect(violations, JSON.stringify(violations, null, 1)).toEqual([]);
});
