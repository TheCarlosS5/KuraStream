import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('KuraStream backend endpoints integration tests', async (t) => {
  const testPort = '3096';
  const serverUrl = `http://localhost:${testPort}`;

  const env = {
    ...process.env,
    PORT: testPort,
    JWT_SECRET: 'backend_test_jwt_secret',
    PASSWORD_SALT: 'backend_test_salt'
  };

  const serverProcess = spawn('node', ['backend/server.js'], { env });

  // Give the server a moment to start up
  await delay(1500);

  const db = new DatabaseSync('./backend/kurastream.db');

  try {
    const randUser = `testuser_${Date.now()}`;

    await t.test('GET / returns HTML of home page', async () => {
      const res = await fetch(`${serverUrl}/`);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('<!DOCTYPE html>'));
      assert.ok(text.includes('KuraStream'));
    });

    await t.test('POST /api/register creates a new user', async () => {
      const res = await fetch(`${serverUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: randUser, password: 'password123' })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.username, randUser);
    });

    await t.test('POST /api/login authenticates registered user', async () => {
      const res = await fetch(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: randUser, password: 'password123' })
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.token);
    });

    await t.test('POST /api/login fails on incorrect password', async () => {
      const res = await fetch(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: randUser, password: 'wrongpassword' })
      });
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
    });

    await t.test('GET /api/shows returns shows array', async () => {
      const res = await fetch(`${serverUrl}/api/shows`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json));
    });

  } finally {
    // Clean up test user from DB
    try {
      db.prepare("DELETE FROM users WHERE username LIKE 'testuser_%'").run();
    } catch (e) {
      // Ignore cleanup error
    }

    serverProcess.kill('SIGKILL');
    await delay(500);
  }
});
