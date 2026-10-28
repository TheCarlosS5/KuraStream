import { test, expect } from '@playwright/test';

// Hostile text in every field the API returns (titles, synopsis, genres, cast, comments, notifications, profile
// names, avatar paths...). Nothing may execute and no injected element or inline handler may reach the DOM.
const BREAKOUT = '"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script><svg onload="window.__xss=3">';
const ATTR = '" onmouseover="window.__xss=4" autofocus onfocus="window.__xss=5" x="';
const SHOW_ID = 'xss-show';

const episode = {
  id: 'xss-ep-1', show_id: SHOW_ID, season_number: 1, episode_number: 1, title: BREAKOUT, synopsis: BREAKOUT,
  duration: 1200, thumbnail_path: ATTR, video_codec: 'h264', container: 'mp4', resolution: BREAKOUT,
  audio_tracks: [{ index: 0, track_number: 1, title: BREAKOUT, language: ATTR, codec: 'aac', channels: 2 }],
  subtitle_tracks: [{ index: 0, track_number: 1, title: BREAKOUT, language: ATTR, format: 'ass', is_default: 1 }],
};
const show = {
  id: SHOW_ID, title: BREAKOUT, synopsis: BREAKOUT, rating: 8, year: 2026, genres: `${BREAKOUT}, ${ATTR}`, studio: BREAKOUT,
  director: BREAKOUT, writer: BREAKOUT, poster_path: ATTR, backdrop_path: ATTR, media_type: 'anime', age_rating: BREAKOUT,
  status: 'airing', trailer_key: ATTR, cast_members: JSON.stringify([{ name: BREAKOUT, character: BREAKOUT, profile_path: ATTR }]),
};

test('hostile API data never executes', async ({ page }) => {
  const violations = [];
  page.on('console', (msg) => { if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text()); });
  page.on('dialog', (dialog) => { violations.push(`dialog: ${dialog.message()}`); dialog.dismiss(); });

  const json = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/shows', json([show]));
  await page.route(`**/api/shows/${SHOW_ID}`, json({ show, episodes: [episode], seasons: { 1: [episode] } }));
  await page.route('**/api/episodes/**', json({ ...episode, show_title: BREAKOUT }));
  await page.route('**/api/comments**', json({ success: true, comments: [
    { id: 'c1', profile_name: BREAKOUT, content: BREAKOUT, created_at: '2026-10-05T10:00:00Z', avatar: ATTR, avatar_color: ATTR, can_delete: true },
  ] }));
  await page.route('**/api/notifications**', json({ success: true, unread_count: 1, notifications: [
    { id: 'n1', title: BREAKOUT, message: BREAKOUT, show_id: SHOW_ID, episode_id: episode.id, created_at: '2026-10-05T10:00:00Z', is_unread: true },
  ] }));
  await page.route('**/api/history/continue**', json([{ episode_id: episode.id, show_id: SHOW_ID, show_title: BREAKOUT, episode_title: BREAKOUT, season_number: 1, episode_number: 1, progress_seconds: 100, duration: 1200, thumbnail_path: ATTR, poster_path: ATTR, backdrop_path: ATTR }]));
  await page.route('**/api/history**', json([]));
  await page.route('**/api/favorites**', json([]));
  await page.route('**/api/recommendations**', json({ success: true, groups: [{ because: { id: SHOW_ID, title: BREAKOUT }, shows: [show, show, show] }] }));
  await page.route('**/api/profiles**', json({ success: true, profiles: [{ id: 'p1', name: BREAKOUT, color: ATTR, avatar: ATTR, is_kids: 0 }] }));
  await page.route('**/api/user/**', json({ success: true, stats: { total_time_seconds: 5, genres_breakdown: { [BREAKOUT]: 3 }, top_genre: BREAKOUT }, summary: { year: 2026, episodes_watched: 1, shows_watched: 1, total_time_seconds: 5, top_shows: [{ id: SHOW_ID, title: BREAKOUT, episodes: 1 }], top_genre: BREAKOUT, busiest_month: 10 }, preferences: {} }));
  await page.route('**/api/calendar**', json({ Monday: [{ title: BREAKOUT, episode: 1, airing_at: 0 }] }));

  // Pretend to be signed in so the profile-aware views load
  await page.addInitScript(({ profile }) => {
    try {
      const payload = btoa(JSON.stringify({ username: 'u', role: 'user', exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '');
      localStorage.setItem('kurastream_jwt', `e30.${payload}.sig`);
      localStorage.setItem('kurastream_user', JSON.stringify({ username: profile, role: 'user' }));
      localStorage.setItem('kurastream_active_profile', JSON.stringify({ id: 'p1', name: profile, color: '#3b82f6' }));
    } catch { /* storage unavailable */ }
  }, { profile: BREAKOUT });

  // The views must really have rendered the hostile text (as text): otherwise this test would prove nothing
  const rendered = {};
  for (const hash of ['#/', `#/show/${SHOW_ID}`, '#/history', '#/mylist', '#/stats', '#/calendar', '#/profiles', `#/player/${episode.id}`]) {
    await page.goto(`/${hash}`);
    await page.waitForTimeout(500);
    rendered[hash] = await page.locator('body').innerText();
    if (hash.startsWith('#/show/')) {
      await page.locator('.comment-delete-btn, #comments-list').first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
    }
  }
  await page.goto('/#/');
  await page.waitForTimeout(500);
  // Open the notification list too
  await page.locator('#notification-bell, #btn-notifications, [aria-label*="otificaciones"]').first().click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    xss: window.__xss,
    inlineHandlers: [...document.querySelectorAll('*')]
      .filter((el) => [...el.attributes].some((a) => a.name.startsWith('on')))
      .map((el) => `${el.tagName.toLowerCase()}[${[...el.attributes].filter((a) => a.name.startsWith('on')).map((a) => a.name).join(',')}]`),
    inlineScripts: document.querySelectorAll('script:not([src])').length,
    injectedImages: [...document.querySelectorAll('img')].filter((img) => (img.getAttribute('src') || '') === 'x').length,
  }));

  expect(rendered['#/'], 'home shows the payload as text').toContain('onerror="window.__xss=1"');
  expect(rendered[`#/show/${SHOW_ID}`], 'detail page shows the payload as text').toContain('onerror="window.__xss=1"');
  expect(result.xss, 'no payload may execute').toBeUndefined();
  expect(result.inlineHandlers, 'no element may carry an inline event handler').toEqual([]);
  expect(result.inlineScripts, 'no injected or inline <script>').toBe(0);
  expect(result.injectedImages, 'no <img src=x> from a payload').toBe(0);
  expect(violations.filter((v) => v.startsWith('dialog')), 'no alert/confirm from a payload').toEqual([]);
});
