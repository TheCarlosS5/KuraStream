import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { dbHelper } from '../backend/db.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Profiles API Integration Tests', async (t) => {
  const testPort = '3097';
  const serverUrl = `http://localhost:${testPort}`;

  const env = {
    ...process.env,
    PORT: testPort,
    JWT_SECRET: 'test_secret'
  };

  const serverProcess = spawn('node', ['backend/server.js'], { env });
  await delay(1000); // wait for server to start

  let token = '';

  try {
    // 1. Create a user and get token
    const loginRes = await fetch(`${serverUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'profile_tester', password: 'password123' })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.success, true);
    token = loginData.token;
    assert.ok(token);

    const profileName = `KidsProfile_${Date.now()}`;
    
    // 2. Create a new profile (POST /api/profiles)
    const createRes = await fetch(`${serverUrl}/api/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        profile_name: profileName,
        avatar_color: '#ff0000',
        is_kids: true,
        pin: '1234'
      })
    });
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true, `Failed to create profile: ${JSON.stringify(createData)}`);

    // 3. List profiles (GET /api/profiles)
    const listRes = await fetch(`${serverUrl}/api/profiles`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const listData = await listRes.json();
    assert.strictEqual(listData.success, true);
    const profile = listData.profiles.find(p => p.profile_name === profileName);
    assert.ok(profile, 'Created profile not found in list');
    assert.strictEqual(profile.avatar_color, '#ff0000');
    assert.strictEqual(profile.is_kids, 1);
    assert.strictEqual(profile.pin, '1234');

    // 4. Edit a profile (PUT /api/profiles/:profile_name)
    const editRes = await fetch(`${serverUrl}/api/profiles/${profileName}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        avatar_color: '#00ff00',
        is_kids: false,
        pin: '4321'
      })
    });
    const editData = await editRes.json();
    assert.strictEqual(editData.success, true, 'Failed to update profile');

    // Verify update
    const verifyUpdateRes = await fetch(`${serverUrl}/api/profiles`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const verifyUpdateData = await verifyUpdateRes.json();
    const updatedProfile = verifyUpdateData.profiles.find(p => p.profile_name === profileName);
    assert.strictEqual(updatedProfile.avatar_color, '#00ff00');
    assert.strictEqual(updatedProfile.is_kids, 0);

    // 5. Select a profile (POST /api/profiles/select) with WRONG PIN
    const selectWrongPinRes = await fetch(`${serverUrl}/api/profiles/select`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ profile_name: profileName, pin: '0000' })
    });
    assert.strictEqual(selectWrongPinRes.status, 401, 'Should reject invalid PIN');

    // 6. Select a profile (POST /api/profiles/select) with CORRECT PIN
    const selectRes = await fetch(`${serverUrl}/api/profiles/select`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ profile_name: profileName, pin: '4321' })
    });
    const selectData = await selectRes.json();
    assert.strictEqual(selectData.success, true, 'Failed to select profile');
    assert.ok(selectData.token, 'Should return a new JWT token');
    
    // Test that token has profile_name by parsing it
    const payloadBase64 = selectData.token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    assert.strictEqual(payload.username, 'profile_tester');
    assert.strictEqual(payload.profile_name, profileName);
    assert.strictEqual(payload.is_kids, false);

    // 7. Delete a profile (DELETE /api/profiles/:profile_name)
    const delRes = await fetch(`${serverUrl}/api/profiles/${profileName}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true, 'Failed to delete profile');

    // Verify deletion
    const verifyDelRes = await fetch(`${serverUrl}/api/profiles`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const verifyDelData = await verifyDelRes.json();
    const deletedProfile = verifyDelData.profiles.find(p => p.profile_name === profileName);
    assert.strictEqual(deletedProfile, undefined, 'Profile should have been deleted');

  } finally {
    serverProcess.kill();
  }
});
