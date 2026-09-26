import { test, expect } from '@playwright/test';

test.describe('Notifications UX Contract E2E Suite', () => {
  test('Opening dropdown does not auto-mark read; clicking Marcar leídas calls seen API and updates UI', async ({ page }) => {
    let seenCallCount = 0;

    const mockNotifications = [
      {
        id: 'notif_1',
        show_id: 'frieren-beyond-journeys-end',
        show_title: "Frieren: Beyond Journey's End",
        episode_id: 'frieren_ep1',
        season_number: 1,
        episode_number: 1,
        title: 'El final del viaje',
        message: "¡Nuevo episodio disponible! S1 E1: Frieren: Beyond Journey's End",
        is_unread: true,
        created_at: new Date().toISOString()
      },
      {
        id: 'notif_2',
        show_id: 'frieren-beyond-journeys-end',
        episode_id: 'frieren_ep2',
        season_number: 1,
        episode_number: 2,
        title: 'No tenía que ser magia',
        message: "¡Nuevo episodio disponible! S1 E2: Frieren: Beyond Journey's End",
        is_unread: true,
        created_at: new Date().toISOString()
      }
    ];

    await page.route('**/api/notifications*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          notifications: mockNotifications,
          unread_count: 2,
          last_seen_at: null
        })
      });
    });

    await page.route('**/api/notifications/seen', async route => {
      seenCallCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    });

    await page.route('**/api/shows', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    });

    await page.goto('/');

    const trigger = page.locator('#btn-notifications-trigger');
    await expect(trigger).toBeVisible();

    // 1. Initial badge state: 2 unread
    const badge = page.locator('#notification-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');

    // 2. Open notification dropdown: MUST NOT call /api/notifications/seen
    await trigger.click();
    const dropdown = page.locator('#notifications-dropdown');
    await expect(dropdown).toBeVisible();

    // Verify /api/notifications/seen was NOT called
    expect(seenCallCount).toBe(0);

    // Verify badge is STILL 2
    await expect(badge).toHaveText('2');
    await expect(badge).toBeVisible();

    // Verify notification items are present
    const items = page.locator('#notifications-list .notification-item');
    await expect(items).toHaveCount(2);

    // 3. Click "Marcar leídas"
    const markReadBtn = page.locator('#btn-mark-notifications-read');
    await expect(markReadBtn).toBeVisible();
    await markReadBtn.click();

    // 4. Verify seen API was called exactly once
    expect(seenCallCount).toBe(1);

    // 5. Verify badge is now hidden/0
    await expect(badge).toBeHidden();

    // 6. Verify notification items have the read class applied
    await expect(items.first()).toHaveClass(/notification-item-read/);
    await expect(items.nth(1)).toHaveClass(/notification-item-read/);
  });
});
