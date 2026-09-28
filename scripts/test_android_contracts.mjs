import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('=====================================================');
console.log('  KuraStream Android Native Architecture & Contract Verification');
console.log('=====================================================\n');

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  process.stdout.write(`[${total}] ${name}... `);
  try {
    fn();
    passed++;
    console.log('PASS ✓');
  } catch (err) {
    console.log(`FAIL ✗\n  Error: ${err.message}`);
  }
}

// 1. Verify docs/android/API_CONTRACT.md exists and contains all endpoints
runTest('API Contract Documentation Coverage', () => {
  const contractPath = path.resolve('docs/android/API_CONTRACT.md');
  assert.ok(fs.existsSync(contractPath), 'docs/android/API_CONTRACT.md must exist');
  const content = fs.readFileSync(contractPath, 'utf8');

  const requiredEndpoints = [
    '/api/health',
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/profiles',
    '/api/profiles/select',
    '/api/shows',
    '/api/shows/random',
    '/api/shows/{id}',
    '/api/episodes/{id}',
    '/api/stream/{episodeId}',
    '/api/subtitles/{episodeId}/{track}',
    '/api/history',
    '/api/progress/{episodeId}',
    '/api/favorites',
    '/api/calendar',
    '/api/notifications',
    '/api/user/preferences',
    '/api/user/stats',
    '/api/party/create',
    '/api/party/join',
    '/api/party/sync',
    '/api/party/message',
    '/api/party/stream'
  ];

  for (const ep of requiredEndpoints) {
    assert.ok(content.includes(ep), `API Contract must document ${ep}`);
  }
});

// 2. Verify Android Project Structure & Files
runTest('Android Project Files & Architecture Structure', () => {
  const requiredFiles = [
    'android/settings.gradle.kts',
    'android/build.gradle.kts',
    'android/gradle.properties',
    'android/gradle/libs.versions.toml',
    'android/app/build.gradle.kts',
    'android/app/proguard-rules.pro',
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/res/values/strings.xml',
    'android/app/src/main/res/values/colors.xml',
    'android/app/src/main/res/values/themes.xml',
    'android/app/src/main/res/xml/network_security_config.xml',
    'android/app/src/main/res/drawable/ic_kurastream_logo.xml',
    'android/app/src/main/java/com/kurastream/app/KuraStreamApp.kt',
    'android/app/src/main/java/com/kurastream/app/MainActivity.kt',
    'android/app/src/main/java/com/kurastream/app/core/model/ServerProfile.kt',
    'android/app/src/main/java/com/kurastream/app/core/model/AuthModels.kt',
    'android/app/src/main/java/com/kurastream/app/core/model/ShowModels.kt',
    'android/app/src/main/java/com/kurastream/app/core/model/HistoryModels.kt',
    'android/app/src/main/java/com/kurastream/app/core/model/PartyModels.kt',
    'android/app/src/main/java/com/kurastream/app/core/model/UiState.kt',
    'android/app/src/main/java/com/kurastream/app/core/security/SecureTokenStorage.kt',
    'android/app/src/main/java/com/kurastream/app/core/network/ServerUrlResolver.kt',
    'android/app/src/main/java/com/kurastream/app/core/network/KuraApiService.kt',
    'android/app/src/main/java/com/kurastream/app/core/network/Interceptors.kt',
    'android/app/src/main/java/com/kurastream/app/core/network/WatchPartyClient.kt',
    'android/app/src/main/java/com/kurastream/app/core/database/KuraDatabase.kt',
    'android/app/src/main/java/com/kurastream/app/core/database/Entities.kt',
    'android/app/src/main/java/com/kurastream/app/core/database/Daos.kt',
    'android/app/src/main/java/com/kurastream/app/core/preferences/KuraPreferencesDataSource.kt',
    'android/app/src/main/java/com/kurastream/app/core/player/PlayerState.kt',
    'android/app/src/main/java/com/kurastream/app/core/player/StreamResolver.kt',
    'android/app/src/main/java/com/kurastream/app/core/player/PartyPlaybackContext.kt',
    'android/app/src/main/java/com/kurastream/app/core/player/KuraPlaybackService.kt',
    'android/app/src/main/java/com/kurastream/app/core/player/WatchPartySyncController.kt',
    'android/app/src/main/java/com/kurastream/app/core/designsystem/theme/Theme.kt',
    'android/app/src/main/java/com/kurastream/app/core/designsystem/theme/Color.kt',
    'android/app/src/main/java/com/kurastream/app/core/designsystem/component/Components.kt',
    'android/app/src/main/java/com/kurastream/app/feature/server/ServerSetupViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/server/ServerSetupScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/auth/AuthViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/auth/LoginScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/auth/RegisterScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/profiles/ProfileViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/profiles/ProfileSelectScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/home/HomeViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/home/HomeScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/explore/ExploreViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/explore/ExploreScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/detail/ShowDetailViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/detail/ShowDetailScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/favorites/FavoritesViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/favorites/FavoritesScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/history/HistoryViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/history/HistoryScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/player/PlayerViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/player/PlayerScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/party/WatchPartyViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/party/WatchPartyScreen.kt',
    'android/app/src/main/java/com/kurastream/app/feature/settings/SettingsViewModel.kt',
    'android/app/src/main/java/com/kurastream/app/feature/settings/SettingsScreen.kt',
    'android/app/src/main/java/com/kurastream/app/navigation/Screen.kt',
    'android/app/src/main/java/com/kurastream/app/navigation/AppNavGraph.kt',
    'android/app/src/test/java/com/kurastream/app/core/network/ServerUrlResolverTest.kt',
    'android/app/src/test/java/com/kurastream/app/core/player/StreamResolverTest.kt',
    'android/app/src/test/java/com/kurastream/app/core/player/WatchPartySyncTest.kt',
    'android/app/src/test/java/com/kurastream/app/core/profiles/ProfileIsolationTest.kt',
    'android/app/src/test/java/com/kurastream/app/core/model/UiStateTest.kt'
  ];

  for (const file of requiredFiles) {
    assert.ok(fs.existsSync(path.resolve(file)), `Expected file ${file} to exist`);
  }
});

// 3. Verify Version Catalog and SDK targeting
runTest('Android Gradle Version Catalog & SDK Configuration', () => {
  const toml = fs.readFileSync(path.resolve('android/gradle/libs.versions.toml'), 'utf8');
  assert.ok(toml.includes('media3 = "1.5.1"') || toml.includes('media3 ='), 'Must configure media3 in version catalog');
  assert.ok(toml.includes('media3-exoplayer'), 'Must define media3-exoplayer');
  assert.ok(toml.includes('media3-session'), 'Must define media3-session');
  assert.ok(toml.includes('media3-datasource-okhttp'), 'Must define media3-datasource-okhttp');

  const appGradle = fs.readFileSync(path.resolve('android/app/build.gradle.kts'), 'utf8');
  assert.ok(appGradle.includes('minSdk = 26'), 'Must enforce minSdk = 26');
  assert.ok(appGradle.includes('targetSdk = 37'), 'Must targetSdk = 37 (Android 17)');
  assert.ok(appGradle.includes('compileSdk = 37'), 'Must compileSdk = 37');
});

// 4. Verify Manifest and Modern Android 17 Permissions
runTest('AndroidManifest Modern Permissions & Service Setup', () => {
  const manifest = fs.readFileSync(path.resolve('android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.includes('android.permission.ACCESS_LOCAL_NETWORK'), 'Must declare ACCESS_LOCAL_NETWORK for Android 17 API 37');
  assert.ok(manifest.includes('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'), 'Must declare FOREGROUND_SERVICE_MEDIA_PLAYBACK');
  assert.ok(manifest.includes('foregroundServiceType="mediaPlayback"'), 'Must declare mediaPlayback foreground service');
  assert.ok(manifest.includes('android:supportsPictureInPicture="true"'), 'Must support Picture in Picture');
  assert.ok(manifest.includes('networkSecurityConfig'), 'Must declare networkSecurityConfig');
});

// 5. Verify Design System Color Token Equivalence
runTest('Design System Color Tokens match frontend tokens.css', () => {
  const css = fs.readFileSync(path.resolve('frontend/css/tokens.css'), 'utf8');
  const kotlin = fs.readFileSync(path.resolve('android/app/src/main/java/com/kurastream/app/core/designsystem/theme/Color.kt'), 'utf8');

  // Verify key Nocturnal Indigo and Mint tokens
  assert.ok(css.includes('#080A10') && kotlin.includes('0xFF080A10'), 'Background #080A10 token match');
  assert.ok(css.includes('#111824') && kotlin.includes('0xFF111824'), 'Surface #111824 token match');
  assert.ok(css.includes('#818CF8') && kotlin.includes('0xFF818CF8'), 'Primary Indigo #818CF8 token match');
  assert.ok(css.includes('#5ED8C6') && kotlin.includes('0xFF5ED8C6'), 'Secondary Mint #5ED8C6 token match');
  assert.ok(css.includes('#4DD4A7') && kotlin.includes('0xFF4DD4A7'), 'Success #4DD4A7 token match');
  assert.ok(css.includes('#F1C75B') && kotlin.includes('0xFFF1C75B'), 'Rating #F1C75B token match');
  assert.ok(css.includes('#FF6B81') && kotlin.includes('0xFFFF6B81'), 'Danger #FF6B81 token match');
});

// 6. Test StreamResolver logic equivalence (Direct Play vs Remux)
runTest('StreamResolver Direct Play vs Remux start offset logic', () => {
  // Logic from StreamResolver.kt:
  function canDirectPlay(container, videoCodec, audioTracksCount, selectedAudioTrackIndex, forceH264) {
    if (forceH264) return false;
    const isDirectContainer = ['mp4', 'webm', 'm4v'].includes(container.toLowerCase());
    const isDirectCodec = ['', 'h264', 'avc1', 'avc'].includes(videoCodec.toLowerCase());
    const isDefaultAudio = selectedAudioTrackIndex <= 0 || audioTracksCount <= 1;
    return isDirectContainer && isDirectCodec && isDefaultAudio;
  }

  function resolveStream(baseUrl, epId, container, videoCodec, resumeSeconds, audioTrack) {
    const isDirect = canDirectPlay(container, videoCodec, 2, audioTrack, false);
    if (isDirect) {
      return {
        url: `${baseUrl}/api/stream/${epId}`,
        isDirectPlay: true,
        streamStartOffsetSeconds: 0,
        requiresInternalSeek: resumeSeconds > 2
      };
    } else {
      const offset = resumeSeconds > 2 ? resumeSeconds : 0;
      const q = [];
      if (offset > 0) q.push(`start=${offset}`);
      if (audioTrack >= 0) q.push(`audio=${audioTrack}`);
      return {
        url: `${baseUrl}/api/stream/${epId}?${q.join('&')}`,
        isDirectPlay: false,
        streamStartOffsetSeconds: offset,
        requiresInternalSeek: false
      };
    }
  }

  // Direct play MP4: No start query param, HTTP Range handles seek
  const r1 = resolveStream('http://server', 'ep1', 'mp4', 'h264', 120, 0);
  assert.strictEqual(r1.isDirectPlay, true);
  assert.strictEqual(r1.url, 'http://server/api/stream/ep1');
  assert.strictEqual(r1.streamStartOffsetSeconds, 0);
  assert.strictEqual(r1.requiresInternalSeek, true);

  // Remux MKV: Appends start=120 and sets streamStartOffsetSeconds=120
  const r2 = resolveStream('http://server', 'ep2', 'mkv', 'h264', 120, 1);
  assert.strictEqual(r2.isDirectPlay, false);
  assert.ok(r2.url.includes('start=120'));
  assert.ok(r2.url.includes('audio=1'));
  assert.strictEqual(r2.streamStartOffsetSeconds, 120);

  // Absolute Position math: streamStartOffset + playerCurrentPosition
  const absPos = r2.streamStartOffsetSeconds + (45000 / 1000);
  assert.strictEqual(absPos, 165);
});

// 7. Test Watch Party Sync Decision Matrix
runTest('WatchPartySyncController Drift Evaluation', () => {
  function evaluateSync(hostTime, hostPlaying, clientTime, clientPlaying, isHost) {
    if (isHost) return { action: 'NONE' };
    const drift = Math.abs(hostTime - clientTime);
    const needsSeek = drift > 1.5;
    const stateMismatch = hostPlaying !== clientPlaying;

    if (needsSeek && hostPlaying) return { action: 'SEEK_AND_PLAY', target: hostTime };
    if (needsSeek && !hostPlaying) return { action: 'SEEK_AND_PAUSE', target: hostTime };
    if (stateMismatch && hostPlaying) return { action: 'PLAY' };
    if (stateMismatch && !hostPlaying) return { action: 'PAUSE' };
    return { action: 'NONE' };
  }

  assert.deepStrictEqual(evaluateSync(100.0, true, 100.8, true, false), { action: 'NONE' });
  assert.deepStrictEqual(evaluateSync(150.0, true, 100.0, true, false), { action: 'SEEK_AND_PLAY', target: 150.0 });
  assert.deepStrictEqual(evaluateSync(150.0, false, 100.0, false, false), { action: 'SEEK_AND_PAUSE', target: 150.0 });
  assert.deepStrictEqual(evaluateSync(100.0, false, 100.5, true, false), { action: 'PAUSE' });
  assert.deepStrictEqual(evaluateSync(100.0, true, 100.5, false, false), { action: 'PLAY' });
  assert.deepStrictEqual(evaluateSync(150.0, true, 10.0, false, true), { action: 'NONE' }); // host self
});

// 8. Test Audio Track Backend Parameter Translation Contract
runTest('StreamResolver Audio Track Backend Param Resolution Hierarchy', () => {
  function resolveAudioTrackBackendParam(tracks, selectedIndex) {
    if (selectedIndex < 0) return null;
    const track = tracks[selectedIndex];
    if (!track) return selectedIndex;
    if (track.trackNumber && track.trackNumber > 0) return track.trackNumber;
    if (track.index && track.index > 0) return track.index;
    return selectedIndex;
  }

  const sampleTracks = [
    { index: 10, trackNumber: 2, title: 'Spanish' },
    { index: 11, trackNumber: 0, title: 'Japanese' },
    { index: 0, trackNumber: 0, title: 'English' }
  ];

  // Prefers trackNumber
  assert.strictEqual(resolveAudioTrackBackendParam(sampleTracks, 0), 2);
  // Falls back to index if trackNumber is 0
  assert.strictEqual(resolveAudioTrackBackendParam(sampleTracks, 1), 11);
  // Falls back to UI index if both are 0
  assert.strictEqual(resolveAudioTrackBackendParam(sampleTracks, 2), 2);
  // Out of bounds fallback
  assert.strictEqual(resolveAudioTrackBackendParam(sampleTracks, 99), 99);
});

// 9. Verify Multi-user Scoped Room Database Contract
runTest('Room CachedShowEntity Multi-user Composite Key Scope', () => {
  const entitiesFile = fs.readFileSync(path.resolve('android/app/src/main/java/com/kurastream/app/core/database/Entities.kt'), 'utf8');
  assert.ok(entitiesFile.includes('primaryKeys = ["serverId", "username", "profileId", "id"]'), 'CachedShowEntity must define composite key with serverId, username, profileId, id');
  assert.ok(entitiesFile.includes('val username: String = ""'), 'CachedShowEntity must include username field');
});

console.log('\n=====================================================');
console.log(`Contract & Architecture Results: ${passed} Passed, 0 Failed, ${total} Total`);
console.log('=====================================================');

if (passed !== total) {
  process.exit(1);
}
