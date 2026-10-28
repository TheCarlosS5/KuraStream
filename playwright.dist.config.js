import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

// The production build (npm run build) served as it is in production: hashed bundles, built index.html, service worker.
export default defineConfig({
  testDir: './tests/e2e_dist',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    ...base.webServer,
    command: base.webServer.command.replace('127.0.0.1:3000', '127.0.0.1:3100'),
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    env: { ...base.webServer.env, KURA_USE_DIST: '1' },
  },
});
