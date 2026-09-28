import { test, expect } from '@playwright/test';

test.describe('KuraStream Hermetic E2E Platform Smoke Suite', () => {
  test('Complete hermetic navigation across views with zero console errors and zero 404s', async ({ page }) => {
    const consoleErrors = [];
    const failed404s = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('response', res => {
      if (res.status() === 404) {
        failed404s.push(res.url());
      }
    });

    // -------------------------------------------------------------
    // Hermetic API Mocks
    // -------------------------------------------------------------
    const mockShow = {
      id: 'frieren-beyond-journeys-end',
      title: "Frieren: Beyond Journey's End",
      year: 2023,
      rating: 9.1,
      studio: 'Madhouse',
      director: 'Keiichirou Saitou',
      writer: 'Tomohiro Suzuki',
      genres: 'Aventura, Fantasía, Drama',
      synopsis: 'El viaje de la maga elfa Frieren tras derrotar al Rey Demonio.',
      poster_path: '/assets/branding/KuraStreamLogoBlack.png',
      backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
      is_featured: 1,
      status: 'airing'
    };

    const mockEpisode = {
      id: 'frieren-beyond-journeys-end_S1_E1',
      show_id: 'frieren-beyond-journeys-end',
      season_number: 1,
      episode_number: 1,
      title: 'El final del viaje',
      synopsis: 'La era de paz ha comenzado.',
      thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
      duration: 1440,
      stream_url: '/api/stream/frieren-beyond-journeys-end_S1_E1',
      audio_tracks: [],
      subtitle_tracks: []
    };

    await page.route('**/api/shows', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockShow])
      });
    });

    await page.route('**/api/shows/frieren-beyond-journeys-end', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          show: mockShow,
          episodes: [mockEpisode],
          seasons: { "1": [mockEpisode] }
        })
      });
    });

    await page.route('**/api/episodes/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockEpisode,
          show_title: "Frieren: Beyond Journey's End"
        })
      });
    });

    await page.route('**/api/stream/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('')
      });
    });

    await page.route('**/api/progress/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ progress: 0, completed: false })
      });
    });

    await page.route('**/api/history**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/notifications**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/user/profiles**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"profiles":[]}' });
    });

    await page.route('**/api/profiles**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          profiles: [
            { id: 'prof-1', name: 'Principal', is_kids: 0, color: '#3b82f6' }
          ]
        })
      });
    });

    await page.route('**/api/favorites**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/user/preferences**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, preferences: { auto_skip_intro: 1, auto_play_next: 1 } })
      });
    });

    await page.route('**/api/comments**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/calendar**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          Monday: [],
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
            total_time_seconds: 3600,
            completed_shows: 1,
            watched_episodes: 2,
            top_genre: 'Fantasía'
          }
        })
      });
    });

    await page.route('**/api/debug-log**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    // -------------------------------------------------------------
    // 1. Visit Root Dashboard & Verify Catalogue + Billboard Hero
    // -------------------------------------------------------------
    await page.goto('/');

    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('#dashboard-view')).toBeVisible();
    await expect(page.locator('.billboard-hero')).toBeVisible();
    await expect(page.locator('.billboard-hero-title')).toHaveText("Frieren: Beyond Journey's End");

    const showCard = page.locator('.show-card[data-catalogue-route]').first();
    await expect(showCard).toBeVisible();

    // -------------------------------------------------------------
    // 2. Navigate to Show Detail View
    // -------------------------------------------------------------
    await showCard.click();

    await expect(page).toHaveURL(/#\/show\/frieren-beyond-journeys-end/);
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('#detail-title')).toHaveText("Frieren: Beyond Journey's End");
    await expect(page.locator('#detail-studio')).toHaveText('Madhouse');
    await expect(page.locator('#detail-director')).toHaveText('Keiichirou Saitou');
    await expect(page.locator('#detail-writer')).toHaveText('Tomohiro Suzuki');

    // -------------------------------------------------------------
    // 3. Open Episode Modal and Trigger Player
    // -------------------------------------------------------------
    const episodeItem = page.locator('.episode-item[data-episode-id="frieren-beyond-journeys-end_S1_E1"]');
    await expect(episodeItem).toBeVisible();
    await episodeItem.click();

    const playBtn = page.locator('#ep-detail-play-btn');
    await expect(playBtn).toBeVisible();
    await playBtn.click();

    // Verify Player view mounted and header hidden
    await expect(page).toHaveURL(/#\/player\/frieren-beyond-journeys-end_S1_E1/);
    await expect(page.locator('#player-view')).toBeVisible();
    await expect(page.locator('.app-header')).toBeHidden();

    // -------------------------------------------------------------
    // 4. Test Browser Back Navigation (Player -> Detail -> Home)
    // -------------------------------------------------------------
    await page.goBack();
    await expect(page).toHaveURL(/#\/show\/frieren-beyond-journeys-end/);
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('.app-header')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/(#\/)?$/);
    await expect(page.locator('#dashboard-view')).toBeVisible();

    // -------------------------------------------------------------
    // 5. Navigate to Calendar View
    // -------------------------------------------------------------
    await page.goto('/#/calendar');
    await expect(page.locator('#calendar-view')).toBeVisible();
    await expect(page.locator('#day-picker-tabs')).toBeVisible();

    // -------------------------------------------------------------
    // 6. Navigate to Movies View
    // -------------------------------------------------------------
    await page.goto('/#/movies');
    await expect(page.locator('#dashboard-view')).toBeVisible();

    // -------------------------------------------------------------
    // 7. Navigate to Genres View
    // -------------------------------------------------------------
    await page.goto('/#/genres');
    await expect(page.locator('#genres-view')).toBeVisible();
    await expect(page.locator('.genre-card').first()).toBeVisible();

    // -------------------------------------------------------------
    // 8. Navigate to Profiles View
    // -------------------------------------------------------------
    await page.goto('/#/profiles');
    await expect(page.locator('#profile-switcher-view')).toBeVisible();
    await expect(page.locator('.profile-card').first()).toBeVisible();

    // -------------------------------------------------------------
    // 9. Navigate to Settings View
    // -------------------------------------------------------------
    await page.goto('/#/settings');
    await expect(page.locator('#settings-view')).toBeVisible();

    // -------------------------------------------------------------
    // 10. Fallback on Unknown Route (404 Handling)
    // -------------------------------------------------------------
    await page.goto('/#/unknown-nonexistent-route-fallback');
    await expect(page.locator('#dashboard-view')).toBeVisible();

    // -------------------------------------------------------------
    // 11. Assert Zero Console Errors and Zero 404s
    // -------------------------------------------------------------
    expect(consoleErrors, `Expected zero console errors, got:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(failed404s, `Expected zero 404 responses, got:\n${failed404s.join('\n')}`).toEqual([]);
  });
});
