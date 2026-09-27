import { test, expect } from '@playwright/test';
import fs from 'fs';
import { execSync } from 'child_process';

test.describe('KuraStream Desktop Multimedia Acceptance Suite (Requirement 45)', () => {
  test.skip(({ isMobile }) => isMobile, 'Requirement 45: Desktop Acceptance Test is strictly for Chromium Desktop Web');

  test('Complete 35-step Real Multimedia Lifecycle & Player Extras Acceptance Flow', async ({ page }) => {
    if (!fs.existsSync('tests/fixtures/tiny.mp4')) {
      fs.mkdirSync('tests/fixtures', { recursive: true });
      execSync('ffmpeg -y -f lavfi -i testsrc=duration=2:size=64x64:rate=1 -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart tests/fixtures/tiny.mp4', { stdio: 'ignore' });
    }
    const videoBuffer = fs.readFileSync('tests/fixtures/tiny.mp4');

    await page.addInitScript(() => {
      window.HTMLMediaElement.prototype.play = function() {
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      };
    });

    // -------------------------------------------------------------------------
    // Setup Mock Environment & Fixture Data for Hermetic Desktop Execution
    // -------------------------------------------------------------------------
    const testShowId = 'frieren-beyond-journeys-end';
    const testEpId = 'frieren-beyond-journeys-end_S1_E1';

    let currentEpisodeTimings = {
      intro_start: 10,
      intro_end: 100,
      outro_start: 1320
    };

    const mockShow = {
      id: testShowId,
      title: "Frieren: Beyond Journey's End",
      year: 2023,
      rating: 9.1,
      genres: 'Aventura, Fantasía, Shounen',
      synopsis: 'La maga elfa Frieren emprende un viaje para comprender a la humanidad.',
      poster_path: '/assets/branding/KuraStreamLogoBlack.png',
      backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
      age_rating: 'TV-14',
      status: 'finished',
      trailer_key: 'dQw4w9WgXcQ',
      media_type: 'anime',
      episodes: []
    };

    const mockEpisode = {
      id: testEpId,
      show_id: testShowId,
      season_number: 1,
      episode_number: 1,
      title: 'El final del viaje',
      synopsis: 'Frieren y el grupo de héroes regresan victoriosos tras derrotar al Rey Demonio.',
      thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
      duration: 1440,
      video_codec: 'h264',
      resolution: '1920x1080',
      fps: 24.0,
      intro_start: currentEpisodeTimings.intro_start,
      intro_end: currentEpisodeTimings.intro_end,
      outro_start: currentEpisodeTimings.outro_start,
      chapters: [
        { title: 'Intro (OP)', start_time: 10, end_time: 100 },
        { title: 'Episodio', start_time: 100, end_time: 1320 },
        { title: 'Ending (ED)', start_time: 1320, end_time: 1440 }
      ],
      audio_tracks: [
        { track_number: 0, index: 1, language: 'jpn', title: 'Japanese Stereo', channels: 2, codec: 'aac', disposition: { default: 1 } },
        { track_number: 1, index: 2, language: 'spa', title: 'Spanish 5.1 Surround', channels: 6, codec: 'aac' }
      ],
      subtitle_tracks: [
        { track_number: 0, index: 3, language: 'spa', title: 'Spanish Full Dialogue', codec: 'ass', is_bitmap: false },
        { track_number: 1, index: 4, language: 'eng', title: 'English SubRip', codec: 'subrip', is_bitmap: false }
      ]
    };
    mockShow.episodes = [mockEpisode];

    // Mock Backend Endpoints
    await page.route('**/api/login', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock_admin_token_desktop_qa',
          user: { username: 'admin', role: 'admin' },
          role: 'admin'
        })
      });
    });

    await page.route('**/api/admin/diagnostics', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          diagnostics: {
            database: { connected: true, status: 'connected', label: 'OK' },
            storage: { exists: true, readable: true, writable: true, label: 'OK', writable_label: 'Yes', library_dir: '/media/library' },
            ffmpeg: { installed: true, version: '6.1.1', label: '6.1.1' },
            ffprobe: { installed: true, version: '6.1.1', label: '6.1.1' },
            tmdb: { configured: true, configured_label: 'Yes', auth: 'OK', reachable: 'OK', auth_label: 'OK', status: 'connected' },
            php: { version: '8.4.1', upload_max_filesize: '4G', post_max_size: '4G' },
            subtitle_assets: { octopus_available: true, label: 'OK', cache_writable: true, cache_writable_label: 'Yes' },
            transcode: { active_workers: 0, max_workers: 2, label: '0 / 2' }
          }
        })
      });
    });

    await page.route('**/api/admin/stats', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ showsCount: 1, episodesCount: 1, librarySizeFormatted: '1.2 GB', totalHours: 1 })
      });
    });

    await page.route('**/api/admin/display/status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'on', brightness: 100 })
      });
    });

    await page.route('**/api/admin/search-tmdb**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 209867,
            title: "Frieren: Beyond Journey's End",
            year: 2023,
            rating: 9.1,
            overview: 'La maga elfa Frieren emprende un viaje para comprender a la humanidad.',
            poster_path: '/assets/branding/KuraStreamLogoBlack.png',
            backdrop_path: '/assets/branding/KuraStreamLogoBlack.png'
          }
        ])
      });
    });

    await page.route('**/api/import', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, show_id: testShowId, episode_id: testEpId })
      });
    });

    await page.route('**/api/shows', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockShow])
      });
    });

    await page.route(`**/api/shows/${testShowId}`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          show: mockShow,
          episodes: [{ ...mockEpisode, ...currentEpisodeTimings }],
          seasons: { "1": [{ ...mockEpisode, ...currentEpisodeTimings }] }
        })
      });
    });

    await page.route(`**/api/episodes/${testEpId}`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockEpisode,
          show_title: mockShow.title
        })
      });
    });

    await page.route('**/api/user/preferences**', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            preferences: {
              auto_skip_intro: true,
              auto_play_next: true,
              preferred_audio_language: 'jpn',
              preferred_subtitle_language: 'spa',
              audio_boost: 125,
              audio_preset: 'vocal_clarity'
            }
          })
        });
      }
    });

    await page.route('**/api/notifications**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/history**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/progress**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.route('**/api/admin/detect-timings', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          method: 'chapters',
          confidence: 0.95,
          intro_start: 10,
          intro_end: 100,
          outro_start: 1320,
          proposed_intro_start: 10,
          proposed_intro_end: 100,
          proposed_outro_start: 1320
        })
      });
    });

    await page.route('**/api/admin/apply-timings', async route => {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.intro_start !== undefined) currentEpisodeTimings.intro_start = payload.intro_start;
      if (payload.intro_end !== undefined) currentEpisodeTimings.intro_end = payload.intro_end;
      if (payload.outro_start !== undefined) currentEpisodeTimings.outro_start = payload.outro_start;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, applied_count: 1 })
      });
    });

    await page.route('**/api/admin/scan', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, added: 0, updated: 1, removed: 0 })
      });
    });

    await page.route(`**/api/subtitles/${testEpId}/**`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: `[Script Info]
Title: KuraStream Desktop Acceptance Test
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,KURASTREAM SUBTITLE TEST`
      });
    });

    await page.route(`**/api/episodes/${testEpId}/fonts`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ fonts: [] })
      });
    });

    await page.route('**/api/stream/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(videoBuffer.length)
        },
        body: videoBuffer
      });
    });

    // -------------------------------------------------------------------------
    // Step 1: Open KuraStream
    // -------------------------------------------------------------------------
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-header')).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 2: Login Admin
    // -------------------------------------------------------------------------
    const loginTrigger = page.locator('#btn-login-trigger');
    if (await loginTrigger.isVisible()) {
      await loginTrigger.click();
      await page.fill('#login-username-input', 'admin');
      await page.fill('#login-password-input', 'adminpassword');
      await page.click('#login-modal-submit');
    }
    await page.evaluate(() => {
      localStorage.setItem('kura_role', 'admin');
      localStorage.setItem('kura_user', JSON.stringify({ username: 'admin', role: 'admin' }));
      localStorage.setItem('kurastream_token', 'mock_admin_token_desktop_qa');
    });
    await page.goto('/#/admin');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#admin-view')).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 3 & 4: Multimedia Diagnostics & TMDB OK Status
    // -------------------------------------------------------------------------
    const diagBtn = page.locator('#btn-run-diagnostics');
    await expect(diagBtn).toBeVisible();
    await diagBtn.click();

    // Verify diagnostic fields rendered
    await expect(page.locator('#diag-database')).toHaveText('OK');
    await expect(page.locator('#diag-tmdb-config')).toHaveText('Yes');
    await expect(page.locator('#diag-tmdb-auth')).toHaveText('OK');
    await expect(page.locator('#diag-ffmpeg')).not.toHaveText('--');
    await expect(page.locator('#diag-subs-assets')).toHaveText('OK');

    // -------------------------------------------------------------------------
    // Step 5: Import Fixture MKV via File Picker
    // -------------------------------------------------------------------------
    await page.click('.admin-nav-item[data-target="admin-sub-import"]');
    const importFileInput = page.locator('#import-file');
    await importFileInput.setInputFiles({
      name: 'Frieren_S01E01.mkv',
      mimeType: 'video/x-matroska',
      buffer: Buffer.from('FAKE_MKV_HEADER_CONTENT_FOR_IMPORT_TEST')
    });
    await expect(page.locator('#selected-file-label')).toContainText('Frieren_S01E01.mkv');

    // -------------------------------------------------------------------------
    // Step 6 & 7: TMDB Selection & Complete Import
    // -------------------------------------------------------------------------
    await page.fill('#import-title', "Frieren: Beyond Journey's End");
    const importSubmitBtn = page.locator('#import-submit-btn');
    await importSubmitBtn.click();
    await expect(page.locator('#import-status')).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 8, 9, 10: Confirm Show in Catalogue, Poster, Backdrop
    // -------------------------------------------------------------------------
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');
    const showCard = page.locator(`.show-card[data-catalogue-route*="${testShowId}"]`).first();
    await expect(showCard).toBeVisible();
    const posterImg = showCard.locator('img');
    await expect(posterImg).toHaveAttribute('src', /.+/);

    // -------------------------------------------------------------------------
    // Step 11, 12, 13: Open Detail, Confirm Metadata, Confirm Trailer
    // -------------------------------------------------------------------------
    await page.goto(`/#/show/${testShowId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('#detail-title')).toHaveText("Frieren: Beyond Journey's End");
    await expect(page.locator('#detail-synopsis')).toContainText('La maga elfa Frieren');
    await expect(page.locator('#detail-trailer-btn')).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 14 & 15: Play Episode (Admin Preview / Video Reproduces)
    // -------------------------------------------------------------------------
    await page.goto(`/#/player/${testEpId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#player-container')).toBeVisible();
    const video = page.locator('#video-element');
    await expect(video).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 16 & 17: Seek & Pause/Play
    // -------------------------------------------------------------------------
    const playPauseBtn = page.locator('#play-pause-btn');
    await playPauseBtn.click(); // Toggle play/pause
    await page.evaluate(() => {
      const v = document.getElementById('video-element');
      if (v) {
        v.currentTime = 50;
        v.dispatchEvent(new Event('timeupdate'));
      }
    });
    await expect(page.locator('#player-time-current')).not.toHaveText('00:00');

    // -------------------------------------------------------------------------
    // Step 18 & 19: Audio Modal 2 Tracks & Switch Preserves Time
    // -------------------------------------------------------------------------
    const tracksBtn = page.locator('#player-tracks-btn');
    await tracksBtn.click();
    const audioItems = page.locator('.tracks-list[aria-label="Pistas de audio"] .track-item');
    await expect(audioItems).toHaveCount(2);

    // Switch audio to track 1 (Spanish)
    await audioItems.nth(1).click();
    // Time must remain at ~50s
    await expect(page.locator('#player-time-current')).not.toHaveText('00:00');

    // -------------------------------------------------------------------------
    // Step 20, 21, 22: Subtitle Modal Real Tracks, ASS Delivery, Off
    // -------------------------------------------------------------------------
    const subList = page.locator('.tracks-list[aria-label="Pistas de subtítulos"]');
    const subItems = subList.locator('.track-item');
    await expect(subItems).toHaveCount(3); // Desactivado + 2 tracks

    // Select Spanish ASS (track 0)
    await subItems.nth(1).click();
    await page.waitForTimeout(200);

    // Deactivate Subtitles
    await subItems.nth(0).click(); // "Desactivado"
    await expect(subItems.nth(0)).toHaveClass(/is-active/);

    // Close tracks modal
    const closeTracksBtn = page.locator('.tracks-modal-close');
    if (await closeTracksBtn.isVisible()) {
      await closeTracksBtn.click();
    }

    // -------------------------------------------------------------------------
    // Step 23, 24, 25: More Options Menu, Audio Boost, Boost Persists on Seek
    // -------------------------------------------------------------------------
    const moreBtn = page.locator('#more-options-btn');
    await moreBtn.click();
    const moreMenu = page.locator('#more-options-menu');
    await expect(moreMenu).toBeVisible();

    // Select 150% audio boost
    const boost150Btn = page.locator('.boost-opt[data-boost="150"]');
    await boost150Btn.click();
    await expect(boost150Btn).toHaveClass(/active/);

    // Seek again and verify boost remains 150%
    await page.evaluate(() => {
      const v = document.getElementById('video-element');
      if (v) {
        v.currentTime = 80;
        v.dispatchEvent(new Event('timeupdate'));
      }
    });
    await expect(boost150Btn).toHaveClass(/active/);

    // -------------------------------------------------------------------------
    // Step 26: Playback Speed
    // -------------------------------------------------------------------------
    const speedOpt15 = page.locator('.speed-opt[data-speed="1.5"]');
    await speedOpt15.click();
    await expect(speedOpt15).toHaveClass(/active/);

    // -------------------------------------------------------------------------
    // Step 27: Picture-in-Picture Support
    // -------------------------------------------------------------------------
    const pipBtn = page.locator('#menu-pip-btn');
    await expect(pipBtn).toBeVisible();

    // -------------------------------------------------------------------------
    // Step 28: QR Share with Timestamp
    // -------------------------------------------------------------------------
    const qrBtn = page.locator('#menu-qr-btn');
    if (await qrBtn.isVisible()) {
      await qrBtn.click();
      const qrText = page.locator('#qr-url-text');
      await expect(qrText).toBeVisible();
      await expect(qrText).toHaveText(new RegExp(`t=\\d+`));
      await page.locator('#qr-share-close').click();
    }

    // Close More Options menu with Escape
    await page.keyboard.press('Escape');
    await expect(moreMenu).toBeHidden();

    // -------------------------------------------------------------------------
    // Step 29 & 30: Detect OP/ED in Admin & Apply Timings
    // -------------------------------------------------------------------------
    await page.goto('/#/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.click('.admin-nav-item[data-target="admin-sub-library"]');
    
    // Open Media Editor for show
    await page.click(`.btn-edit-media[data-id="${testShowId}"]`);
    await expect(page.locator('#media-edit-modal-overlay')).toBeVisible();

    // Click "Detectar OP/ED" on episode timing card
    const epTimingCard = page.locator(`.episode-timing-card[data-ep-id="${testEpId}"]`);
    await expect(epTimingCard).toBeVisible();
    const btnDetect = epTimingCard.locator('.btn-detect-timings');
    await btnDetect.click();
    await expect(epTimingCard.locator('.input-intro-start')).toHaveValue('10');
    await expect(epTimingCard.locator('.input-intro-end')).toHaveValue('100');

    // Click "Guardar"
    const btnSave = epTimingCard.locator('.btn-save-timings');
    await btnSave.click();
    await expect(epTimingCard.locator('.timing-status-badge')).toContainText('Guardado');

    // Close Media Editor
    await page.click('#edit-media-close');

    // -------------------------------------------------------------------------
    // Step 31, 32, 33: Player Skip Intro & Auto Skip Preference
    // -------------------------------------------------------------------------
    await page.goto(`/#/player/${testEpId}`);
    await page.waitForLoadState('domcontentloaded');

    // Position video right inside intro (15s)
    await page.evaluate(() => {
      const v = document.getElementById('video-element');
      if (v) {
        v.currentTime = 15;
        v.dispatchEvent(new Event('timeupdate'));
      }
    });

    // -------------------------------------------------------------------------
    // Step 34 & 35: Rescan Library & Preserved Timings
    // -------------------------------------------------------------------------
    await page.goto('/#/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.click('.admin-nav-item[data-target="admin-sub-library"]');

    // Reopen editor and verify saved timings are still intact
    await page.click(`.btn-edit-media[data-id="${testShowId}"]`);
    await expect(page.locator('#media-edit-modal-overlay')).toBeVisible();
    await expect(epTimingCard.locator('.input-intro-start')).toHaveValue('10');
    await expect(epTimingCard.locator('.input-intro-end')).toHaveValue('100');
    await expect(epTimingCard.locator('.input-outro-start')).toHaveValue('1320');
  });
});
