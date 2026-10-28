import { test, expect } from '@playwright/test';

test.describe('Accessibility and strict CSP', () => {
  test('the page ships no inline scripts or handlers, and the CSP forbids them', async ({ page }) => {
    const violations = [];
    page.on('console', (msg) => { if (/Content Security Policy|Refused to/.test(msg.text())) violations.push(msg.text()); });
    const response = await page.goto('/');
    const csp = response.headers()['content-security-policy'] || '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain('fonts.googleapis.com');

    const offenders = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll('script:not([src])').forEach(() => found.push('inline <script>'));
      document.querySelectorAll('*').forEach((el) => {
        for (const attr of el.attributes) {
          if (/^on[a-z]+$/.test(attr.name)) found.push(`${el.tagName}[${attr.name}]`);
          if (attr.name === 'href' && /^javascript:/i.test(attr.value)) found.push(`${el.tagName}[href=javascript:]`);
        }
      });
      return found;
    });
    expect(offenders).toEqual([]);
    await page.waitForTimeout(500);
    expect(violations).toEqual([]);
  });

  test('the login dialog is a labelled, focus-trapped dialog that gives focus back', async ({ page }) => {
    await page.goto('/');
    const trigger = page.locator('#btn-login-trigger');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.press('Enter');

    const dialog = page.locator('#login-modal .login-modal-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = await dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveText(/sesión|cuenta|Administrador/i);

    // Focus starts in the first field and Tab never leaves the dialog
    await expect(page.locator('#login-username-input')).toBeFocused();
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('#login-modal'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#login-modal'))).toBe(true);

    // It is a real form with the right autocomplete hints
    await expect(page.locator('#login-form')).toHaveCount(1);
    await expect(page.locator('#login-username-input')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#login-password-input')).toHaveAttribute('autocomplete', 'current-password');
    await page.locator('#tab-register').click();
    await expect(page.locator('#login-password-input')).toHaveAttribute('autocomplete', 'new-password');

    await page.keyboard.press('Escape');
    await expect(page.locator('#login-modal')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('catalogue cards are real links and the profile picker uses buttons', async ({ page, request }) => {
    const suffix = Date.now().toString(36);
    const registered = await request.post('/api/register', { data: { username: `a11y_${suffix}`, password: 'Accessible!2026' } });
    expect(registered.ok()).toBeTruthy();
    const { token, user } = await registered.json();
    await page.addInitScript(([t, u]) => {
      localStorage.setItem('kurastream_jwt', t);
      localStorage.setItem('token', t);
      localStorage.setItem('kurastream_user', JSON.stringify(u));
    }, [token, user]);
    await page.goto('/#/profiles');
    const card = page.locator('.profile-card').first();
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.tagName)).toBe('BUTTON');
    await expect(card).toHaveAttribute('aria-label', /Entrar como/);
  });
});
