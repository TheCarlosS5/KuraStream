import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function signToken(payload) {
  const secret = 'test_secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('Admin Cover Scraper API Endpoint', async (t) => {
  const testPort = '3125';
  const serverUrl = `http://localhost:${testPort}`;

  const origDbPath = process.env.DB_PATH;
  const testDbPath = path.join(__dirname, '../backend/kurastream_test_cover.db');
  process.env.DB_PATH = testDbPath;
  
  const { dbHelper, runMigrations, db } = await import(`../backend/db.js?bust=${Date.now()}_${Math.random()}`);
  runMigrations(db);

  // Setup mock show in the test DB
  const showId = 'test_scrape_show';
  dbHelper.saveShow({
    id: showId,
    title: 'Test Scrape Anime',
    synopsis: '',
    rating: 0,
    media_type: 'anime',
    poster_path: ''
  });

  const env = {
    ...process.env,
    PORT: testPort,
    JWT_SECRET: 'test_secret',
    DB_PATH: testDbPath
  };

  const serverProcess = spawn('node', ['backend/server.js'], { env });
  await delay(1000); // wait for server to start

  const adminToken = signToken({ username: 'admin', role: 'admin' });

  // Mock global fetch to intercept anime metadata queries
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    // If it's hitting the local server, let it pass through
    if (url.startsWith(serverUrl)) {
      return originalFetch(url, options);
    }
    // Intercept Jikan API
    if (url.includes('api.jikan.moe')) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            title: 'Mock Anime Title',
            synopsis: 'Mock Anime Synopsis',
            score: 8.5,
            year: 2024,
            images: {
              jpg: {
                large_image_url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80'
              }
            }
          }]
        })
      };
    }
    // For anything else, delegate to original fetch
    return originalFetch(url, options);
  };

  try {
    await t.test('POST /api/admin/scrape-show-cover downloads image and updates DB', async () => {
      const res = await fetch(`${serverUrl}/api/admin/scrape-show-cover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          showId,
          query: 'Test Scrape Anime'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      
      // Check show in DB
      const updated = dbHelper.getShow(showId);
      assert.match(updated.poster_path, /poster\.jpg$/);
      assert.ok(updated.synopsis.length > 0);
      assert.ok(updated.rating >= 0);
    });
  } finally {
    // Restore fetch
    globalThis.fetch = originalFetch;

    // Stop server
    serverProcess.kill();
    await delay(500);

    // Clean up DB
    try {
      db.close();
      fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch (e) {}

    // Restore original DB Path env
    if (origDbPath) process.env.DB_PATH = origDbPath;
  }
});
