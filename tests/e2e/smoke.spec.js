import { test, expect } from '@playwright/test';

test.describe('KuraStream End-to-End Modern Streaming Platform', () => {
  test('Smoke Test: Catalog, Show Detail, Player Navigation and Zero Errors', async ({ page }) => {
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

    // Mock API catalogue endpoints for hermetic, deterministic test execution
    await page.route('**/api/shows', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'frieren-beyond-journeys-end',
            title: "Frieren: Beyond Journey's End",
            year: 2023,
            rating: 9.1,
            genres: 'Aventura, Fantasía, Drama',
            synopsis: 'El viaje de la maga elfa Frieren tras derrotar al Rey Demonio.',
            poster_path: '/assets/branding/KuraStreamLogoBlack.png',
            backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
            is_featured: 1
          }
        ])
      });
    });

    await page.route('**/api/shows/frieren-beyond-journeys-end', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          show: {
            id: 'frieren-beyond-journeys-end',
            title: "Frieren: Beyond Journey's End",
            year: 2023,
            rating: 9.1,
            genres: 'Aventura, Fantasía, Drama',
            synopsis: 'El viaje de la maga elfa Frieren tras derrotar al Rey Demonio.',
            poster_path: '/assets/branding/KuraStreamLogoBlack.png',
            backdrop_path: '/assets/branding/KuraStreamLogoBlack.png'
          },
          episodes: [
            {
              id: 'frieren-beyond-journeys-end_S1_E1',
              show_id: 'frieren-beyond-journeys-end',
              season_number: 1,
              episode_number: 1,
              title: 'El final del viaje',
              synopsis: 'La era de paz ha comenzado.',
              thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
              duration: 1440
            }
          ],
          seasons: {
            "1": [
              {
                id: 'frieren-beyond-journeys-end_S1_E1',
                show_id: 'frieren-beyond-journeys-end',
                season_number: 1,
                episode_number: 1,
                title: 'El final del viaje',
                synopsis: 'La era de paz ha comenzado.',
                thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
                duration: 1440
              }
            ]
          }
        })
      });
    });

    await page.route('**/api/episodes/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'frieren-beyond-journeys-end_S1_E1',
          show_id: 'frieren-beyond-journeys-end',
          show_title: "Frieren: Beyond Journey's End",
          season_number: 1,
          episode_number: 1,
          title: 'El final del viaje',
          duration: 1440,
          stream_url: '/api/stream/frieren-beyond-journeys-end_S1_E1',
          audio_tracks: [],
          subtitle_tracks: []
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"profiles":[]}' });
    });

    await page.route('**/api/favorites**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/user/preferences**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"preferences":{}}' });
    });

    await page.route('**/api/comments**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/debug-log**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    // 1. Visit root dashboard
    await page.goto('/');

    // Verify not blank screen: header and dashboard view are visible
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('#dashboard-view')).toBeVisible();

    // 2. Click on the show card to open Show Detail view
    const showCard = page.locator('.show-card[data-catalogue-route]').first();
    await expect(showCard).toBeVisible();
    await showCard.click();

    // Verify URL transitioned to show detail and detail view is active
    await expect(page).toHaveURL(/#\/show\/frieren-beyond-journeys-end/);
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('#detail-title')).toContainText("Frieren: Beyond Journey's End");

    // 3. Click on the episode in show detail to open Episode Modal, then click Reproducir
    const episodeItem = page.locator('.episode-item[data-episode-id="frieren-beyond-journeys-end_S1_E1"]');
    await expect(episodeItem).toBeVisible();
    await episodeItem.click();

    const playBtn = page.locator('#ep-detail-play-btn');
    await expect(playBtn).toBeVisible();
    await playBtn.click();

    // Verify URL transitioned to player view
    await expect(page).toHaveURL(/#\/player\/frieren-beyond-journeys-end_S1_E1/);
    await expect(page.locator('#player-view')).toBeVisible();

    // Header must be hidden during playback
    await expect(page.locator('.app-header')).toBeHidden();

    // 4. Test Browser Back Button returns to Show Detail
    await page.goBack();
    await expect(page).toHaveURL(/#\/show\/frieren-beyond-journeys-end/);
    await expect(page.locator('#detail-view')).toBeVisible();
    await expect(page.locator('.app-header')).toBeVisible();

    // 5. Test Browser Back Button returns to Dashboard
    await page.goBack();
    await expect(page).toHaveURL(/(#\/)?$/);
    await expect(page.locator('#dashboard-view')).toBeVisible();

    // 6. Assertions for zero console errors and zero 404s
    expect(consoleErrors, `Expected zero console errors, got:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(failed404s, `Expected zero 404 responses, got:\n${failed404s.join('\n')}`).toEqual([]);
  });
});
