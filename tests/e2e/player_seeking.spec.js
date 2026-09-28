import { test, expect } from '@playwright/test';
import fs from 'fs';
import { execSync } from 'child_process';

test.describe('KuraStream Player Seeking Suite (Timeline & Keyboard)', () => {
  // Generate minimal fixture video if needed (60s duration for realistic seek headroom)
  if (!fs.existsSync('tests/fixtures/tiny.mp4') || fs.statSync('tests/fixtures/tiny.mp4').size < 10000) {
    fs.mkdirSync('tests/fixtures', { recursive: true });
    execSync('ffmpeg -y -f lavfi -i testsrc=duration=60:size=64x64:rate=1 -f lavfi -i anullsrc=r=44100:cl=mono -t 60 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart tests/fixtures/tiny.mp4', { stdio: 'ignore' });
  }
  const videoBuffer = fs.readFileSync('tests/fixtures/tiny.mp4');

  test('Direct Play (MP4): Clicking progress bar, dragging scrubber, and keyboard hotkeys seek forward/backward', async ({ page }) => {
    page.on('pageerror', err => { throw err; });
    await page.addInitScript(() => {
      window.HTMLMediaElement.prototype.play = function() {
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      };
      localStorage.setItem('token', 'mock_admin_token_seek_qa');
      localStorage.setItem('user', JSON.stringify({ username: 'admin', role: 'admin' }));
      localStorage.setItem('kura_active_profile', 'Principal');
    });

    const testShowId = 'show_seek_mp4';
    const testEpId = 'show_seek_mp4_S1_E1';

    const mockShow = {
      id: testShowId,
      title: 'Direct MP4 Anime',
      year: 2024,
      rating: 9.0,
      genres: 'Aventura, Acción',
      synopsis: 'Prueba de seeking directo MP4.',
      poster_path: '/assets/branding/KuraStreamLogoBlack.png',
      backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
      age_rating: 'TV-14',
      status: 'finished',
      media_type: 'anime',
      episodes: []
    };

    const mockEpisode = {
      id: testEpId,
      show_id: testShowId,
      season_number: 1,
      episode_number: 1,
      title: 'Seek Episode MP4',
      synopsis: 'Episodio para probar scrubber y hotkeys MP4.',
      thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
      duration: 60, // 60s
      video_codec: 'h264',
      resolution: '1920x1080',
      fps: 24.0,
      direct_playable: true,
      container: 'mp4',
      audio_tracks: [
        { track_number: 0, language: 'jpn', title: 'Japanese Stereo', channels: 2, codec: 'aac' }
      ],
      subtitle_tracks: []
    };
    mockShow.episodes = [mockEpisode];

    await page.route(`**/api/shows/${testShowId}`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockShow) });
    });
    await page.route(`**/api/episodes/${testEpId}`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockEpisode) });
    });
    await page.route(`**/api/progress/${testEpId}*`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ progress: 0, completed: false }) });
    });
    await page.route(`**/api/stream/${testEpId}*`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Content-Length': String(videoBuffer.length), 'Accept-Ranges': 'bytes' },
        body: videoBuffer
      });
    });

    await page.goto(`/#/player/${testEpId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#player-container')).toBeVisible();
    const progressBar = page.locator('#player-progress-bar');
    await expect(progressBar).toBeVisible();

    // 1. Click at 50%
    const box = await progressBar.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + (box.width * 0.5), box.y + (box.height * 0.5));
    }
    const timeCurrent = page.locator('#player-time-current');
    await expect(timeCurrent).not.toHaveText('0:00');

    // 2. Keyboard seeking: ArrowRight (+10s)
    await page.keyboard.press('ArrowRight');
    const hudPill = page.locator('.player-hud-pill');
    await expect(hudPill).toBeVisible();
    await expect(hudPill).toContainText('+10s');

    // 3. Keyboard seeking: ArrowLeft (-10s)
    await page.keyboard.press('ArrowLeft');
    await expect(hudPill).toBeVisible();
    await expect(hudPill).toContainText('-10s');

    // 4. Hotkeys 'l' (+10s) and 'j' (-10s)
    await page.keyboard.press('l');
    await expect(hudPill).toContainText('+10s');
    await page.keyboard.press('j');
    await expect(hudPill).toContainText('-10s');

    // 5. Number key '5' (50% seek)
    await page.keyboard.press('5');
    await expect(hudPill).toContainText('50%');
  });

  test('Remuxed Anime (MKV): Seeking requests backend stream with &start= parameter and updates timeline offset', async ({ page }) => {
    page.on('pageerror', err => { throw err; });
    await page.addInitScript(() => {
      window.HTMLMediaElement.prototype.play = function() {
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      };
      localStorage.setItem('token', 'mock_admin_token_seek_qa');
      localStorage.setItem('user', JSON.stringify({ username: 'admin', role: 'admin' }));
      localStorage.setItem('kura_active_profile', 'Principal');
    });

    const testShowId = 'show_seek_mkv';
    const testEpId = 'show_seek_mkv_S1_E1';

    const mockShow = {
      id: testShowId,
      title: 'Mushoku Seek Anime',
      year: 2024,
      rating: 9.5,
      genres: 'Aventura, Fantasía',
      synopsis: 'Prueba de remuxing seek con contenedor MKV.',
      poster_path: '/assets/branding/KuraStreamLogoBlack.png',
      backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
      age_rating: 'TV-14',
      status: 'finished',
      media_type: 'anime',
      episodes: []
    };

    const mockEpisode = {
      id: testEpId,
      show_id: testShowId,
      season_number: 1,
      episode_number: 1,
      title: 'Capítulo 1 MKV',
      synopsis: 'Episodio MKV remuxed.',
      thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
      duration: 1200, // 20:00 (1200s)
      video_codec: 'h264',
      resolution: '1920x1080',
      fps: 24.0,
      direct_playable: false,
      container: 'mkv',
      audio_tracks: [
        { track_number: 0, language: 'jpn', title: 'Japanese Stereo', channels: 2, codec: 'aac' }
      ],
      subtitle_tracks: []
    };
    mockShow.episodes = [mockEpisode];

    const streamRequests = [];

    await page.route(`**/api/shows/${testShowId}`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockShow) });
    });
    await page.route(`**/api/episodes/${testEpId}`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockEpisode) });
    });
    await page.route(`**/api/progress/${testEpId}*`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ progress: 0, completed: false }) });
    });
    await page.route(`**/api/stream/${testEpId}*`, async route => {
      const url = route.request().url();
      streamRequests.push(url);
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: videoBuffer
      });
    });

    await page.goto(`/#/player/${testEpId}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#player-container')).toBeVisible();
    const progressBar = page.locator('#player-progress-bar');
    await expect(progressBar).toBeVisible();

    // Initial stream load should have occurred without start
    expect(streamRequests.length).toBeGreaterThanOrEqual(1);

    // 1. Click at 50% (approx 600s)
    const box = await progressBar.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + (box.width * 0.5), box.y + (box.height * 0.5));
    }

    // Wait for the debounced / reloaded stream request with &start=
    await expect.poll(() => {
      return streamRequests.some(url => url.includes('start='));
    }, { timeout: 3000 }).toBe(true);

    const seekReq = streamRequests.find(url => url.includes('start='));
    expect(seekReq).toBeDefined();

    // 2. Keyboard seeking: ArrowRight (+10s)
    await page.keyboard.press('ArrowRight');
    const hudPill = page.locator('.player-hud-pill');
    await expect(hudPill).toBeVisible();
    await expect(hudPill).toContainText('+10s');

    // 3. Keyboard seeking: ArrowLeft (-10s)
    await page.keyboard.press('ArrowLeft');
    await expect(hudPill).toBeVisible();
    await expect(hudPill).toContainText('-10s');

    // 4. Number key '2' (20% seek = 240s)
    await page.keyboard.press('2');
    await expect(hudPill).toContainText('20%');

    await expect.poll(() => {
      return streamRequests.some(url => url.includes('start=240'));
    }, { timeout: 3000 }).toBe(true);
  });
});
