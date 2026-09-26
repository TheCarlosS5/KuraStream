import { test, expect } from '@playwright/test';

test.describe('KuraStream Admin Auth & UI Reconstruction E2E Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Hermetic catalog and shows mocks so tests run reliably in offline dev environments
    await page.route('**/api/shows', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'show-1',
            title: 'Chainsaw Man',
            year: 2022,
            rating: 8.8,
            genres: 'Acción, Sobrenatural',
            synopsis: 'Denji es un joven que vive con un demonio motosierra llamado Pochita.',
            poster_path: '/assets/branding/KuraStreamLogoBlack.png',
            backdrop_path: '/assets/branding/KuraStreamLogoBlack.png',
            is_featured: 1
          }
        ])
      });
    });

    await page.route('**/api/history**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/notifications', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  });

  test('Unauthenticated guard blocks #/admin, redirects to #/ and prompts admin login', async ({ page }) => {
    await page.goto('/#/admin');
    await page.waitForLoadState('domcontentloaded');

    // Should redirect to #/
    await expect(page).toHaveURL(/#\//);

    // Auth modal should open
    const modal = page.locator('#login-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#login-modal-title')).toHaveText('Acceso de Administrador');
  });

  test('Admin login flow, header auth sync, admin sidebar subview switching, and logout', async ({ page }) => {
    // Mock login endpoint returning role=admin
    await page.route('**/api/login', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock_admin_jwt_token',
          user: { username: 'admin', role: 'admin' },
          role: 'admin'
        })
      });
    });

    await page.route('**/api/admin/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', shows: 1, episodes: 12, disk_free: '500 GB' })
      });
    });

    await page.route('**/api/logout', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');

    // Initially logged out: login trigger visible, user profile menu hidden
    const btnLoginTrigger = page.locator('#btn-login-trigger');
    const userProfileMenu = page.locator('#user-profile-menu');
    await expect(btnLoginTrigger).toBeVisible();
    await expect(userProfileMenu).toBeHidden();

    // Click login trigger
    await btnLoginTrigger.click();
    const modal = page.locator('#login-modal');
    await expect(modal).toBeVisible();

    // Fill credentials and submit
    await page.fill('#login-username-input', 'admin');
    await page.fill('#login-password-input', 'adminpass');
    await page.click('#login-modal-submit');

    // Modal closes and header updates
    await expect(modal).toBeHidden();
    await expect(btnLoginTrigger).toBeHidden();
    await expect(userProfileMenu).toBeVisible();
    await expect(page.locator('#user-profile-name')).toHaveText('admin');
    await expect(page.locator('#user-avatar-initial')).toHaveText('A');

    // Open user dropdown
    await page.click('#user-profile-trigger');
    const userDropdown = page.locator('#user-dropdown-card');
    await expect(userDropdown).toBeVisible();

    // Admin direct link must be visible for admin role
    const btnAdminDirect = page.locator('#btn-admin-direct');
    await expect(btnAdminDirect).toBeVisible();

    // Click admin direct link -> navigates to #/admin
    await btnAdminDirect.click();
    await expect(page).toHaveURL(/#\/admin/);

    const adminView = page.locator('#admin-view');
    await expect(adminView).toBeVisible();

    // Overview subview is active by default
    await expect(page.locator('#admin-sub-overview')).toHaveClass(/active/);

    // Switch to Import subview
    await page.click('.admin-nav-item[data-target="admin-sub-import"]');
    await expect(page.locator('#admin-sub-import')).toHaveClass(/active/);
    await expect(page.locator('#admin-sub-overview')).not.toHaveClass(/active/);

    // Switch to Staging subview
    await page.click('.admin-nav-item[data-target="admin-sub-staging"]');
    await expect(page.locator('#admin-sub-staging')).toHaveClass(/active/);

    // Switch to Console subview
    await page.click('.admin-nav-item[data-target="admin-sub-console"]');
    await expect(page.locator('#admin-sub-console')).toHaveClass(/active/);

    // Switch to Library subview
    await page.click('.admin-nav-item[data-target="admin-sub-library"]');
    await expect(page.locator('#admin-sub-library')).toHaveClass(/active/);

    // Re-open profile dropdown and logout
    await page.click('#user-profile-trigger');
    await page.click('#btn-logout');

    // After logout session cleared, user redirected to #/
    await expect(page).toHaveURL(/#\//);
  });

  test('Regular user registration, role=user isolation, and admin denial', async ({ page }) => {
    await page.route('**/api/register', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock_regular_user_token',
          user: { username: 'testuser', role: 'user' },
          role: 'user'
        })
      });
    });

    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');

    // Click login trigger and switch to Register tab
    await page.click('#btn-login-trigger');
    await page.click('#tab-register');
    await expect(page.locator('#login-modal-title')).toHaveText('Crear una nueva cuenta');

    await page.fill('#login-username-input', 'testuser');
    await page.fill('#login-password-input', 'TestPassword123!');
    await page.click('#login-modal-submit');

    // Header updates for user
    await expect(page.locator('#user-profile-menu')).toBeVisible();
    await expect(page.locator('#user-profile-name')).toHaveText('testuser');

    // Profile menu should NOT show admin button
    await page.click('#user-profile-trigger');
    await expect(page.locator('#btn-admin-direct')).toBeHidden();

    // Regular user attempting #/admin must be denied and redirected
    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\//);
    const toast = page.locator('#kura-toast');
    await expect(toast).toContainText('Acceso denegado');
  });

  test('Responsive viewport discipline: zero horizontal overflow on desktop and mobile', async ({ page }) => {
    // Desktop check 1440x900
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');

    const desktopScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const desktopClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(desktopScrollWidth).toBeLessThanOrEqual(desktopClientWidth);

    // Mobile check 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/');
    await page.waitForLoadState('domcontentloaded');

    const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const mobileClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(mobileScrollWidth).toBeLessThanOrEqual(mobileClientWidth);
  });
});
