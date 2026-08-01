import test from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { dbHelper, runMigrations, db } from '../backend/db.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

function signToken(payload) {
  const secret = process.env.JWT_SECRET || 'default_secret_key';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Kids Profile Filtration API Tests', async (t) => {
  const testPort = '3099';
  const serverUrl = `http://localhost:${testPort}`;
  process.env.JWT_SECRET = 'test_secret';
  const env = { ...process.env, PORT: testPort };
  
  // Ensure migration is run
  runMigrations(db);

  // Seed DB with TV-14 and TV-MA shows
  const tv14ShowId = `tv14_show_${Date.now()}`;
  const tvmaShowId = `tvma_show_${Date.now()}`;
  
  dbHelper.saveShow({
    id: tv14ShowId,
    title: 'Safe Show',
    media_type: 'anime',
    age_rating: 'TV-14'
  });
  
  dbHelper.saveShow({
    id: tvmaShowId,
    title: 'Adult Show',
    media_type: 'anime',
    age_rating: 'TV-MA'
  });
  
  const rShowId = `r_show_${Date.now()}`;
  dbHelper.saveShow({
    id: rShowId,
    title: 'R Rated Show',
    media_type: 'anime',
    age_rating: 'R'
  });
  
  // Create an episode for TV-MA show for stream test
  const tvmaEpId = `tvma_ep_${Date.now()}`;
  dbHelper.saveEpisode({
    id: tvmaEpId,
    show_id: tvmaShowId,
    season_number: 1,
    episode_number: 1,
    filepath: '/tmp/dummy.mp4'
  });

  const rEpId = `r_ep_${Date.now()}`;
  dbHelper.saveEpisode({
    id: rEpId,
    show_id: rShowId,
    season_number: 1,
    episode_number: 1,
    filepath: '/tmp/dummy2.mp4'
  });

  // Start Server
  const serverProcess = spawn('node', ['backend/server.js'], { env });
  await delay(1000); // wait for server to start

  // Create dummy files for stream tests
  fs.writeFileSync('/tmp/dummy.mp4', 'dummy content');
  fs.writeFileSync('/tmp/dummy2.mp4', 'dummy content 2');

  try {
    // Standard User Token (Adult)
    const adultToken = signToken({ username: 'tester', is_kids: false, role: 'user' });
    
    // Kids Profile Token
    const kidsToken = signToken({ username: 'tester', is_kids: true, role: 'user' });

    // Test 1: GET /api/shows with adult token -> should include both
    const adultShowsRes = await fetch(`${serverUrl}/api/shows?type=all`, {
      headers: { 'Authorization': `Bearer ${adultToken}` }
    });
    const adultShows = await adultShowsRes.json();
    assert.ok(adultShows.find(s => s.id === tv14ShowId), 'Adult should see TV-14 show');
    assert.ok(adultShows.find(s => s.id === tvmaShowId), 'Adult should see TV-MA show');
    assert.ok(adultShows.find(s => s.id === rShowId), 'Adult should see R show');

    // Test 2: GET /api/shows with kids token -> should exclude TV-MA and R
    const kidsShowsRes = await fetch(`${serverUrl}/api/shows?type=all`, {
      headers: { 'Authorization': `Bearer ${kidsToken}` }
    });
    const kidsShows = await kidsShowsRes.json();
    assert.ok(kidsShows.find(s => s.id === tv14ShowId), 'Kids should see TV-14 show');
    assert.strictEqual(kidsShows.find(s => s.id === tvmaShowId), undefined, 'Kids should NOT see TV-MA show');
    assert.strictEqual(kidsShows.find(s => s.id === rShowId), undefined, 'Kids should NOT see R show');

    // Test 3: GET /api/shows/:id for TV-MA and R with kids token -> 403 Forbidden
    const tvmaDetailRes = await fetch(`${serverUrl}/api/shows/${tvmaShowId}`, {
      headers: { 'Authorization': `Bearer ${kidsToken}` }
    });
    assert.strictEqual(tvmaDetailRes.status, 403);

    const rDetailRes = await fetch(`${serverUrl}/api/shows/${rShowId}`, {
      headers: { 'Authorization': `Bearer ${kidsToken}` }
    });
    assert.strictEqual(rDetailRes.status, 403);

    // Test 4: GET /api/shows/:id for TV-MA and R with adult token -> 200 OK
    const tvmaDetailAdultRes = await fetch(`${serverUrl}/api/shows/${tvmaShowId}`, {
      headers: { 'Authorization': `Bearer ${adultToken}` }
    });
    assert.strictEqual(tvmaDetailAdultRes.status, 200);

    const rDetailAdultRes = await fetch(`${serverUrl}/api/shows/${rShowId}`, {
      headers: { 'Authorization': `Bearer ${adultToken}` }
    });
    assert.strictEqual(rDetailAdultRes.status, 200);

    // Test 5: GET /api/stream/:episode_id for TV-MA and R with kids token -> 403 Forbidden
    const streamRes = await fetch(`${serverUrl}/api/stream/${tvmaEpId}`, {
      headers: { 'Authorization': `Bearer ${kidsToken}` }
    });
    assert.strictEqual(streamRes.status, 403);
    
    const streamResR = await fetch(`${serverUrl}/api/stream/${rEpId}`, {
      headers: { 'Authorization': `Bearer ${kidsToken}` }
    });
    assert.strictEqual(streamResR.status, 403);
    
    // Alternative streaming auth test: pass token in query
    const streamQueryRes = await fetch(`${serverUrl}/api/stream/${tvmaEpId}?token=${kidsToken}`);
    assert.strictEqual(streamQueryRes.status, 403);
    
    const streamQueryResR = await fetch(`${serverUrl}/api/stream/${rEpId}?token=${kidsToken}`);
    assert.strictEqual(streamQueryResR.status, 403);
    
    // Test 6: GET /api/stream/:episode_id for TV-MA and R with adult token -> 200 or 206 OK
    const streamAdultRes = await fetch(`${serverUrl}/api/stream/${tvmaEpId}`, {
      headers: { 'Authorization': `Bearer ${adultToken}` }
    });
    assert.ok(streamAdultRes.status === 200 || streamAdultRes.status === 206, `Adult stream TV-MA returned ${streamAdultRes.status}`);

    const streamAdultResR = await fetch(`${serverUrl}/api/stream/${rEpId}`, {
      headers: { 'Authorization': `Bearer ${adultToken}` }
    });
    assert.ok(streamAdultResR.status === 200 || streamAdultResR.status === 206, `Adult stream R returned ${streamAdultResR.status}`);

  } finally {
    serverProcess.kill();
    // Cleanup DB
    dbHelper.deleteShow(tv14ShowId);
    dbHelper.deleteShow(tvmaShowId);
    dbHelper.deleteShow(rShowId);
    db.prepare("DELETE FROM episodes WHERE id = ?").run(tvmaEpId);
    db.prepare("DELETE FROM episodes WHERE id = ?").run(rEpId);
    
    try { fs.unlinkSync('/tmp/dummy.mp4'); } catch(e){}
    try { fs.unlinkSync('/tmp/dummy2.mp4'); } catch(e){}
  }
});
