<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running Profile Rename / Delete / Kids Management Tests...\n";

$db = Database::getConnection();
Database::initializeSchema();

function expectStatus(callable $fn, int $status, string $message): void {
    try {
        $fn();
    } catch (ExitException $e) {
        assert($e->statusCode === $status, "$message (got {$e->statusCode}: {$e->getMessage()})");
        return;
    }
    assert(false, "$message (no error raised)");
}

function countRows(PDO $db, string $table, string $username, string $profile): int {
    $stmt = $db->prepare("SELECT COUNT(*) FROM {$table} WHERE username = :u AND profile_name = :p");
    $stmt->execute(['u' => $username, 'p' => $profile]);
    return (int)$stmt->fetchColumn();
}

$username = 'rename_user_' . substr(uniqid(), -6);
$db->prepare("INSERT INTO users (username, password_hash, role) VALUES (:u, :h, 'user')")
    ->execute(['u' => $username, 'h' => password_hash('irrelevant', PASSWORD_BCRYPT)]);

DbHelper::saveShow(['id' => 'show-rename-1', 'title' => 'Rename Test Show', 'media_type' => 'anime']);
DbHelper::saveEpisode([
    'id' => 'ep-rename-1', 'show_id' => 'show-rename-1', 'season_number' => 1,
    'episode_number' => 1, 'title' => 'Episode 1', 'filepath' => 'dummy_rename.mp4'
]);

// 1. Renaming a profile carries its history, favorites and preferences along
$profile = DbHelper::saveUserProfile($username, ['name' => 'Ana', 'color' => '#818CF8']);
$db->prepare("INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration, completed) VALUES (:u, 'Ana', 'ep-rename-1', 120, 1440, 0)")
    ->execute(['u' => $username]);
$db->prepare("INSERT INTO favorites (username, profile_name, show_id) VALUES (:u, 'Ana', 'show-rename-1')")
    ->execute(['u' => $username]);
DbHelper::saveUserPreferences($username, 'Ana', ['audio_preset' => 'night_mode', 'notifications_enabled' => 0]);

DbHelper::saveUserProfile($username, ['id' => $profile['id'], 'name' => 'Anita', 'color' => '#818CF8']);
assert(countRows($db, 'watch_history', $username, 'Anita') === 1, 'History must follow the renamed profile');
assert(countRows($db, 'favorites', $username, 'Anita') === 1, 'Favorites must follow the renamed profile');
assert(countRows($db, 'watch_history', $username, 'Ana') === 0, 'No history may stay under the old name');
$prefs = DbHelper::getUserPreferences($username, 'Anita');
assert($prefs['audio_preset'] === 'night_mode', 'Preferences must follow the renamed profile');
assert($prefs['notifications_enabled'] === false, 'notifications_enabled must persist');

// 2. Deleting a profile removes its data, so a new profile with the same name starts clean
DbHelper::deleteUserProfile($username, $profile['id']);
assert(countRows($db, 'watch_history', $username, 'Anita') === 0, 'Deleting a profile must delete its history');
assert(countRows($db, 'favorites', $username, 'Anita') === 0, 'Deleting a profile must delete its favorites');
assert(countRows($db, 'user_preferences', $username, 'Anita') === 0, 'Deleting a profile must delete its preferences');

// 3. PIN-protected profiles need the PIN to be deleted
$locked = DbHelper::saveUserProfile($username, ['name' => 'Privado', 'pin' => '4321']);
expectStatus(fn() => DbHelper::deleteUserProfile($username, $locked['id']), 403, 'Deleting a PIN profile without PIN must be rejected');
expectStatus(fn() => DbHelper::deleteUserProfile($username, $locked['id'], '0000'), 403, 'Deleting a PIN profile with a wrong PIN must be rejected');
assert(DbHelper::deleteUserProfile($username, $locked['id'], '4321') === true, 'Deleting a PIN profile with the right PIN must succeed');

// 4. Avatars must be real raster images (an SVG served from /library would run scripts same-origin)
$svg = 'data:image/svg+xml;base64,' . base64_encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
expectStatus(fn() => DbHelper::saveUserProfile($username, ['name' => 'Svg', 'avatar' => $svg]), 400, 'SVG avatars must be rejected');
expectStatus(fn() => DbHelper::saveUserProfile($username, ['name' => 'Junk', 'avatar' => 'data:image/png;base64,bm90LWFuLWltYWdl']), 400, 'Non-image avatar payloads must be rejected');
$withJs = DbHelper::saveUserProfile($username, ['name' => 'Js', 'avatar' => 'javascript:alert(1)']);
assert($withJs['avatar'] === '', 'Arbitrary avatar URLs must be dropped');

// 5. A kids session cannot manage profiles (it could otherwise switch its own kids mode off)
$_COOKIE['kurastream_token'] = AuthMiddleware::createToken([
    'username' => $username, 'role' => 'user', 'profile_id' => 'prof_kids', 'profile_name' => 'Kids',
    'is_kids' => true, 'exp' => time() + 3600
]);
expectStatus(fn() => AuthController::saveProfile(), 403, 'Kids sessions must not save profiles');
expectStatus(fn() => AuthController::deleteProfile($withJs['id']), 403, 'Kids sessions must not delete profiles');
unset($_COOKIE['kurastream_token']);

// Cleanup
$db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $username]);
$db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $username]);
$db->prepare("DELETE FROM episodes WHERE id = 'ep-rename-1'")->execute();
$db->prepare("DELETE FROM shows WHERE id = 'show-rename-1'")->execute();

echo "✓ Profile Rename / Delete / Kids Management Tests Passed\n";
