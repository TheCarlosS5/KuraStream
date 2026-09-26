import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const phase = process.argv[2] || 'before';
const outDir = path.resolve('.artifacts/ui-audit', phase);
fs.mkdirSync(outDir, { recursive: true });

const mockShow = {
  id: 'frieren-beyond-journeys-end',
  title: "Frieren: Beyond Journey's End",
  year: 2023,
  rating: 9.1,
  genres: 'Aventura, Fantasía, Drama',
  synopsis: 'El viaje de la maga elfa Frieren tras derrotar al Rey Demonio explorando el paso del tiempo y las conexiones humanas.',
  poster_path: '/assets/illustrations/poster_placeholder.svg',
  backdrop_path: '/assets/illustrations/backdrop_placeholder.svg',
  is_featured: 1,
  status: 'airing'
};

const mockEpisode = {
  id: 'frieren-beyond-journeys-end_S1_E1',
  show_id: 'frieren-beyond-journeys-end',
  season_number: 1,
  episode_number: 1,
  title: 'El final del viaje',
  synopsis: 'La era de paz ha comenzado, pero para Frieren el tiempo corre de manera distinta.',
  thumbnail_path: '/assets/illustrations/backdrop_placeholder.svg',
  duration: 1440,
  stream_url: '/api/stream/frieren-beyond-journeys-end_S1_E1',
  audio_tracks: [{ id: '1', language: 'Japonés', label: 'Japonés (Original)', is_default: true }],
  subtitle_tracks: [{ id: '1', language: 'Español', label: 'Español (Latinoamérica)', is_default: true }]
};

async function setupMocks(page) {
  await page.route('**/api/shows', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mockShow]) })
  );
  await page.route('**/api/shows/frieren-beyond-journeys-end', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        show: mockShow,
        episodes: [mockEpisode],
        seasons: { '1': [mockEpisode] }
      })
    })
  );
  await page.route('**/api/episodes/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...mockEpisode, show_title: "Frieren: Beyond Journey's End" })
    })
  );
  await page.route('**/api/stream/**', route =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('') })
  );
  await page.route('**/api/progress/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ progress: 120, completed: false }) })
  );
  await page.route('**/api/history**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ ...mockEpisode, show_title: "Frieren: Beyond Journey's End", updated_at: '2026-09-26 12:00:00' }])
    })
  );
  await page.route('**/api/favorites**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mockShow]) })
  );
  await page.route('**/api/notifications**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/api/user/profiles**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, profiles: [] }) })
  );
  await page.route('**/api/profiles', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        profiles: [
          { id: 'prof-1', name: 'Principal', is_kids: 0, color: '#818CF8' },
          { id: 'prof-2', name: 'Kids', is_kids: 1, color: '#35D39A' }
        ]
      })
    })
  );
  await page.route('**/api/user/preferences**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, preferences: { auto_skip_intro: 1, auto_play_next: 1 } })
    })
  );
  await page.route('**/api/calendar**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        Monday: [mockShow],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
        Sunday: []
      })
    })
  );
  await page.route('**/api/user/stats**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        stats: {
          total_time_seconds: 7200,
          completed_shows: 2,
          watched_episodes: 5,
          top_genre: 'Fantasía'
        }
      })
    })
  );
  await page.route('**/api/admin/stats', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        showsCount: 12,
        episodesCount: 148,
        librarySizeFormatted: '184.5 GB',
        totalHours: 74,
        diskInfo: { percent: 45, usedFormatted: '450 GB', totalFormatted: '1000 GB' }
      })
    })
  );
  await page.route('**/api/admin/staged', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, raw_title: '[SubsPlease] Frieren - 28 [1080p].mkv', file_path: '/staging/[SubsPlease] Frieren - 28.mkv', clean_title: 'Frieren: Beyond Journey\'s End', source_info: 'Torrents' }
      ])
    })
  );
  await page.route('**/api/admin/system-logs**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        logs: [
          '[2026-09-26 12:00:00] [INFO] Library scan initiated.',
          '[2026-09-26 12:00:05] [INFO] 148 episodes verified with valid fingerprints.',
          '[2026-09-26 12:00:10] [INFO] KuraStream 2.0 system healthy.'
        ]
      })
    })
  );
  await page.route('**/api/admin/status**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ display: 'on' }) })
  );
  await page.route('**/api/comments**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/api/debug-log**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  );
}

async function captureAll() {
  let serverProcess = null;
  try {
    await fetch('http://127.0.0.1:3000/');
  } catch {
    console.log('Starting PHP router server on 127.0.0.1:3000...');
    serverProcess = spawn('php', ['-S', '127.0.0.1:3000', 'php_backend/router.php'], {
      stdio: 'ignore'
    });
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        await fetch('http://127.0.0.1:3000/');
        break;
      } catch {}
    }
  }

  const browser = await chromium.launch({ headless: true });

  // 1. Desktop context
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block'
  });
  const page = await desktopContext.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERR:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE UNCAUGHT:', err.message));
  await setupMocks(page);

  // 1. Logged-out Home (1440x900)
  await page.goto('http://127.0.0.1:3000/#/');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '01_logged_out_home_1440x900.png') });

  // 2. Login Modal (1440x900)
  const loginBtn = page.locator('#btn-login-trigger');
  if (await loginBtn.isVisible()) {
    await loginBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '02_login_modal_1440x900.png') });
  }

  // 3. Register Tab / Modal
  const regTab = page.locator('#tab-register');
  if (await regTab.isVisible()) {
    await regTab.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '03_register_modal_1440x900.png') });
  }

  // Close login modal if open
  const cancelLogin = page.locator('#login-modal-cancel');
  if (await cancelLogin.isVisible()) {
    await cancelLogin.click();
    await page.waitForTimeout(200);
  }

  // 4. Profile Selector
  await page.goto('http://127.0.0.1:3000/#/profiles');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '04_profile_selector_1440x900.png') });

  // Simulate Authenticated User with profile
  await page.evaluate(() => {
    localStorage.setItem('kurastream_jwt', 'mock_jwt_token_for_user');
    localStorage.setItem('kurastream_user', JSON.stringify({ username: 'CarlosUser', role: 'user' }));
    localStorage.setItem('kurastream_active_profile', JSON.stringify({ id: 'prof-1', name: 'Principal', is_kids: 0, color: '#FF6B2C' }));
  });

  // 5. Authenticated Home
  await page.goto('http://127.0.0.1:3000/#/');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '05_authenticated_home_1440x900.png') });

  // 6. Movies View
  await page.goto('http://127.0.0.1:3000/#/movies');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '06_movies_1440x900.png') });

  // 7. Genres View
  await page.goto('http://127.0.0.1:3000/#/genres');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '07_genres_1440x900.png') });

  // 8. My List
  await page.goto('http://127.0.0.1:3000/#/my-list');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '08_my_list_1440x900.png') });

  // 9. History
  await page.goto('http://127.0.0.1:3000/#/history');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '09_history_1440x900.png') });

  // 10. Show Detail View
  await page.goto('http://127.0.0.1:3000/#/show/frieren-beyond-journeys-end');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '10_show_detail_1440x900.png') });

  // 11. Settings
  await page.goto('http://127.0.0.1:3000/#/settings');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '11_settings_1440x900.png') });

  // 12. Stats
  await page.goto('http://127.0.0.1:3000/#/stats');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '12_stats_1440x900.png') });

  // 13. Watch Party Modal
  await page.goto('http://127.0.0.1:3000/#/');
  const partyNav = page.locator('#nav-party');
  if (await partyNav.isVisible()) {
    try {
      await partyNav.click({ timeout: 2000 });
    } catch {
      await page.evaluate(() => document.getElementById('nav-party')?.click());
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '13_watch_party_modal_1440x900.png') });
    await page.evaluate(() => {
      const m = document.getElementById('modal-watch-party');
      if (m) m.style.display = 'none';
    });
  }

  // 14. Player paused with controls
  await page.goto('http://127.0.0.1:3000/#/player/frieren-beyond-journeys-end_S1_E1');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const errOverlay = document.getElementById('player-error-overlay');
    if (errOverlay) errOverlay.style.display = 'none';
    const overlay = document.querySelector('.player-controls-overlay');
    if (overlay) {
      overlay.classList.remove('hide');
      overlay.style.opacity = '1';
      overlay.style.visibility = 'visible';
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '14_player_paused_1440x900.png') });

  // 15. Player Track Menu
  await page.evaluate(() => {
    const btn = document.getElementById('player-tracks-btn');
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '15_player_track_menu_1440x900.png') });
  await page.evaluate(() => {
    const closeBtn = document.querySelector('.tracks-modal-close');
    if (closeBtn) closeBtn.click();
    const modal = document.querySelector('.tracks-modal-container');
    if (modal) modal.classList.remove('is-open');
  });

  // 16. Admin Access Login Modal
  await page.goto('http://127.0.0.1:3000/#/');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('admin');
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, '16_admin_access_login_1440x900.png') });
  await page.evaluate(() => {
    if (typeof window.closeAuthModal === 'function') {
      window.closeAuthModal();
    }
  });

  // 17. Admin Overview (simulate admin logged in)
  await page.evaluate(() => {
    localStorage.setItem('kurastream_jwt', 'mock_admin_jwt');
    localStorage.setItem('kurastream_user', JSON.stringify({ username: 'admin', role: 'admin' }));
  });

  // 17. Admin Overview
  await page.goto('http://127.0.0.1:3000/#/admin');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '17_admin_overview_1440x900.png') });

  // 18. Admin Import
  const tabImport = page.locator('[data-target="admin-sub-import"]');
  if (await tabImport.isVisible()) {
    try {
      await tabImport.click({ timeout: 2000, force: true });
    } catch {
      await page.evaluate(() => document.querySelector('[data-target="admin-sub-import"]')?.click());
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '18_admin_import_1440x900.png') });
  }

  // 19. Admin Library
  const tabLibrary = page.locator('[data-target="admin-sub-library"]');
  if (await tabLibrary.isVisible()) {
    try {
      await tabLibrary.click({ timeout: 2000, force: true });
    } catch {
      await page.evaluate(() => document.querySelector('[data-target="admin-sub-library"]')?.click());
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '19_admin_library_1440x900.png') });
  }

  // 20. Admin Staging
  const tabStaging = page.locator('[data-target="admin-sub-staging"]');
  if (await tabStaging.isVisible()) {
    try {
      await tabStaging.click({ timeout: 2000, force: true });
    } catch {
      await page.evaluate(() => document.querySelector('[data-target="admin-sub-staging"]')?.click());
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '20_admin_staging_1440x900.png') });
  }

  // 21. Admin Console
  const tabConsole = page.locator('[data-target="admin-sub-console"]');
  if (await tabConsole.isVisible()) {
    try {
      await tabConsole.click({ timeout: 2000, force: true });
    } catch {
      await page.evaluate(() => document.querySelector('[data-target="admin-sub-console"]')?.click());
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '21_admin_console_1440x900.png') });
  }

  await desktopContext.close();

  // Mobile Context (390x844)
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  const mPage = await mobileContext.newPage();
  await setupMocks(mPage);

  // M1. Mobile Home
  await mPage.goto('http://127.0.0.1:3000/#/');
  await mPage.waitForTimeout(500);
  await mPage.screenshot({ path: path.join(outDir, 'm01_home_390x844.png') });

  // M2. Mobile Login Modal
  const mLoginBtn = mPage.locator('#btn-login-trigger');
  if (await mLoginBtn.isVisible()) {
    await mLoginBtn.click();
    await mPage.waitForTimeout(300);
    await mPage.screenshot({ path: path.join(outDir, 'm02_login_390x844.png') });
    const cancelBtn = mPage.locator('#login-modal-cancel');
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
    } else {
      await mPage.evaluate(() => {
        const m = document.getElementById('login-modal');
        if (m) m.style.display = 'none';
      });
    }
    await mPage.waitForTimeout(200);
  }

  // M3. Mobile Show Detail
  await mPage.goto('http://127.0.0.1:3000/#/show/frieren-beyond-journeys-end');
  await mPage.waitForTimeout(500);
  await mPage.screenshot({ path: path.join(outDir, 'm03_show_detail_390x844.png') });

  // M4. Mobile Player
  await mPage.goto('http://127.0.0.1:3000/#/player/frieren-beyond-journeys-end_S1_E1');
  await mPage.waitForTimeout(800);
  await mPage.evaluate(() => {
    const errOverlay = document.getElementById('player-error-overlay');
    if (errOverlay) errOverlay.style.display = 'none';
    const overlay = document.querySelector('.player-controls-overlay');
    if (overlay) {
      overlay.classList.remove('hide');
      overlay.style.opacity = '1';
      overlay.style.visibility = 'visible';
    }
  });
  await mPage.waitForTimeout(300);
  await mPage.screenshot({ path: path.join(outDir, 'm04_player_390x844.png') });

  // M5. Mobile Admin
  await mPage.evaluate(() => {
    localStorage.setItem('kurastream_jwt', 'mock_admin_jwt');
    localStorage.setItem('kurastream_user', JSON.stringify({ username: 'admin', role: 'admin' }));
  });
  await mPage.goto('http://127.0.0.1:3000/#/admin');
  await mPage.waitForTimeout(600);
  await mPage.screenshot({ path: path.join(outDir, 'm05_admin_overview_390x844.png') });

  await mobileContext.close();
  await browser.close();

  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }

  console.log(`Captured all screenshots into ${outDir}`);
}

captureAll().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
