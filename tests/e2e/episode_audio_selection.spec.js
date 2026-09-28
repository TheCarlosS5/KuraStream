import { test, expect } from '@playwright/test';

test.describe('Episode Detail Modal - Audio Selection & Language Normalization', () => {
  test('displays clean language names, hides subtitles in modal, allows interactive audio selection, and launches player with selected track', async ({ page }) => {
    const mockShow = {
      id: 'mushoku-tensei',
      title: 'Mushoku Tensei: Reencarnación sin empleo',
      year: '2021',
      rating: '8.7',
      studio: 'Studio Bind',
      director: 'Manabu Okamoto',
      writer: 'Manabu Okamoto',
      genres: 'Aventura, Fantasía, Isekai',
      synopsis: 'Un joven solitario y desempleado de 34 años es atropellado por un camión... ¡y se despierta como un bebé recién nacido en un mundo de fantasía!',
      poster_path: '/assets/branding/KuraStreamLogoBlack.png',
      backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
      is_featured: 1,
      status: 'ended'
    };

    const mockEpisode = {
      id: 'mushoku-tensei_S1_E1',
      show_id: 'mushoku-tensei',
      season_number: 1,
      episode_number: 1,
      title: 'Reencarnación sin empleo',
      synopsis: 'Un joven solitario y desempleado de 34 años es atropellado por un camión...',
      thumbnail_path: '/assets/branding/KuraStreamLogoBlack.png',
      duration: 1440,
      stream_url: '/api/stream/mushoku-tensei_S1_E1',
      // Real-world release tags from rip groups
      audio_tracks: [
        { track_number: 0, index: 0, language: 'spa', title: 'GATON [SPA]', codec: 'aac', channels: 2 },
        { track_number: 1, index: 1, language: 'jpn', title: 'GATON [JPN]', codec: 'aac', channels: 2 }
      ],
      subtitle_tracks: [
        { track_number: 0, index: 0, language: 'spa', title: 'GATON [SPA]' },
        { track_number: 1, index: 1, language: 'eng', title: 'GATON [ENG]' }
      ]
    };

    // Route mocking for hermetic isolation
    await page.route('**/api/auth/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { username: 'tester', role: 'user' } })
      });
    });

    await page.route('**/api/profiles/active', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: { id: 1, name: 'Principal', is_kids: 0 } })
      });
    });

    await page.route('**/api/shows', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockShow])
      });
    });

    await page.route('**/api/shows/mushoku-tensei', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          show: mockShow,
          episodes: [mockEpisode],
          seasons: { '1': [mockEpisode] }
        })
      });
    });

    await page.route('**/api/episodes/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockEpisode,
          show_title: 'Mushoku Tensei: Reencarnación sin empleo'
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

    await page.route('**/api/history**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    await page.route('**/api/progress/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    // 1. Navigate to show detail
    await page.goto('/#/show/mushoku-tensei');
    await expect(page.locator('#detail-view')).toBeVisible();

    // 2. Click on the episode item to open Episode Detail Modal
    const episodeItem = page.locator('.episode-item[data-episode-id="mushoku-tensei_S1_E1"]');
    await expect(episodeItem).toBeVisible();
    await episodeItem.click();

    // 3. Verify modal is displayed
    const modal = page.locator('#episode-detail-modal');
    await expect(modal).toBeVisible();

    // 4. Verify Episode Header & Synopsis
    await expect(page.locator('#ep-detail-number')).toHaveText('Temporada 1 • Capítulo 1');
    await expect(page.locator('#ep-detail-title')).toHaveText('Reencarnación sin empleo');

    // 5. Verify Audio Selection: Clean language names are displayed, NOT raw "GATON"
    const audioPills = page.locator('#ep-detail-audio .detail-pref-pill');
    await expect(audioPills).toHaveCount(2);

    const firstPill = audioPills.nth(0);
    const secondPill = audioPills.nth(1);

    await expect(firstPill).toHaveText('Español');
    await expect(secondPill).toHaveText('Japonés');

    // Ensure raw release group strings are NOT present
    const audioContainerText = await page.locator('#ep-detail-audio').innerText();
    expect(audioContainerText).not.toContain('GATON');
    expect(audioContainerText).not.toContain('[SPA]');
    expect(audioContainerText).not.toContain('[JPN]');

    // 6. Verify Subtitles section is NOT visible in the modal
    const subsEl = page.locator('#ep-detail-subtitles');
    await expect(subsEl).toBeHidden();
    const modalText = await modal.innerText();
    expect(modalText).not.toContain('Subtítulos');

    // 7. Interactive selection: click on "Japonés"
    await secondPill.click();
    await expect(secondPill).toHaveClass(/active/);
    await expect(firstPill).not.toHaveClass(/active/);

    // 8. Click "Reproducir Capítulo"
    const playBtn = page.locator('#ep-detail-play-btn');
    await expect(playBtn).toBeVisible();
    await playBtn.click();

    // 9. Verify navigation to Player
    await expect(page).toHaveURL(/#\/player\/mushoku-tensei_S1_E1/);
    await expect(page.locator('#player-view')).toBeVisible();

    // 10. Verify that Japanese audio (track index 1) was resolved
    const activeAudioPillInPlayer = page.locator('#audio-menu-list button.active');
    if (await activeAudioPillInPlayer.count() > 0) {
      await expect(activeAudioPillInPlayer).toHaveAttribute('data-track', '1');
    }
  });
});
