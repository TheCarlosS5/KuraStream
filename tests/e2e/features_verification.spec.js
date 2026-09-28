import { test, expect } from '@playwright/test';

test.describe('KuraStream 10 Platform Features E2E Verification', () => {
  test('Watch Party, Calendar, Audio/Sub Track Preferences, Favorites, Comments, Stats, and Profile Management', async ({ page }) => {
    // -------------------------------------------------------------------------
    // Hermetic Mocks
    // -------------------------------------------------------------------------
    const testShow = {
      id: 'vinland-saga',
      title: 'Vinland Saga',
      year: 2019,
      rating: 8.8,
      studio: 'WIT Studio',
      director: 'Shuhei Yabuta',
      writer: 'Hiroshi Seko',
      genres: 'Acción, Aventura, Drama',
      synopsis: 'Thorfinn busca venganza por la muerte de su padre.',
      poster_path: '/assets/branding/KuraStreamLogoBlack.png',
      backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
      status: 'airing'
    };

    const testEpisode = {
      id: 'vinland-saga_S1_E1',
      show_id: 'vinland-saga',
      season_number: 1,
      episode_number: 1,
      title: 'En algún lugar del océano',
      synopsis: 'El comienzo del viaje de Thorfinn.',
      thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
      duration: 1440,
      audio_tracks: [
        { language: 'jpn', title: 'Japonés Original' },
        { language: 'spa', title: 'Español Latino' }
      ],
      subtitle_tracks: [
        { language: 'spa', title: 'Español' },
        { language: 'eng', title: 'English' }
      ]
    };

    let isFavorited = false;
    const commentsList = [
      { id: 'c1', show_id: 'vinland-saga', username: 'thorfinn', profile_name: 'Guerrero', content: '¡Excelente animación!', created_at: '2026-09-27 12:00:00' }
    ];

    await page.route('**/api/shows', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([testShow]) });
    });

    await page.route('**/api/shows/vinland-saga', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          show: testShow,
          episodes: [testEpisode],
          seasons: { '1': [testEpisode] }
        })
      });
    });

    await page.route('**/api/history**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            episode_id: 'vinland-saga_S1_E1',
            show_id: 'vinland-saga',
            show_title: 'Vinland Saga',
            progress_seconds: 720,
            duration: 1440,
            completed: 0
          }
        ])
      });
    });

    await page.route('**/api/favorites/check**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorited: isFavorited }) });
    });

    await page.route('**/api/favorites', async route => {
      if (route.request().method() === 'POST') {
        isFavorited = !isFavorited;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ favorited: isFavorited }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isFavorited ? [testShow] : []) });
      }
    });

    await page.route('**/api/comments**', async route => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        commentsList.unshift({
          id: 'c2',
          show_id: 'vinland-saga',
          username: 'tester',
          profile_name: 'Principal',
          content: body.content,
          created_at: new Date().toISOString()
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, comments: commentsList }) });
      }
    });

    await page.route('**/api/calendar**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          Monday: [
            {
              title: 'Vinland Saga',
              in_library: true,
              local_show_id: 'vinland-saga',
              episode: 'Ep. 1',
              studio: 'WIT Studio',
              cover_image: '/assets/branding/KuraStreamLogoBlack.png'
            }
          ],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: []
        })
      });
    });

    await page.route('**/api/user/stats**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          stats: {
            total_time_seconds: 5400, // 1h 30min
            completed_shows: 1,
            watched_episodes: 3,
            top_genre: 'Acción'
          }
        })
      });
    });

    let mockProfiles = [
      { id: 'p1', name: 'Principal', color: '#818CF8', is_kids: 0, avatar: '' },
      { id: 'p2', name: 'Kids Zone', color: '#4DD4A7', is_kids: 1, avatar: '' }
    ];

    await page.route('**/api/profiles', async route => {
      if (route.request().method() === 'POST') {
        const data = JSON.parse(route.request().postData() || '{}');
        if (data.id) {
          const idx = mockProfiles.findIndex(p => p.id === data.id);
          if (idx !== -1) mockProfiles[idx] = { ...mockProfiles[idx], ...data };
        } else {
          mockProfiles.push({ id: `p_${Date.now()}`, ...data });
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, profiles: mockProfiles }) });
      }
    });

    await page.route('**/api/party/public-rooms', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rooms: [
            { id: 'ROOM-1234', name: 'Sala de Anime Épico', host_user: 'OtakuMaster', episode_id: 'vinland-saga_S1_E1' }
          ]
        })
      });
    });

    // -------------------------------------------------------------------------
    // 1. Visit App & Set Session
    // -------------------------------------------------------------------------
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('kurastream_jwt', 'mock_token_verified');
      localStorage.setItem('kurastream_user', JSON.stringify({ username: 'tester', role: 'user' }));
      localStorage.setItem('kurastream_active_profile', JSON.stringify({ id: 'p1', name: 'Principal', color: '#818CF8' }));
    });
    await page.reload();

    // -------------------------------------------------------------------------
    // 2. Watch Party Modal (Multi-tab, Close, Public rooms)
    // -------------------------------------------------------------------------
    await page.click('#nav-party');
    await expect(page.locator('#modal-watch-party')).toBeVisible();

    // Switch to Create tab
    await page.click('#party-tab-create');
    await expect(page.locator('#party-content-create')).toBeVisible();

    // Switch to Public rooms tab
    await page.click('#party-tab-public');
    await expect(page.locator('#party-content-public')).toBeVisible();
    await expect(page.locator('.party-room-card').first()).toBeVisible();
    await expect(page.locator('.party-room-name').first()).toHaveText('Sala de Anime Épico');

    // Close Watch Party modal
    await page.click('#party-modal-close');
    await expect(page.locator('#modal-watch-party')).toBeHidden();

    // -------------------------------------------------------------------------
    // 3. Calendar View (Simulcast Schedule, Clickable Show in Library)
    // -------------------------------------------------------------------------
    await page.goto('/#/calendar');
    await expect(page.locator('#calendar-view')).toBeVisible();
    await page.click('.day-tab[data-day="Monday"]');

    const calendarCard = page.locator('.calendar-show-card-linked').first();
    await expect(calendarCard).toBeVisible();
    await expect(calendarCard).toHaveAttribute('href', '#/show/vinland-saga');

    // -------------------------------------------------------------------------
    // 4. Show Details (Audio/Sub Pills, Favorites Toggle, Progress Bar, Comments)
    // -------------------------------------------------------------------------
    await page.goto('/#/show/vinland-saga');
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('#detail-title')).toHaveText('Vinland Saga');

    // Pre-playback track preferences
    await expect(page.locator('#detail-track-preferences')).toBeVisible();
    const audioPills = page.locator('#detail-audio-pills .detail-pref-pill');
    await expect(audioPills.first()).toBeVisible();
    const subPills = page.locator('#detail-sub-pills .detail-pref-pill');
    await expect(subPills.first()).toBeVisible();

    // Episode progress bar
    await expect(page.locator('.episode-progress-bar').first()).toBeVisible();

    // Favorite Button Toggle
    const favBtn = page.locator('#detail-favorite-btn');
    await expect(favBtn).toBeVisible();
    await favBtn.click();
    await expect(page.locator('#detail-favorite-text')).toHaveText('En mi Lista');

    // Comments Section
    await expect(page.locator('#comment-author-name')).toContainText('tester');
    await expect(page.locator('.comment-item').first()).toBeVisible();

    await page.fill('#comment-textarea', '¡Increíble serie de vikingos!');
    await page.click('#btn-submit-comment');
    await expect(page.locator('.comment-item').first()).toContainText('¡Increíble serie de vikingos!');

    // -------------------------------------------------------------------------
    // 5. Estadísticas View (Formatted Total Watch Time: 1 h 30 min)
    // -------------------------------------------------------------------------
    await page.goto('/#/stats');
    await expect(page.locator('#stats-view')).toBeVisible();
    const statsValue = page.locator('.stat-card-value.text-info').first();
    await expect(statsValue).toHaveText('1 h 30 min');

    // -------------------------------------------------------------------------
    // 6. Profiles View (Manage Mode Toggle, Edit Profile)
    // -------------------------------------------------------------------------
    await page.goto('/#/profiles');
    await expect(page.locator('#profile-switcher-view')).toBeVisible();
    await expect(page.locator('.profile-card').first()).toBeVisible();

    // Toggle Manage Mode
    await page.click('#btn-manage-profiles');
    await expect(page.locator('#btn-manage-profiles')).toHaveText('Listo');
    await expect(page.locator('.profile-edit-badge').first()).toBeVisible();
    await expect(page.locator('#card-add-profile')).toBeVisible();

    // Open Profile Edit Modal for adding a profile
    await page.click('#card-add-profile');
    await expect(page.locator('#profile-edit-modal')).toBeVisible();
    await expect(page.locator('#profile-edit-title')).toHaveText('Agregar Perfil');

    // Close modal
    await page.click('#btn-cancel-profile');
    await expect(page.locator('#profile-edit-modal')).toBeHidden();
  });
});
