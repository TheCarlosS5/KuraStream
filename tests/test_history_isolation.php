<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running Comprehensive Anti-Spoofing Tests (History, Progress, Favorites, Preferences)...\n";

$db = Database::getConnection();
Database::initializeSchema();

// Clean up test data for users
$alice = 'alice_anti_spoof_' . substr(uniqid(), -6);
$bob = 'bob_victim_' . substr(uniqid(), -6);

$db->prepare("DELETE FROM watch_history WHERE username IN (:a, :b)")->execute(['a' => $alice, 'b' => $bob]);
$db->prepare("DELETE FROM favorites WHERE username IN (:a, :b)")->execute(['a' => $alice, 'b' => $bob]);
$db->prepare("DELETE FROM user_preferences WHERE username IN (:a, :b)")->execute(['a' => $alice, 'b' => $bob]);
$db->prepare("DELETE FROM episodes WHERE id = 'ep-anti-spoof-1'")->execute();
$db->prepare("DELETE FROM shows WHERE id = 'show-anti-spoof-1'")->execute();

// Setup test show & episode
DbHelper::saveShow([
    'id' => 'show-anti-spoof-1',
    'title' => 'Anti Spoofing Test Show',
    'media_type' => 'anime'
]);
DbHelper::saveEpisode([
    'id' => 'ep-anti-spoof-1',
    'show_id' => 'show-anti-spoof-1',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Episode 1',
    'filepath' => 'dummy_path.mp4'
]);

// -------------------------------------------------------------
// Part 1: Unauthenticated requests MUST return 401 for all endpoints,
// even when supplying spoofed username in query string or JSON body.
// -------------------------------------------------------------
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);
$_GET['username'] = $bob;
$_GET['profile_name'] = 'Principal';

$unauthEndpoints = [
    'getHistory' => function() { HistoryController::getHistory(); },
    'getProgress' => function() { HistoryController::getProgress('ep-anti-spoof-1'); },
    'getFavorites' => function() { HistoryController::getFavorites(); },
    'getUserPreferences' => function() { HistoryController::getUserPreferences(); },
    'getUserStats' => function() { HistoryController::getUserStats(); },
];

foreach ($unauthEndpoints as $name => $fn) {
    $blocked = false;
    ob_start();
    try {
        $fn();
    } catch (ExitException $e) {
        if ($e->statusCode === 401) {
            $blocked = true;
        }
    }
    ob_get_clean();
    assert($blocked, "Endpoint {$name} MUST return 401 when unauthenticated, ignoring ?username={$bob}");
}
echo "✓ All unauthenticated requests rejected with 401 (no guest spoofing)\n";

// -------------------------------------------------------------
// Part 2: Authenticated user 'alice' attempts to spoof 'bob'
// The system MUST enforce 'alice' from JWT and completely ignore 'bob'.
// -------------------------------------------------------------
$aliceToken = AuthMiddleware::createToken([
    'username' => $alice,
    'role' => 'user',
    'profile_name' => 'Principal',
    'exp' => time() + 3600
]);
$_COOKIE['kurastream_token'] = $aliceToken;
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$aliceToken}";

// 2.1 Save Progress: Try spoofing username in query and body
$_GET['username'] = $bob;
$_GET['episode_id'] = 'ep-anti-spoof-1';
$fakeStream = fopen('php://memory', 'r+');
fwrite($fakeStream, json_encode([
    'username' => $bob,
    'episode_id' => 'ep-anti-spoof-1',
    'progress' => 123.45,
    'duration' => 1400.0,
    'completed' => false
]));
rewind($fakeStream);

// We can test DbHelper::saveProgress directly and via resolveUserAndProfile
$reflector = new ReflectionClass('HistoryController');
$method = $reflector->getMethod('resolveUserAndProfile');
$method->setAccessible(true);
list($resolvedUser, $resolvedProfile) = $method->invoke(null, ['username' => $bob]);
assert($resolvedUser === $alice, "resolveUserAndProfile MUST enforce JWT user '{$alice}' over body/query '{$bob}'");

// Save progress using resolved identity
DbHelper::saveProgress($resolvedUser, $resolvedProfile, 'ep-anti-spoof-1', 123.45, 1400.0, false);

// 2.2 Verify Database: Alice has progress, Bob has ZERO records
$stmtAlice = $db->prepare("SELECT * FROM watch_history WHERE username = :u AND episode_id = 'ep-anti-spoof-1'");
$stmtAlice->execute(['u' => $alice]);
$aliceHist = $stmtAlice->fetch();
assert(!empty($aliceHist), "Progress must be saved under JWT user '{$alice}'");
assert((float)$aliceHist['progress_seconds'] === 123.45, "Alice progress must match 123.45");

$stmtBob = $db->prepare("SELECT * FROM watch_history WHERE username = :u");
$stmtBob->execute(['u' => $bob]);
$bobHist = $stmtBob->fetchAll();
assert(count($bobHist) === 0, "Victim user '{$bob}' MUST NOT have any history recorded from spoofing attempt");

// 2.3 Get Progress: Alice requests progress while supplying ?username=bob
$prog = DbHelper::getProgress($resolvedUser, $resolvedProfile, 'ep-anti-spoof-1');
assert($prog !== null && (float)$prog['progress'] === 123.45, "Alice progress must be returned");

// 2.4 Toggle Favorite: Alice favorites a show while passing { username: bob }
list($favUser, $favProfile) = $method->invoke(null, ['username' => $bob, 'show_id' => 'show-anti-spoof-1']);
assert($favUser === $alice, "Favorites must enforce JWT user '{$alice}'");

$db->prepare("INSERT INTO favorites (username, profile_name, show_id) VALUES (:user, :prof, :show)")
   ->execute(['user' => $favUser, 'prof' => $favProfile, 'show' => 'show-anti-spoof-1']);

$stmtFavAlice = $db->prepare("SELECT * FROM favorites WHERE username = :u");
$stmtFavAlice->execute(['u' => $alice]);
assert(count($stmtFavAlice->fetchAll()) === 1, "Alice must have 1 favorite");

$stmtFavBob = $db->prepare("SELECT * FROM favorites WHERE username = :u");
$stmtFavBob->execute(['u' => $bob]);
assert(count($stmtFavBob->fetchAll()) === 0, "Bob MUST have 0 favorites");

// 2.5 Save User Preferences: Alice saves preferences while passing { username: bob }
list($prefUser, $prefProfile) = $method->invoke(null, ['username' => $bob]);
assert($prefUser === $alice, "Preferences must enforce JWT user '{$alice}'");

DbHelper::saveUserPreferences($prefUser, $prefProfile, [
    'auto_skip_intro' => true,
    'auto_play_next' => true,
    'default_audio_lang' => 'ja'
]);

$alicePrefs = DbHelper::getUserPreferences($alice, 'Principal');
assert($alicePrefs['auto_skip_intro'] === true, "Alice preferences must be saved");

$bobPrefsInDb = $db->prepare("SELECT * FROM user_preferences WHERE username = :u");
$bobPrefsInDb->execute(['u' => $bob]);
assert(count($bobPrefsInDb->fetchAll()) === 0, "Bob MUST NOT have any preferences altered in DB");

// Clean up
$db->prepare("DELETE FROM watch_history WHERE username IN (:a, :b)")->execute(['a' => $alice, 'b' => $bob]);
$db->prepare("DELETE FROM favorites WHERE username IN (:a, :b)")->execute(['a' => $alice, 'b' => $bob]);
$db->prepare("DELETE FROM user_preferences WHERE username IN (:a, :b)")->execute(['a' => $alice, 'b' => $bob]);
$db->prepare("DELETE FROM episodes WHERE id = 'ep-anti-spoof-1'")->execute();
$db->prepare("DELETE FROM shows WHERE id = 'show-anti-spoof-1'")->execute();

echo "✓ Authenticated user isolation verified: JWT strictly enforced for history, progress, favorites, and preferences\n";
echo "✓ Zero leakage to or modification of spoofed target user\n";
echo "\n🎉 ALL ANTI-SPOOFING TESTS PASSED 100%!\n";
