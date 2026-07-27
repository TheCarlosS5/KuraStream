import test from 'node:test';
import assert from 'node:assert';
import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// A helper function to wait
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Security and body parsing limits integration tests', async (t) => {
  const testPort = '3099';
  const serverUrl = `http://localhost:${testPort}`;

  // 1. Spawn the server subprocess on a separate port with a temporary env configuration
  const env = {
    ...process.env,
    PORT: testPort,
    JWT_SECRET: 'test_secret_for_signing_tokens',
    PASSWORD_SALT: 'test_password_salt_env'
  };

  const serverProcess = spawn('node', ['backend/server.js'], { env });

  // Capture output logs for debug and wait for server to start
  serverProcess.stdout.on('data', (data) => {
    // console.log(`Server: ${data}`);
  });
  serverProcess.stderr.on('data', (data) => {
    // console.error(`Server Err: ${data}`);
  });

  // Give the server a moment to start up and bind to the port
  await delay(1500);

  // Setup test database instance to insert dummy show for traversal tests
  const db = new DatabaseSync('./backend/kurastream.db');
  db.prepare("INSERT OR IGNORE INTO shows (id, title, media_type) VALUES ('test_traversal_show', 'Test Traversal Show', 'movie')").run();

  try {
    // Sign a test admin token and user token manually to verify authorizeAdmin
    const signToken = (payload, secret) => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 60000 })).toString('base64url');
      const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
      return `${header}.${body}.${signature}`;
    };

    const adminToken = signToken({ username: 'testadmin', role: 'admin' }, 'test_secret_for_signing_tokens');
    const userToken = signToken({ username: 'testuser', role: 'user' }, 'test_secret_for_signing_tokens');

    await t.test('Admin endpoint rejected without Authorization header', async () => {
      const res = await fetch(`${serverUrl}/api/admin/stats`);
      assert.strictEqual(res.status, 401);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Unauthorized');
    });

    await t.test('Admin endpoint rejected with non-Bearer Authorization token', async () => {
      const res = await fetch(`${serverUrl}/api/admin/stats`, {
        headers: {
          'Authorization': 'Basic YWRtaW46cGFzc3dvcmQ='
        }
      });
      assert.strictEqual(res.status, 401);
    });

    await t.test('Admin endpoint rejected for a regular user role token (Forbidden)', async () => {
      const res = await fetch(`${serverUrl}/api/admin/stats`, {
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Forbidden');
    });

    await t.test('Admin endpoint accepted for a valid admin token', async () => {
      const res = await fetch(`${serverUrl}/api/admin/stats`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      // It should not be 401 or 403. It might return 200 (or other DB related responses, but definitely not authentication error)
      assert.ok(res.status !== 401 && res.status !== 403);
    });

    await t.test('Body parsing size limit (1MB payload limit)', async () => {
      // Generate a payload slightly larger than 1MB
      const largeData = 'a'.repeat(1024 * 1024 + 100);
      try {
        const res = await fetch(`${serverUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: largeData })
        });
        assert.strictEqual(res.status, 413);
        const json = await res.json();
        assert.strictEqual(json.success, false);
        assert.strictEqual(json.error, 'Payload Too Large');
      } catch (err) {
        // If the socket was destroyed by req.destroy(), that also correctly rejects the large payload
        assert.ok(err.message.includes('fetch failed') || err.code === 'ECONNRESET');
      }
    });

    await t.test('Body parsing invalid JSON error handling', async () => {
      const res = await fetch(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json'
      });
      assert.strictEqual(res.status, 400);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Bad Request');
      assert.strictEqual(json.message, 'Invalid JSON');
    });

    await t.test('Directory traversal on /library/* is forbidden', async () => {
      const res = await fetch(`${serverUrl}/library/..%2fpackage.json`);
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Forbidden');
    });

    await t.test('Sibling directory traversal on /library/* is forbidden', async () => {
      const res = await fetch(`${serverUrl}/library/..%2flibrary_secrets%2fcredentials.txt`);
      assert.strictEqual(res.status, 403);
    });

    await t.test('Directory traversal on frontend files is forbidden', async () => {
      const res = await fetch(`${serverUrl}/..%2fpackage.json`);
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Forbidden');
    });

    await t.test('Sibling directory traversal on frontend files is forbidden', async () => {
      const res = await fetch(`${serverUrl}/..%2ffrontend_secrets%2fcredentials.txt`);
      assert.strictEqual(res.status, 403);
    });

    await t.test('DELETE /api/shows/:id checks admin role', async () => {
      const resNoAuth = await fetch(`${serverUrl}/api/shows/99999`, { method: 'DELETE' });
      assert.strictEqual(resNoAuth.status, 401);

      const resUser = await fetch(`${serverUrl}/api/shows/99999`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.strictEqual(resUser.status, 403);
    });

    await t.test('/api/import checks admin role and file extension whitelist', async () => {
      const resNoAuth = await fetch(`${serverUrl}/api/import`, { method: 'POST' });
      assert.strictEqual(resNoAuth.status, 401);

      const resUser = await fetch(`${serverUrl}/api/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.strictEqual(resUser.status, 403);

      const form = new FormData();
      form.append('videoFile', new Blob(['fake video content'], { type: 'video/mp4' }), 'malicious.exe');
      form.append('title', 'Test Movie');
      form.append('mediaType', 'movie');

      const resAdminBadExt = await fetch(`${serverUrl}/api/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: form
      });
      assert.strictEqual(resAdminBadExt.status, 400);
      const json = await resAdminBadExt.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Bad Request');
      assert.strictEqual(json.message, 'Formato de video no soportado');
    });

    await t.test('/api/admin/delete-backdrop-loop directory traversal check', async () => {
      const res = await fetch(`${serverUrl}/api/admin/delete-backdrop-loop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          showId: 'test_traversal_show',
          videoUrl: '/library/../../package.json'
        })
      });
      assert.strictEqual(res.status, 403);
      const json = await res.json();
      assert.strictEqual(json.success, false);
      assert.strictEqual(json.error, 'Forbidden');
      assert.strictEqual(json.message, 'Acceso denegado');
    });
    await t.test('/api/admin/delete-backdrop-loop sibling prefix traversal check', async () => {
      const res = await fetch(`${serverUrl}/api/admin/delete-backdrop-loop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          showId: 'test_traversal_show',
          videoUrl: '/library/../library_secrets/credentials.txt'
        })
      });
      assert.strictEqual(res.status, 403);
    });

    await t.test('/api/login rejects missing or non-string password', async () => {
      const resNoPass = await fetch(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser' })
      });
      assert.strictEqual(resNoPass.status, 400);
      const jsonNoPass = await resNoPass.json();
      assert.strictEqual(jsonNoPass.success, false);
      assert.strictEqual(jsonNoPass.message, 'La contraseña es obligatoria');

      const resNonStrPass = await fetch(`${serverUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 12345 })
      });
      assert.strictEqual(resNonStrPass.status, 400);
      const jsonNonStrPass = await resNonStrPass.json();
      assert.strictEqual(jsonNonStrPass.success, false);
      assert.strictEqual(jsonNonStrPass.message, 'La contraseña es obligatoria');
    });

  } finally {
    // Clean up test database row
    try {
      db.prepare("DELETE FROM shows WHERE id = 'test_traversal_show'").run();
    } catch (e) {
      // Ignore if database clean up fails
    }

    // Tear down server subprocess
    serverProcess.kill('SIGKILL');
    await delay(500);
  }
});

test('hashPassword environmental salt fallback', async (t) => {
  const hashWithDefault = crypto.scryptSync('myPassword123', 'kurasalt', 64).toString('hex');
  const hashWithJwtSecret = crypto.scryptSync('myPassword123', 'myJwtSecret', 64).toString('hex');
  const hashWithPasswordSalt = crypto.scryptSync('myPassword123', 'myPasswordSalt', 64).toString('hex');

  // Case 1: Neither is set (fallback to 'kurasalt')
  const run1 = execSync('NODE_ENV=test PORT=3098 node -e "import(\'./backend/server.js\').then(m => console.log(m.hashPassword(\'myPassword123\')))"').toString().trim();
  assert.strictEqual(run1, hashWithDefault);

  // Case 2: Only JWT_SECRET is set
  const run2 = execSync('NODE_ENV=test PORT=3098 JWT_SECRET=myJwtSecret node -e "import(\'./backend/server.js\').then(m => console.log(m.hashPassword(\'myPassword123\')))"').toString().trim();
  assert.strictEqual(run2, hashWithJwtSecret);

  // Case 3: PASSWORD_SALT and JWT_SECRET are set
  const run3 = execSync('NODE_ENV=test PORT=3098 PASSWORD_SALT=myPasswordSalt JWT_SECRET=myJwtSecret node -e "import(\'./backend/server.js\').then(m => console.log(m.hashPassword(\'myPassword123\')))"').toString().trim();
  assert.strictEqual(run3, hashWithPasswordSalt);
});
