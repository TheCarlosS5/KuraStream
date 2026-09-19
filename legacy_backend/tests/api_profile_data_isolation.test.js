import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Multi-Profile Data Isolation Integration Tests', async (t) => {
  const testPort = '3093';
  const serverUrl = `http://localhost:${testPort}`;
  process.env.JWT_SECRET = 'isolation_test_secret';
  process.env.DB_PATH = './backend/kurastream_test_isolation.db';

  // Setup fresh isolated DB
  try { fs.unlinkSync(process.env.DB_PATH); } catch(e) {}
  try { fs.unlinkSync(process.env.DB_PATH + '-journal'); } catch(e) {}
  try { fs.unlinkSync(process.env.DB_PATH + '-wal'); } catch(e) {}
  try { fs.unlinkSync(process.env.DB_PATH + '-shm'); } catch(e) {}

  // Use dynamic import to bootstrap the isolated DB
  const { dbHelper, db, runMigrations } = await import(`../backend/db.js?bust=${Date.now()}`);
  runMigrations(db);

  // Seed two shows
  const showA = 'show_isolation_a';
  const showB = 'show_isolation_b';
  dbHelper.saveShow({ id: showA, title: 'Show A', media_type: 'anime', age_rating: 'TV-14' });
  dbHelper.saveShow({ id: showB, title: 'Show B', media_type: 'anime', age_rating: 'TV-14' });

  // Seed episode for showA
  const epA = 'ep_isolation_a';
  dbHelper.saveEpisode({ id: epA, show_id: showA, season_number: 1, episode_number: 1, filepath: '/tmp/dummy_iso.mp4' });
  
  // Create dummy MP4
  try { fs.writeFileSync('/tmp/dummy_iso.mp4', 'dummy video content'); } catch(e) {}

  const env = { ...process.env, PORT: testPort };
  const serverProcess = spawn('node', ['backend/server.js'], { env });
  await delay(1000); // wait for server

  try {
    // 1. Register and Login user
    await fetch(`${serverUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'iso_user', password: 'password123' })
    });

    const loginRes = await fetch(`${serverUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'iso_user', password: 'password123' })
    });
    const { token: userToken } = await loginRes.json();

    // 2. Create Profile A and Profile B
    await fetch(`${serverUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({ profile_name: 'ProfileA', avatar_color: '#9d00ff', is_kids: false })
    });

    await fetch(`${serverUrl}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({ profile_name: 'ProfileB', avatar_color: '#00e08f', is_kids: false })
    });

    // 3. Select Profile A and Profile B to get JWT tokens
    const selARes = await fetch(`${serverUrl}/api/profiles/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({ profile_name: 'ProfileA' })
    });
    const { token: tokenA } = await selARes.json();

    const selBRes = await fetch(`${serverUrl}/api/profiles/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({ profile_name: 'ProfileB' })
    });
    const { token: tokenB } = await selBRes.json();

    // 4. Toggle Favorite on Profile A
    await fetch(`${serverUrl}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
      body: JSON.stringify({ username: 'iso_user', showId: showA, isFavorite: true })
    });

    // 5. Verify Favorite is isolated to Profile A
    const checkARes = await fetch(`${serverUrl}/api/favorites/check?username=iso_user&showId=${showA}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const { isFavorite: isFavA } = await checkARes.json();
    assert.strictEqual(isFavA, true, 'Profile A should have Show A in favorites');

    const checkBRes = await fetch(`${serverUrl}/api/favorites/check?username=iso_user&showId=${showA}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const { isFavorite: isFavB } = await checkBRes.json();
    assert.strictEqual(isFavB, false, 'Profile B should NOT have Show A in favorites');

    // 6. Save Watch Progress on Profile A
    await fetch(`${serverUrl}/api/progress/${epA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
      body: JSON.stringify({ username: 'iso_user', progress: 120.5 })
    });

    // 7. Verify Watch Progress is isolated to Profile A
    const progARes = await fetch(`${serverUrl}/api/progress/${epA}?username=iso_user`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const { progress: progA } = await progARes.json();
    assert.strictEqual(progA, 120.5, 'Profile A should retrieve watch progress');

    const progBRes = await fetch(`${serverUrl}/api/progress/${epA}?username=iso_user`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const { progress: progB } = await progBRes.json();
    assert.strictEqual(progB, 0, 'Profile B should have no watch progress (0)');

    // 8. Verify Watch History list is isolated to Profile A
    const histARes = await fetch(`${serverUrl}/api/history?username=iso_user`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const histA = await histARes.json();
    assert.strictEqual(histA.length, 1, 'Profile A history should contain 1 item');

    const histBRes = await fetch(`${serverUrl}/api/history?username=iso_user`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const histB = await histBRes.json();
    assert.strictEqual(histB.length, 0, 'Profile B history should be empty (0)');

  } finally {
    serverProcess.kill();
    // Cleanup DB
    try { db.close(); } catch(e) {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch(e) {}
    try { fs.unlinkSync(process.env.DB_PATH + '-journal'); } catch(e) {}
    try { fs.unlinkSync(process.env.DB_PATH + '-wal'); } catch(e) {}
    try { fs.unlinkSync(process.env.DB_PATH + '-shm'); } catch(e) {}
    try { fs.unlinkSync('/tmp/dummy_iso.mp4'); } catch(e) {}
  }
});
