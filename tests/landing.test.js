import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Landing Page & Router Setup integration tests', async (t) => {
  const testPort = '3099';
  const serverUrl = `http://localhost:${testPort}`;

  const env = {
    ...process.env,
    PORT: testPort,
    JWT_SECRET: 'landing_test_jwt_secret',
    PASSWORD_SALT: 'landing_test_salt'
  };

  const serverProcess = spawn('node', ['backend/server.js'], { env });

  // Give the server a moment to start up
  await delay(1500);

  try {
    await t.test('accessing / without a session renders the dashboard mosaic background', async () => {
      const res = await fetch(`${serverUrl}/`);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      
      // Assert that dashboard mosaic bg and gradient overlay exist
      assert.ok(text.includes('id="dashboard-mosaic-bg"'), 'HTML should contain dashboard-mosaic-bg container');
      assert.ok(text.includes('class="dashboard-gradient-overlay"'), 'HTML should contain dashboard-gradient-overlay');
      
      // Assert that landing-view is no longer present
      assert.strictEqual(text.includes('id="landing-view"'), false, 'HTML should not contain landing-view container');
    });
  } finally {
    serverProcess.kill('SIGKILL');
    await delay(500);
  }
});
