import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.describe('KuraStream Auth & Profile PIN Security Integration Suite', () => {
  test.beforeEach(async ({ request }) => {
    // Check if real database is connected; skip if MySQL is offline
    try {
      const healthRes = await request.get('/api/health');
      if (healthRes.status() === 503) {
        test.skip(true, 'Database is disconnected (MySQL offline)');
      }
      const data = await healthRes.json();
      if (data.database !== 'connected') {
        test.skip(true, 'Database is not connected');
      }
    } catch {
      test.skip(true, 'Health endpoint unavailable');
    }
  });

  test('Full 10-step Profile PIN bypass prevention and history isolation', async ({ request }) => {
    const timestamp = Date.now();
    const testUsername = `user_pin_${timestamp}`;
    const testPassword = 'SecurePassword123!';

    // 1. Register a new user
    const regRes = await request.post('/api/register', {
      data: {
        username: testUsername,
        password: testPassword
      }
    });
    expect(regRes.status()).toBe(200);
    const regData = await regRes.json();
    expect(regData.success).toBe(true);
    const tokenNoProfile = regData.token;
    expect(tokenNoProfile).toBeDefined();

    // 2. Attempt to access profile-scoped endpoints with login token without active profile
    // Must return 403 PROFILE_REQUIRED
    const histNoProfileRes = await request.get('/api/history', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` }
    });
    expect(histNoProfileRes.status()).toBe(403);
    const histErr = await histNoProfileRes.json();
    expect(histErr.code).toBe('PROFILE_REQUIRED');

    // 3. Attempt to access stream endpoint without active profile
    // Must return 403 PROFILE_REQUIRED
    const streamNoProfileRes = await request.get('/api/stream/test_episode_dummy', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` }
    });
    expect(streamNoProfileRes.status()).toBe(403);
    const streamErr = await streamNoProfileRes.json();
    expect(streamErr.code).toBe('PROFILE_REQUIRED');

    // 4. Create Profile A (without PIN)
    const createProfileARes = await request.post('/api/profiles', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` },
      data: {
        name: 'Perfil A',
        is_kids: 0,
        color: '#3b82f6'
      }
    });
    expect(createProfileARes.status()).toBe(200);
    const profileAData = await createProfileARes.json();
    const profileA = profileAData.profile;
    expect(profileA.id).toBeDefined();

    // 5. Create Profile B (with PIN '7788')
    const createProfileBRes = await request.post('/api/profiles', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` },
      data: {
        name: 'Perfil B',
        is_kids: 0,
        pin: '7788',
        color: '#ef4444'
      }
    });
    expect(createProfileBRes.status()).toBe(200);
    const profileBData = await createProfileBRes.json();
    const profileB = profileBData.profile;
    expect(profileB.id).toBeDefined();

    // 6. Attempt to select Profile B without PIN -> 403 forbidden
    const selectBNoPinRes = await request.post('/api/profiles/select', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` },
      data: {
        profile_id: profileB.id
      }
    });
    expect(selectBNoPinRes.status()).toBe(403);

    // 7. Attempt to select Profile B with wrong PIN -> 403 forbidden
    const selectBWrongPinRes = await request.post('/api/profiles/select', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` },
      data: {
        profile_id: profileB.id,
        pin: '0000'
      }
    });
    expect(selectBWrongPinRes.status()).toBe(403);

    // 8. Select Profile B with correct PIN ('7788') -> 200 OK with new token
    const selectBSuccessRes = await request.post('/api/profiles/select', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` },
      data: {
        profile_id: profileB.id,
        pin: '7788'
      }
    });
    expect(selectBSuccessRes.status()).toBe(200);
    const selectBData = await selectBSuccessRes.json();
    expect(selectBData.success).toBe(true);
    const tokenProfileB = selectBData.token;
    expect(tokenProfileB).toBeDefined();

    // 9. With Profile B token, access history -> 200 OK (empty array)
    const histBRes = await request.get('/api/history', {
      headers: { Authorization: `Bearer ${tokenProfileB}` }
    });
    expect(histBRes.status()).toBe(200);
    const histBData = await histBRes.json();
    expect(Array.isArray(histBData)).toBe(true);

    // 10. Record watch progress under Profile B
    // Seed canonical show and episode in DB to preserve referential integrity
    try {
      const phpCode = `require_once 'php_backend/db.php'; DbHelper::saveShow(['id'=>'show_pin_test_${timestamp}','title'=>'Pin Test Show','media_type'=>'anime']); DbHelper::saveEpisode(['id'=>'ep_pin_test_${timestamp}','show_id'=>'show_pin_test_${timestamp}','season_number'=>1,'episode_number'=>1,'title'=>'Pin Test Ep','filepath'=>'/media/ep_pin_test.mp4','duration'=>1400.0]);`;
      const b64 = Buffer.from(phpCode).toString('base64');
      execSync(`php -r "eval(base64_decode('${b64}'));"`, { stdio: 'ignore' });
    } catch {
      // In environment without CLI PHP, ignore
    }

    const saveProgressRes = await request.post('/api/progress', {
      headers: { Authorization: `Bearer ${tokenProfileB}` },
      data: {
        episode_id: `ep_pin_test_${timestamp}`,
        progress: 300,
        duration: 1400,
        completed: false
      }
    });
    expect(saveProgressRes.status()).toBe(200);

    // Verify history now contains the episode for Profile B
    const updatedHistBRes = await request.get('/api/history', {
      headers: { Authorization: `Bearer ${tokenProfileB}` }
    });
    expect(updatedHistBRes.status()).toBe(200);
    const updatedHistB = await updatedHistBRes.json();
    expect(updatedHistB.some(item => item.episode_id === `ep_pin_test_${timestamp}`)).toBe(true);

    // 11. Select Profile A (no PIN required) -> 200 OK with Profile A token
    const selectARes = await request.post('/api/profiles/select', {
      headers: { Authorization: `Bearer ${tokenNoProfile}` },
      data: {
        profile_id: profileA.id
      }
    });
    expect(selectARes.status()).toBe(200);
    const selectAData = await selectARes.json();
    const tokenProfileA = selectAData.token;
    expect(tokenProfileA).toBeDefined();

    // 12. Check Profile A history -> must NOT contain Profile B's episode (strict profile isolation!)
    const histARes = await request.get('/api/history', {
      headers: { Authorization: `Bearer ${tokenProfileA}` }
    });
    expect(histARes.status()).toBe(200);
    const histAData = await histARes.json();
    expect(histAData.some(item => item.episode_id === `ep_pin_test_${timestamp}`)).toBe(false);

    // Cleanup seeded test fixtures
    try {
      const cleanupPhp = `require_once 'php_backend/db.php'; DbHelper::deleteShow('show_pin_test_${timestamp}');`;
      const b64Clean = Buffer.from(cleanupPhp).toString('base64');
      execSync(`php -r "eval(base64_decode('${b64Clean}'));"`, { stdio: 'ignore' });
    } catch {
      // Ignore
    }
  });
});
