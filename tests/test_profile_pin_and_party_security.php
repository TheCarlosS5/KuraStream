<?php
/**
 * Comprehensive Security Test Suite:
 * 1. 10-step Profile PIN Bypass elimination across all profile-scoped endpoints
 * 2. Kids mode streaming restriction on adult / TV-MA content
 * 3. Watch Party member-token authentication, duplicate nickname support, and impersonation protection
 */

if (!defined('TESTING_MODE')) {
    define('TESTING_MODE', true);
}

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';

echo "Running Comprehensive Profile PIN, Kids Filtering & Watch Party Security Tests...\n";

try {
    Database::initializeSchema();
    $db = Database::getConnection();
} catch (PDOException $e) {
    echo "SKIPPED ⚠ (MySQL offline)\n";
    exit(0);
}

// Clean and seed test user and PIN-protected profile
$db->exec("DELETE FROM episodes WHERE id = 'mature_ep_1'");
$db->exec("DELETE FROM shows WHERE id = 'mature_anime_1'");
$db->exec("DELETE FROM comments WHERE username = 'alice'");
$db->exec("DELETE FROM party_members WHERE username IN ('alice', 'Nakama')");
$db->exec("DELETE FROM party_rooms WHERE host_user = 'alice'");
$db->exec("DELETE FROM user_profiles WHERE username = 'alice'");
$db->exec("DELETE FROM users WHERE username = 'alice'");

$db->exec("INSERT INTO users (username, password_hash, role) VALUES ('alice', 'hash', 'user')");
$pinHash = password_hash('1234', PASSWORD_BCRYPT);
$db->exec("INSERT INTO user_profiles (id, username, name, is_kids, pin) VALUES ('prof_pin_1', 'alice', 'Secret Vault', 0, '{$pinHash}')");
$db->exec("INSERT INTO user_profiles (id, username, name, is_kids, pin) VALUES ('prof_kids_1', 'alice', 'Kids Club', 1, NULL)");

// -------------------------------------------------------------------------------------------------
// PART 1: 10-Step PIN Bypass Verification
// -------------------------------------------------------------------------------------------------
echo "  [1/3] Testing Profile PIN bypass elimination (10 profile-scoped endpoints)...\n";

// Account-level token without profile claim
$accountToken = AuthMiddleware::createToken([
    'username' => 'alice',
    'role' => 'user',
    'exp' => time() + 3600
]);

$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$accountToken}";
unset($_COOKIE['kurastream_token']);

// Attacker tries to inject profile parameters via query or body without passing PIN
$_GET['profile_id'] = 'prof_pin_1';
$_GET['profile_name'] = 'Secret Vault';

function assertProfileRequired(callable $fn, string $endpointName) {
    try {
        $fn();
        assert(false, "{$endpointName} must reject account-only token with PROFILE_REQUIRED");
    } catch (ExitException $e) {
        assert($e->statusCode === 403, "{$endpointName} expected 403, got {$e->statusCode}");
        $response = json_decode($e->getMessage(), true);
        assert(($response['code'] ?? '') === 'PROFILE_REQUIRED', "{$endpointName} expected PROFILE_REQUIRED error code");
    }
}

// 1. History
assertProfileRequired(fn() => HistoryController::getHistory(), 'HistoryController::getHistory');

// 2. Progress GET
assertProfileRequired(fn() => HistoryController::getProgress('test_ep'), 'HistoryController::getProgress');

// 3. Progress SAVE
assertProfileRequired(fn() => HistoryController::saveProgress('test_ep'), 'HistoryController::saveProgress');

// 4. Favorites GET
assertProfileRequired(fn() => HistoryController::getFavorites(), 'HistoryController::getFavorites');

// 5. Favorites CHECK
assertProfileRequired(fn() => HistoryController::checkFavorite(), 'HistoryController::checkFavorite');

// 6. Favorites TOGGLE
assertProfileRequired(fn() => HistoryController::toggleFavorite(), 'HistoryController::toggleFavorite');

// 7. Preferences GET
assertProfileRequired(fn() => HistoryController::getUserPreferences(), 'HistoryController::getUserPreferences');

// 8. Preferences SAVE
assertProfileRequired(fn() => HistoryController::saveUserPreferences(), 'HistoryController::saveUserPreferences');

// 9. Stats GET
assertProfileRequired(fn() => HistoryController::getUserStats(), 'HistoryController::getUserStats');

// 10. Notifications GET
assertProfileRequired(fn() => HistoryController::getNotifications(), 'HistoryController::getNotifications');

// 11. Comments ADD
assertProfileRequired(fn() => ShowController::addComment(['show_id' => 's1', 'content' => 'hello']), 'ShowController::addComment');

// 12. Playback / Stream access
assertProfileRequired(fn() => PlayerController::authorizeStreamAccess('test_ep'), 'PlayerController::authorizeStreamAccess');

echo "    -> All profile-scoped endpoints strictly enforce PROFILE_REQUIRED (403)\n";

// -------------------------------------------------------------------------------------------------
// PART 2: Kids Mode Streaming Restriction
// -------------------------------------------------------------------------------------------------
echo "  [2/3] Testing Kids Mode streaming maturity restriction...\n";

// Seed Adult / TV-MA show and episode
$db->exec("INSERT INTO shows (id, title, media_type, age_rating) VALUES ('mature_anime_1', 'Berserk 18+', 'anime', 'TV-MA')");
$db->exec("INSERT INTO episodes (id, show_id, season_number, episode_number, duration, filepath) VALUES ('mature_ep_1', 'mature_anime_1', 1, 1, 1400.0, '/tmp/fake.mp4')");

// Token with active kids profile claim
$kidsToken = AuthMiddleware::createToken([
    'username' => 'alice',
    'role' => 'user',
    'profile_id' => 'prof_kids_1',
    'profile_name' => 'Kids Club',
    'is_kids' => true,
    'exp' => time() + 3600
]);

$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$kidsToken}";

$kidsBlocked = false;
try {
    PlayerController::authorizeStreamAccess('mature_ep_1');
} catch (ExitException $e) {
    if ($e->statusCode === 403) {
        $kidsBlocked = true;
    }
}
assert($kidsBlocked, "Kids profile must be blocked with 403 when requesting mature content");

echo "    -> Kids mode content restriction verified on streaming\n";

// -------------------------------------------------------------------------------------------------
// PART 3: Watch Party Member-Token Auth & Duplicate Nicknames
// -------------------------------------------------------------------------------------------------
echo "  [3/3] Testing Watch Party token auth, duplicate nicknames, and member isolation...\n";

// 1. Create Room by Host
$hostToken = AuthMiddleware::createToken(['username' => 'alice', 'role' => 'user', 'exp' => time() + 3600]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostToken}";
$roomId = 'KURA-TESTROOM1';
$db->exec("INSERT INTO party_rooms (id, name, host_user, episode_id) VALUES ('{$roomId}', 'Sala de Alice', 'alice', 'ep1')");

// Host joins as member
$hostMemId = 'mem_host_123';
$hostMemToken = 'mptk_host_token_secret';
DbHelper::recordPartyMember($roomId, 'alice', $hostMemId, hash('sha256', $hostMemToken), 'host');

// 2. Guest 1 joins with nickname "Nakama"
$guest1MemId = 'mem_guest_1';
$guest1MemToken = 'mptk_guest_token_1';
DbHelper::recordPartyMember($roomId, 'Nakama', $guest1MemId, hash('sha256', $guest1MemToken), 'guest');

// 3. Guest 2 joins with EXACT SAME nickname "Nakama"
$guest2MemId = 'mem_guest_2';
$guest2MemToken = 'mptk_guest_token_2';
DbHelper::recordPartyMember($roomId, 'Nakama', $guest2MemId, hash('sha256', $guest2MemToken), 'guest');

// Verify both members exist independently despite identical username!
$activeMembers = DbHelper::getActivePartyMembers($roomId);
assert(count($activeMembers) === 3, "Expected 3 active members in party room");
assert($activeMembers[1]['member_id'] !== $activeMembers[2]['member_id'], "Member IDs must be unique");

// 4. Test unauthorized request without member token is rejected with 401
unset($_SERVER['HTTP_AUTHORIZATION']);
$_GET = ['room_id' => $roomId, 'last_msg_id' => 0];

$unauthCaught = false;
try {
    PartyController::pollEvents();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauthCaught = true;
    }
}
assert($unauthCaught, "PartyController::pollEvents must reject requests lacking member credentials with 401");

// 5. Test authorized request with valid member credentials succeeds
$_GET['member_id'] = $guest1MemId;
$_GET['member_token'] = $guest1MemToken;

$pollSuccess = false;
try {
    PartyController::pollEvents();
} catch (ExitException $e) {
    if ($e->statusCode === 200) {
        $pollSuccess = true;
    }
}
assert($pollSuccess, "PartyController::pollEvents must accept valid member credentials");

// 6. Test member leaving room deletes by member_id
$_GET = ['room_id' => $roomId, 'member_id' => $guest1MemId, 'member_token' => $guest1MemToken];
$leaveSuccess = false;
try {
    PartyController::leaveRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200) {
        $leaveSuccess = true;
    }
}
assert($leaveSuccess, "PartyController::leaveRoom must succeed for valid member");

// Guest 2 should still be in the room, Guest 1 should be gone!
$remaining = DbHelper::getActivePartyMembers($roomId);
assert(count($remaining) === 2, "Expected 2 active members after guest 1 left");
$remainingIds = array_column($remaining, 'member_id');
assert(!in_array($guest1MemId, $remainingIds), "Guest 1 must be removed");
assert(in_array($guest2MemId, $remainingIds), "Guest 2 must remain in room");

echo "    -> Watch Party member isolation and token authentication verified\n";

// Cleanup test artifacts
$db->exec("DELETE FROM episodes WHERE id = 'mature_ep_1'");
$db->exec("DELETE FROM shows WHERE id = 'mature_anime_1'");
$db->exec("DELETE FROM party_members WHERE room_id = '{$roomId}'");
$db->exec("DELETE FROM party_rooms WHERE id = '{$roomId}'");
$db->exec("DELETE FROM user_profiles WHERE username = 'alice'");
$db->exec("DELETE FROM users WHERE username = 'alice'");

echo "\nAll Profile PIN, Kids Filtering & Watch Party Security Tests Passed Successfully!\n";
