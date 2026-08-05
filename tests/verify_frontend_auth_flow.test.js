import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../backend/test_auth_flow.db');
const testPort = '3098';
const serverUrl = `http://127.0.0.1:${testPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Full authentication, profile selection, and catalog pipeline', async (t) => {
  const env = {
    ...process.env,
    PORT: testPort,
    DB_PATH: DB_PATH,
    JWT_SECRET: 'test_flow_secret',
    PASSWORD_SALT: 'test_flow_salt'
  };

  delete env.NODE_ENV;

  const serverProcess = spawn('node', ['backend/server.js'], { env });
  serverProcess.stdout.on('data', d => console.log('SERVER STDOUT:', d.toString()));
  serverProcess.stderr.on('data', d => console.error('SERVER STDERR:', d.toString()));

  await delay(1800);

  t.after(() => {
    serverProcess.kill();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  const testUser = { username: `flowuser_${Date.now()}`, password: 'password123' };

  // 1. Register User
  const regRes = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
  });
  assert.equal(regRes.status, 200);
  const regData = await regRes.json();
  assert.equal(regData.success, true);

  // 2. Login User
  const logRes = await fetch(`${serverUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testUser)
  });
  assert.equal(logRes.status, 200);
  const logData = await logRes.json();
  assert.ok(logData.token, 'Token should be present in login response');
  const baseToken = logData.token;

  // 3. Create Profile
  const createProfileRes = await fetch(`${serverUrl}/api/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${baseToken}`
    },
    body: JSON.stringify({ profile_name: 'Principal', avatar_color: '#a855f7', is_kids: false })
  });
  assert.equal(createProfileRes.status, 200);

  // 4. Fetch User Profiles
  const profilesRes = await fetch(`${serverUrl}/api/profiles`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${baseToken}` }
  });
  assert.equal(profilesRes.status, 200);
  const profilesData = await profilesRes.json();
  assert.ok(Array.isArray(profilesData.profiles), 'Profiles should be an array');
  assert.ok(profilesData.profiles.length > 0, 'Profile should be present');

  const defaultProfile = profilesData.profiles[0];

  // 5. Select Profile
  const selectRes = await fetch(`${serverUrl}/api/profiles/select`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${baseToken}`
    },
    body: JSON.stringify({ profile_name: defaultProfile.profile_name })
  });
  assert.equal(selectRes.status, 200);
  const selectData = await selectRes.json();
  assert.ok(selectData.token, 'Profile selection token should be returned');
  const profileToken = selectData.token;

  // 6. Fetch Shows Catalog with Profile Token
  const showsRes = await fetch(`${serverUrl}/api/shows`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${profileToken}` }
  });
  assert.equal(showsRes.status, 200);
  const showsData = await showsRes.json();
  assert.ok(Array.isArray(showsData), 'Shows catalog should return an array');
});
