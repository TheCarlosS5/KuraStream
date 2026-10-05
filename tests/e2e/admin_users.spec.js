import { test, expect } from '@playwright/test';

// Admin > Usuarios: lists accounts, escapes hostile names, and calls the right endpoints (all hermetic).
test.describe('Admin user management', () => {
  test('lock, reset password and two-step delete', async ({ page }) => {
    let users = [
      { username: 'admin_ana', role: 'admin', disabled: false, profile_count: 2, created_at: '2026-09-01T10:00:00Z', last_login_at: '2026-10-05T12:00:00Z', last_watched_at: null },
      { username: '<img src=x onerror=alert(1)>', role: 'user', disabled: false, profile_count: 1, created_at: '2026-10-01T10:00:00Z', last_login_at: null, last_watched_at: null },
    ];
    const calls = [];

    await page.route('**/api/shows', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/history**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/notifications', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/login', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, token: 'mock_admin_jwt_token', role: 'admin', user: { username: 'admin_ana', role: 'admin' } }),
    }));
    await page.route('**/api/admin/users**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, users }) });
      }
      calls.push({ method: req.method(), path, body: req.postData() ? JSON.parse(req.postData()) : null });
      if (req.method() === 'DELETE') users = users.filter((u) => encodeURIComponent(u.username) !== path.split('/').pop());
      if (path.endsWith('/disable')) users[1].disabled = JSON.parse(req.postData()).disabled;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/admin/**', (route) => {
      if (route.request().url().includes('/api/admin/users')) return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/#/');
    await page.click('#btn-login-trigger');
    await page.fill('#login-username-input', 'admin_ana');
    await page.fill('#login-password-input', 'adminpass1');
    await page.click('#login-modal-submit');
    await expect(page.locator('#user-profile-menu')).toBeVisible();
    await page.goto('/#/admin');
    await page.click('.admin-nav-item[data-target="admin-sub-users"]');

    const rows = page.locator('#admin-users-list .admin-user-row');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#admin-users-count')).toHaveText('2 cuentas');
    // The hostile name is text, never markup
    await expect(rows.nth(1).locator('.admin-user-name')).toHaveText('<img src=x onerror=alert(1)>');
    expect(await page.locator('#admin-users-list img').count()).toBe(0);

    // Filter
    await page.fill('#admin-users-filter', 'ana');
    await expect(rows).toHaveCount(1);
    await page.fill('#admin-users-filter', '');
    await expect(rows).toHaveCount(2);

    // Disable
    await rows.nth(1).locator('[data-action="toggle-disabled"]').click();
    await expect(rows.nth(1).locator('.admin-user-badge--off')).toBeVisible();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { disabled: true } });
    expect(calls.at(-1).path).toContain('/disable');

    // Password reset form
    await rows.nth(1).locator('[data-action="reset-password"]').click();
    const form = rows.nth(1).locator('.admin-user-reset');
    await expect(form).toBeVisible();
    await form.locator('input').fill('a_new_password_1');
    await form.locator('button[type="submit"]').click();
    await expect(form).toBeHidden();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { password: 'a_new_password_1' } });
    expect(calls.at(-1).path).toContain('/reset-password');

    // Delete needs a second click
    const del = rows.nth(1).locator('[data-action="delete"]');
    await del.click();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    await del.click();
    await expect(rows).toHaveCount(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
