import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'php -S 127.0.0.1:3000 php_backend/router.php',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      JWT_SECRET: process.env.JWT_SECRET || 'ephemeral_e2e_jwt_secret_32bytes_min_length!',
      DB_HOST: process.env.DB_HOST || '127.0.0.1',
      DB_PORT: process.env.DB_PORT || '3306',
      DB_NAME: process.env.DB_NAME || 'kurastream',
      DB_USER: process.env.DB_USER || 'kurastream',
      DB_PASS: process.env.DB_PASS !== undefined ? process.env.DB_PASS : 'testpassword',
    },
  },
});
