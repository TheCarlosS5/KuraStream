import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

const phase = process.argv[2] || 'before';
const outDir = path.resolve('.artifacts/ui-audit', phase);
fs.mkdirSync(outDir, { recursive: true });

const REQUIRED_SCREENSHOTS = [
  '01_logged_out_home_1440x900.png',
  '02_login_modal_1440x900.png',
  '03_register_modal_1440x900.png',
  '04_profile_selector_1440x900.png',
  '05_authenticated_home_1440x900.png',
  '06_movies_1440x900.png',
  '07_genres_1440x900.png',
  '08_my_list_1440x900.png',
  '09_history_1440x900.png',
  '10_show_detail_1440x900.png',
  '11_settings_1440x900.png',
  '12_stats_1440x900.png',
  '13_watch_party_modal_1440x900.png',
  '14_player_paused_1440x900.png',
  '15_player_track_menu_1440x900.png',
  '16_admin_access_login_1440x900.png',
  '17_admin_overview_1440x900.png',
  '18_admin_import_1440x900.png',
  '19_admin_library_1440x900.png',
  '20_admin_staging_1440x900.png',
  '21_admin_console_1440x900.png',
  'm01_home_390x844.png',
  'm02_login_390x844.png',
  'm03_show_detail_390x844.png',
  'm04_player_390x844.png',
  'm05_admin_overview_390x844.png'
];

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
  await page.route('**/api/shows/random', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ show: mockShow }) })
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
        { id: 1, raw_title: '[SubsPlease] Frieren - 28 [1080p].mkv', file_path: '/staging/[SubsPlease] Frieren - 28.mkv', clean_title: "Frieren: Beyond Journey's End", source_info: 'Torrents' }
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
  await page.route('**/api/party/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, party: { id: 'test-party', code: 'KURA-TEST' } }) })
  );
}

async function validateAppShell(response, page) {
  if (response) {
    const status = response.status();
    if (status >= 400) {
      throw new Error(`CRITICAL FAIL: App shell navigation failed with HTTP status ${status}`);
    }
  }

  await page.waitForLoadState('domcontentloaded');

  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ''));

  if (bodyText.includes('JWT_SECRET environment variable is missing')) {
    throw new Error('CRITICAL FAIL: App shell failed with "JWT_SECRET environment variable is missing"');
  }
  if (bodyText.includes('Fatal error:') || bodyText.includes('Parse error:') || bodyText.includes('Uncaught Error')) {
    throw new Error(`CRITICAL FAIL: App shell contains PHP fatal error: ${bodyText.slice(0, 300)}`);
  }

  try {
    const trimmed = bodyText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed.error || parsed.message) {
        throw new Error(`CRITICAL FAIL: App shell returned error JSON instead of HTML: ${trimmed}`);
      }
    }
  } catch (e) {
    if (e.message.startsWith('CRITICAL FAIL:')) throw e;
  }

  const headerCount = await page.locator('.app-header').count();
  const dashCount = await page.locator('#dashboard-view').count();
  if (headerCount === 0 && dashCount === 0) {
    throw new Error(`CRITICAL FAIL: App shell missing canonical elements (.app-header, #dashboard-view). Body text: ${bodyText.slice(0, 200)}`);
  }
}

function verifyAllScreenshots(targetDir) {
  console.log('Running visual QA screenshot manifest & sanity verification...');
  const hashes = new Map();
  const desktopHashes = new Set();
  const mobileHashes = new Set();

  for (const filename of REQUIRED_SCREENSHOTS) {
    const filePath = path.join(targetDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`MANIFEST ASSERTION FAILED: Required screenshot missing: ${filename}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.size < 5000) {
      throw new Error(`SIZE ASSERTION FAILED: Screenshot ${filename} is suspiciously small (${stat.size} bytes < 5000 bytes)`);
    }

    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    hashes.set(filename, hash);

    if (filename.startsWith('m0')) {
      mobileHashes.add(hash);
    } else {
      desktopHashes.add(hash);
    }
  }

  // Sanity check: Ensure screenshots aren't all identical error pages!
  if (desktopHashes.size < 12) {
    throw new Error(
      `SANITY ASSERTION FAILED: Expected diverse desktop views, but found only ${desktopHashes.size} unique images among 21 screenshots!`
    );
  }

  if (mobileHashes.size < 4) {
    throw new Error(
      `SANITY ASSERTION FAILED: Expected diverse mobile views, but found only ${mobileHashes.size} unique images among 5 screenshots!`
    );
  }

  // Cross-check specific key pairs that can NEVER be identical
  const homeHash = hashes.get('01_logged_out_home_1440x900.png');
  const detailHash = hashes.get('10_show_detail_1440x900.png');
  const playerHash = hashes.get('14_player_paused_1440x900.png');
  const adminHash = hashes.get('17_admin_overview_1440x900.png');

  if (homeHash === detailHash || homeHash === playerHash || homeHash === adminHash) {
    throw new Error(
      'SANITY ASSERTION FAILED: Distinct primary views produced identical screenshots (Home vs Detail/Player/Admin)!'
    );
  }

  console.log(`✓ All ${REQUIRED_SCREENSHOTS.length} required screenshots verified successfully.`);
  console.log(`  - Desktop views: 21 files (${desktopHashes.size} visually distinct hashes)`);
  console.log(`  - Mobile views: 5 files (${mobileHashes.size} visually distinct hashes)`);
}

async function captureAll() {
  let serverProcess = null;
  const jwtSecret = process.env.JWT_SECRET || 'ephemeral_screenshot_jwt_secret_' + crypto.randomBytes(32).toString('hex');
  const serverEnv = {
    ...process.env,
    JWT_SECRET: jwtSecret,
    DB_HOST: process.env.DB_HOST || '127.0.0.1',
    DB_PORT: process.env.DB_PORT || '3306',
    DB_NAME: process.env.DB_NAME || 'kurastream',
    DB_USER: process.env.DB_USER || 'kurastream',
    DB_PASS: process.env.DB_PASS || 'testpassword'
  };

  let serverRunning = false;
  try {
    const probe = await fetch('http://127.0.0.1:3000/');
    if (probe.status === 200) {
      const probeText = await probe.text();
      if (!probeText.includes('JWT_SECRET environment variable is missing') && !probeText.includes('"error":')) {
        serverRunning = true;
      }
    }
  } catch {}

  if (!serverRunning) {
    console.log('Starting PHP router server on 127.0.0.1:3000 with JWT_SECRET...');
    serverProcess = spawn('php', ['-S', '127.0.0.1:3000', 'php_backend/router.php'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: serverEnv
    });

    let serverStderr = '';
    serverProcess.stderr?.on('data', chunk => {
      serverStderr += chunk.toString();
    });

    let ready = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch('http://127.0.0.1:3000/');
        if (res.status === 200) {
          const text = await res.text();
          if (!text.includes('JWT_SECRET environment variable is missing')) {
            ready = true;
            break;
          }
        }
      } catch {}
    }

    if (!ready) {
      if (serverProcess) {
        try { serverProcess.kill(); } catch {}
      }
      throw new Error(`PHP server failed to start or serve healthy app shell on 127.0.0.1:3000.\nStderr: ${serverStderr}`);
    }
  }

  const criticalErrors = [];
  const browser = await chromium.launch({ headless: true });

  try {
    // ---------------------------------------------------------
    // 1. Desktop Context (1440x900)
    // ---------------------------------------------------------
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block'
    });
    const page = await desktopContext.newPage();

    page.on('pageerror', err => {
      console.error('PAGE UNCAUGHT ERROR:', err.message);
      criticalErrors.push(`Uncaught PageError: ${err.message}`);
    });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isBenign = text.includes('status of 401') || text.includes('favicon.ico');
        if (!isBenign) {
          console.error('BROWSER ERROR:', text);
          if (
            text.includes('500') ||
            text.includes('Internal Server Error') ||
            text.includes('JWT_SECRET') ||
            text.includes('Fatal error') ||
            text.includes('SyntaxError') ||
            text.includes('ReferenceError') ||
            text.includes('TypeError') ||
            text.includes('Failed to load module')
          ) {
            criticalErrors.push(`Console Critical Error: ${text}`);
          }
        }
      }
    });

    page.on('response', resp => {
      if (resp.status() >= 500) {
        criticalErrors.push(`HTTP ${resp.status()} from ${resp.url()}`);
      }
    });

    await setupMocks(page);

    // 1. Logged-out Home (1440x900)
    const resHome = await page.goto('http://127.0.0.1:3000/#/');
    await validateAppShell(resHome, page);
    await page.locator('.app-header').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#dashboard-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '01_logged_out_home_1440x900.png') });

    // 2. Login Modal (1440x900)
    const loginBtn = page.locator('#btn-login-trigger');
    await loginBtn.waitFor({ state: 'visible', timeout: 5000 });
    await loginBtn.click();
    const loginModal = page.locator('#login-modal');
    await loginModal.waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#login-username-input').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '02_login_modal_1440x900.png') });

    // 3. Register Tab / Modal
    const regTab = page.locator('#tab-register');
    await regTab.waitFor({ state: 'visible', timeout: 5000 });
    await regTab.click();
    await page.locator('#tab-register.active').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#login-modal').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '03_register_modal_1440x900.png') });

    // Close login modal if open
    const cancelLogin = page.locator('#login-modal-cancel');
    await cancelLogin.click();
    await loginModal.waitFor({ state: 'hidden', timeout: 5000 });

    // 4. Profile Selector
    await page.evaluate(() => {
      localStorage.removeItem('kurastream_jwt');
      localStorage.removeItem('kurastream_user');
      localStorage.removeItem('kurastream_active_profile');
    });
    const resProfiles = await page.goto('http://127.0.0.1:3000/#/profiles');
    await validateAppShell(resProfiles, page);
    await page.locator('#profile-switcher-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.profile-card').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '04_profile_selector_1440x900.png') });

    // Simulate Authenticated User with profile
    await page.evaluate(() => {
      localStorage.setItem('kurastream_jwt', 'mock_jwt_token_for_user');
      localStorage.setItem('kurastream_user', JSON.stringify({ username: 'CarlosUser', role: 'user' }));
      localStorage.setItem('kurastream_active_profile', JSON.stringify({ id: 'prof-1', name: 'Principal', is_kids: 0, color: '#818CF8' }));
    });

    // 5. Authenticated Home
    const resAuthHome = await page.goto('http://127.0.0.1:3000/#/');
    await validateAppShell(resAuthHome, page);
    await page.locator('#dashboard-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#user-profile-trigger').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '05_authenticated_home_1440x900.png') });

    // 6. Movies View
    const resMovies = await page.goto('http://127.0.0.1:3000/#/movies');
    await validateAppShell(resMovies, page);
    await page.locator('#dashboard-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '06_movies_1440x900.png') });

    // 7. Genres View
    const resGenres = await page.goto('http://127.0.0.1:3000/#/genres');
    await validateAppShell(resGenres, page);
    await page.locator('#genres-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '07_genres_1440x900.png') });

    // 8. My List
    const resMyList = await page.goto('http://127.0.0.1:3000/#/my-list');
    await validateAppShell(resMyList, page);
    await page.locator('#mylist-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '08_my_list_1440x900.png') });

    // 9. History
    const resHistory = await page.goto('http://127.0.0.1:3000/#/history');
    await validateAppShell(resHistory, page);
    await page.locator('#history-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '09_history_1440x900.png') });

    // 10. Show Detail View
    const resDetail = await page.goto('http://127.0.0.1:3000/#/show/frieren-beyond-journeys-end');
    await validateAppShell(resDetail, page);
    await page.locator('#detail-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.episode-item').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '10_show_detail_1440x900.png') });

    // 11. Settings
    const resSettings = await page.goto('http://127.0.0.1:3000/#/settings');
    await validateAppShell(resSettings, page);
    await page.locator('#settings-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '11_settings_1440x900.png') });

    // 12. Stats
    const resStats = await page.goto('http://127.0.0.1:3000/#/stats');
    await validateAppShell(resStats, page);
    await page.locator('#stats-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '12_stats_1440x900.png') });

    // 13. Watch Party Modal
    const resPartyHome = await page.goto('http://127.0.0.1:3000/#/');
    await validateAppShell(resPartyHome, page);
    const partyNav = page.locator('#nav-party');
    await partyNav.waitFor({ state: 'visible', timeout: 5000 });
    await partyNav.click();
    await page.locator('#modal-watch-party').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '13_watch_party_modal_1440x900.png') });
    await page.evaluate(() => {
      const m = document.getElementById('modal-watch-party');
      if (m) m.style.display = 'none';
    });

    // 14. Player paused with controls
    const resPlayer = await page.goto('http://127.0.0.1:3000/#/player/frieren-beyond-journeys-end_S1_E1');
    await validateAppShell(resPlayer, page);
    await page.locator('#player-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'qa-suppress-player-error';
      style.innerHTML = '#player-error-overlay { display: none !important; }';
      document.head.appendChild(style);
      const overlay = document.querySelector('.player-controls-overlay');
      if (overlay) {
        overlay.classList.remove('hide');
        overlay.style.opacity = '1';
        overlay.style.visibility = 'visible';
      }
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '14_player_paused_1440x900.png') });

    // 15. Player Track Menu
    await page.evaluate(() => {
      const btn = document.getElementById('player-tracks-btn');
      if (btn) btn.click();
    });
    await page.locator('.tracks-modal-container').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '15_player_track_menu_1440x900.png') });
    await page.evaluate(() => {
      const closeBtn = document.querySelector('.tracks-modal-close');
      if (closeBtn) closeBtn.click();
      const modal = document.querySelector('.tracks-modal-container');
      if (modal) modal.classList.remove('is-open');
    });

    // 16. Admin Access Login Modal
    const resPreAdmin = await page.goto('http://127.0.0.1:3000/#/');
    await validateAppShell(resPreAdmin, page);
    await page.evaluate(() => {
      if (typeof window.openAuthModal === 'function') {
        window.openAuthModal('admin');
      }
    });
    await page.locator('#login-modal').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '16_admin_access_login_1440x900.png') });
    await page.evaluate(() => {
      if (typeof window.closeAuthModal === 'function') {
        window.closeAuthModal();
      }
    });
    await page.locator('#login-modal').waitFor({ state: 'hidden', timeout: 5000 });

    // 17. Admin Overview (simulate admin logged in)
    await page.evaluate(() => {
      localStorage.setItem('kurastream_jwt', 'mock_admin_jwt');
      localStorage.setItem('kurastream_user', JSON.stringify({ username: 'admin', role: 'admin' }));
    });

    const resAdmin = await page.goto('http://127.0.0.1:3000/#/admin');
    await validateAppShell(resAdmin, page);
    await page.locator('#admin-view').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#admin-sub-overview').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, '17_admin_overview_1440x900.png') });

    // 18. Admin Import
    const tabImport = page.locator('[data-target="admin-sub-import"]');
    await tabImport.waitFor({ state: 'visible', timeout: 5000 });
    await tabImport.click();
    await page.locator('#admin-sub-import').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '18_admin_import_1440x900.png') });

    // 19. Admin Library
    const tabLibrary = page.locator('[data-target="admin-sub-library"]');
    await tabLibrary.waitFor({ state: 'visible', timeout: 5000 });
    await tabLibrary.click();
    await page.locator('#admin-sub-library').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '19_admin_library_1440x900.png') });

    // 20. Admin Staging
    const tabStaging = page.locator('[data-target="admin-sub-staging"]');
    await tabStaging.waitFor({ state: 'visible', timeout: 5000 });
    await tabStaging.click();
    await page.locator('#admin-sub-staging').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '20_admin_staging_1440x900.png') });

    // 21. Admin Console
    const tabConsole = page.locator('[data-target="admin-sub-console"]');
    await tabConsole.waitFor({ state: 'visible', timeout: 5000 });
    await tabConsole.click();
    await page.locator('#admin-sub-console').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, '21_admin_console_1440x900.png') });

    await desktopContext.close();

    // ---------------------------------------------------------
    // 2. Mobile Context (390x844)
    // ---------------------------------------------------------
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block'
    });
    const mPage = await mobileContext.newPage();

    mPage.on('pageerror', err => {
      console.error('MOBILE PAGE UNCAUGHT ERROR:', err.message);
      criticalErrors.push(`Uncaught Mobile PageError: ${err.message}`);
    });

    mPage.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isBenign = text.includes('status of 401') || text.includes('favicon.ico');
        if (!isBenign) {
          console.error('MOBILE BROWSER ERROR:', text);
          if (
            text.includes('500') ||
            text.includes('Internal Server Error') ||
            text.includes('JWT_SECRET') ||
            text.includes('Fatal error') ||
            text.includes('SyntaxError') ||
            text.includes('ReferenceError') ||
            text.includes('TypeError')
          ) {
            criticalErrors.push(`Mobile Console Critical Error: ${text}`);
          }
        }
      }
    });

    mPage.on('response', resp => {
      if (resp.status() >= 500) {
        criticalErrors.push(`Mobile HTTP ${resp.status()} from ${resp.url()}`);
      }
    });

    await setupMocks(mPage);

    // M1. Mobile Home
    const resMHome = await mPage.goto('http://127.0.0.1:3000/#/');
    await validateAppShell(resMHome, mPage);
    await mPage.locator('#dashboard-view').waitFor({ state: 'visible', timeout: 5000 });
    await mPage.waitForTimeout(400);
    await mPage.screenshot({ path: path.join(outDir, 'm01_home_390x844.png') });

    // M2. Mobile Login Modal
    const mLoginBtn = mPage.locator('#btn-login-trigger');
    await mLoginBtn.waitFor({ state: 'visible', timeout: 5000 });
    await mLoginBtn.click();
    await mPage.locator('#login-modal').waitFor({ state: 'visible', timeout: 5000 });
    await mPage.waitForTimeout(300);
    await mPage.screenshot({ path: path.join(outDir, 'm02_login_390x844.png') });
    const cancelBtn = mPage.locator('#login-modal-cancel');
    await cancelBtn.click();
    await mPage.locator('#login-modal').waitFor({ state: 'hidden', timeout: 5000 });

    // M3. Mobile Show Detail
    const resMDetail = await mPage.goto('http://127.0.0.1:3000/#/show/frieren-beyond-journeys-end');
    await validateAppShell(resMDetail, mPage);
    await mPage.locator('#detail-view').waitFor({ state: 'visible', timeout: 5000 });
    await mPage.waitForTimeout(400);
    await mPage.screenshot({ path: path.join(outDir, 'm03_show_detail_390x844.png') });

    // M4. Mobile Player
    const resMPlayer = await mPage.goto('http://127.0.0.1:3000/#/player/frieren-beyond-journeys-end_S1_E1');
    await validateAppShell(resMPlayer, mPage);
    await mPage.locator('#player-view').waitFor({ state: 'visible', timeout: 5000 });
    await mPage.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'qa-suppress-player-error-m';
      style.innerHTML = '#player-error-overlay { display: none !important; }';
      document.head.appendChild(style);
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
    const resMAdmin = await mPage.goto('http://127.0.0.1:3000/#/admin');
    await validateAppShell(resMAdmin, mPage);
    await mPage.locator('#admin-view').waitFor({ state: 'visible', timeout: 5000 });
    await mPage.waitForTimeout(500);
    await mPage.screenshot({ path: path.join(outDir, 'm05_admin_overview_390x844.png') });

    await mobileContext.close();
  } finally {
    await browser.close();
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {}
    }
  }

  // Check critical runtime errors
  if (criticalErrors.length > 0) {
    throw new Error(
      `Visual QA failed due to ${criticalErrors.length} critical errors:\n- ` + criticalErrors.join('\n- ')
    );
  }

  // Strict verification of manifest and screenshot diversity
  verifyAllScreenshots(outDir);

  console.log(`Successfully captured and verified all screenshots into ${outDir}`);
}

captureAll().catch(err => {
  console.error('\n❌ Screenshot capture process failed:', err.message || err);
  process.exit(1);
});
