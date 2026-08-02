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
    await t.test('accessing / without a session renders the landing indicators', async () => {
      const res = await fetch(`${serverUrl}/`);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      
      // Assert that the landing page view container exists
      assert.ok(text.includes('id="landing-view"'), 'HTML should contain landing-view container');
      
      // Assert that the landing indicators are present in the HTML
      assert.ok(text.includes('class="landing-header"'), 'HTML should contain landing header');
      assert.ok(text.includes('class="landing-hero"'), 'HTML should contain landing hero section');
      assert.ok(text.includes('class="landing-hero-title"'), 'HTML should contain landing hero title');
      assert.ok(text.includes('class="landing-hero-subtitle"'), 'HTML should contain landing hero subtitle');
      assert.ok(text.includes('id="landing-signin-btn"'), 'HTML should contain landing sign-in button');
      assert.ok(text.includes('id="landing-cta-start"'), 'HTML should contain landing CTA button');
    });
  } finally {
    serverProcess.kill('SIGKILL');
    await delay(500);
  }
});
