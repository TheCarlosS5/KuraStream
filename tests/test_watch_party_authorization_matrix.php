<?php
/**
 * Test Suite for Watch Party Authorization Matrix & Episode Change Guards
 * Verifies that:
 * - Room creation requires an active profile (PROFILE_REQUIRED 403 for bare login tokens).
 * - Room creation for adult/restricted content is rejected (403) for kids profiles.
 * - Guest playback sync allows play/pause/seek only when allow_guest_controls is true.
 * - Guests CANNOT change episode_id regardless of action ('seek', 'pause', etc.) -> 403.
 * - Guests CANNOT trigger action 'episode_change' -> 403.
 * - Host CAN change episode_id to a valid existing episode -> 200.
 * - Host CANNOT change episode_id to a nonexistent episode -> 404.
 * - Host with Kids profile CANNOT switch room to an adult/restricted show -> 403.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';

echo "Running Watch Party Authorization Matrix Tests...\n";

// Clear rate limits
$_SERVER['REMOTE_ADDR'] = '192.168.1.111';
RateLimiter::clear('party_create_192.168.1.111');
RateLimiter::clear('party_join_192.168.1.111');
RateLimiter::clear('party_sync_192.168.1.111');

// Setup test shows & episodes
$db = Database::getConnection();

// Clean previous fixtures if any
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-%'");
$db->exec("DELETE FROM party_members WHERE room_id LIKE 'KURA-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-%'");
$db->exec("DELETE FROM episodes WHERE show_id IN ('show_wp_safe', 'show_wp_adult')");
$db->exec("DELETE FROM shows WHERE id IN ('show_wp_safe', 'show_wp_adult')");

DbHelper::saveShow([
    'id' => 'show_wp_safe',
    'title' => 'Safe Family Show',
    'synopsis' => 'Family friendly anime',
    'rating' => 8.5,
    'year' => 2024,
    'age_rating' => 'PG',
    'is_adult' => 0,
    'genres' => 'Adventure, Comedy'
]);

DbHelper::saveShow([
    'id' => 'show_wp_adult',
    'title' => 'Mature Restricted Show',
    'synopsis' => 'Explicit adult anime',
    'rating' => 7.0,
    'year' => 2023,
    'age_rating' => 'TV-MA',
    'is_adult' => 1,
    'genres' => 'Ecchi, Horror'
]);

DbHelper::saveEpisode([
    'id' => 'ep_safe_01',
    'show_id' => 'show_wp_safe',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Safe Episode 1',
    'filepath' => '/media/safe_01.mp4',
    'duration' => 1200
]);

DbHelper::saveEpisode([
    'id' => 'ep_safe_02',
    'show_id' => 'show_wp_safe',
    'season_number' => 1,
    'episode_number' => 2,
    'title' => 'Safe Episode 2',
    'filepath' => '/media/safe_02.mp4',
    'duration' => 1250
]);

DbHelper::saveEpisode([
    'id' => 'ep_adult_01',
    'show_id' => 'show_wp_adult',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Adult Episode 1',
    'filepath' => '/media/adult_01.mp4',
    'duration' => 1300
]);

// -------------------------------------------------------------------------------------------------
// 1. Bare Login Token Rejection (PROFILE_REQUIRED)
// -------------------------------------------------------------------------------------------------
echo "  [1/6] Testing room creation without profile (PROFILE_REQUIRED)...\n";
$bareUser = 'user_' . substr(uniqid(), -4);
$bareToken = AuthMiddleware::createToken(['username' => $bareUser, 'role' => 'user', 'exp' => time() + 3600]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$bareToken}";
$_COOKIE['kurastream_token'] = $bareToken;
$GLOBALS['_MOCKED_JSON_INPUT'] = ['episode_id' => 'ep_safe_01'];

$bareTokenBlocked = false;
ob_start();
try {
    PartyController::createRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 403 && ($e->data['code'] ?? '') === 'PROFILE_REQUIRED') {
        $bareTokenBlocked = true;
    }
}
ob_get_clean();
assert($bareTokenBlocked, "Bare login token without profile claim MUST return 403 PROFILE_REQUIRED");
echo "    ✓ Bare login token rejected with 403 PROFILE_REQUIRED\n";

// -------------------------------------------------------------------------------------------------
// 2. Kids Profile Adult Show Rejection
// -------------------------------------------------------------------------------------------------
echo "  [2/6] Testing room creation with Kids profile on adult content...\n";
$kidsToken = AuthMiddleware::createToken([
    'username' => 'parent_user',
    'profile_id' => 10,
    'profile_name' => 'Kiddo',
    'is_kids' => true,
    'role' => 'user',
    'exp' => time() + 3600
]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$kidsToken}";
$_COOKIE['kurastream_token'] = $kidsToken;
$GLOBALS['_MOCKED_JSON_INPUT'] = ['episode_id' => 'ep_adult_01'];

$kidsBlocked = false;
ob_start();
try {
    PartyController::createRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 403 && str_contains($e->getMessage(), 'perfil infantil')) {
        $kidsBlocked = true;
    }
}
ob_get_clean();
assert($kidsBlocked, "Kids profile MUST NOT create room with adult content (403)");
echo "    ✓ Kids profile blocked from creating adult party room\n";

// -------------------------------------------------------------------------------------------------
// 3. Room Creation with Valid Profile
// -------------------------------------------------------------------------------------------------
echo "  [3/6] Testing room creation with adult profile on safe content...\n";
$hostUser = 'host_' . substr(uniqid(), -4);
$hostToken = AuthMiddleware::createToken([
    'username' => $hostUser,
    'profile_id' => 20,
    'profile_name' => 'HostProfile',
    'is_kids' => false,
    'role' => 'user',
    'exp' => time() + 3600
]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostToken}";
$_COOKIE['kurastream_token'] = $hostToken;
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'episode_id' => 'ep_safe_01',
    'name' => 'Matrix Test Room',
    'allow_guest_controls' => 1,
    'allow_guests' => true, // the matrix joins a guest; rooms admit them only when the host opts in
    'is_public' => 1
];

$roomId = '';
$hostMemberId = '';
$hostMemberToken = '';
ob_start();
try {
    PartyController::createRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200 && !empty($e->data['room_id'])) {
        $roomId = $e->data['room_id'];
        $hostMemberId = $e->data['member_id'];
        $hostMemberToken = $e->data['member_token'];
    }
}
ob_get_clean();
assert(!empty($roomId), "Host must create room successfully");
echo "    ✓ Room created successfully (ID: {$roomId})\n";

// -------------------------------------------------------------------------------------------------
// 4. Guest Joins Room & Guest Controls on Same Episode
// -------------------------------------------------------------------------------------------------
echo "  [4/6] Testing guest join and legitimate playback control (seek/play)...\n";
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_COOKIE['kurastream_token']);

$_GET['room_id'] = $roomId;
$_GET['username'] = 'GuestAuditor';
$guestMemberId = '';
$guestMemberToken = '';

ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200 && !empty($e->data['member_id'])) {
        $guestMemberId = $e->data['member_id'];
        $guestMemberToken = $e->data['member_token'];
    }
}
ob_get_clean();
assert(!empty($guestMemberId) && !empty($guestMemberToken), "Guest must join room and receive member credentials");

// Guest plays same episode
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'episode_id' => 'ep_safe_01',
    'is_playing' => true,
    'current_time' => 45.0,
    'action' => 'play'
];
$guestPlayOk = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 200) {
        $guestPlayOk = true;
    }
}
ob_get_clean();
assert($guestPlayOk, "Guest should be permitted to play current episode when allow_guest_controls is true");
echo "    ✓ Guest legitimate play/seek permitted\n";

// -------------------------------------------------------------------------------------------------
// 5. Guest Malicious Episode Change Attempts
// -------------------------------------------------------------------------------------------------
echo "  [5/6] Testing guest malicious episode change attempts...\n";

// A. Guest sends different episode_id with action 'episode_change'
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'episode_id' => 'ep_safe_02',
    'action' => 'episode_change'
];
$guestEpChangeBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 403 && str_contains($e->getMessage(), 'anfitrión')) {
        $guestEpChangeBlocked = true;
    }
}
ob_get_clean();
assert($guestEpChangeBlocked, "Guest MUST be blocked from episode_change (403)");

// B. Guest sends different episode_id disguised as 'seek'
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'episode_id' => 'ep_safe_02',
    'current_time' => 10.0,
    'action' => 'seek'
];
$guestDisguisedSeekBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 403 && str_contains($e->getMessage(), 'anfitrión')) {
        $guestDisguisedSeekBlocked = true;
    }
}
ob_get_clean();
assert($guestDisguisedSeekBlocked, "Guest disguised seek with mismatched episode_id MUST be blocked (403)");

// C. Guest sends action 'episode_change' even with SAME episode_id
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'episode_id' => 'ep_safe_01',
    'action' => 'episode_change'
];
$guestSameEpChangeBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 403 && str_contains($e->getMessage(), 'anfitrión')) {
        $guestSameEpChangeBlocked = true;
    }
}
ob_get_clean();
assert($guestSameEpChangeBlocked, "Guest sending action 'episode_change' MUST be blocked (403)");
echo "    ✓ Guest episode change attempts strictly rejected with 403\n";

// -------------------------------------------------------------------------------------------------
// 6. Host Episode Change & Boundary Enforcements
// -------------------------------------------------------------------------------------------------
echo "  [6/6] Testing host episode change and bounds (valid, 404 nonexistent, 403 kids restriction)...\n";
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostToken}";
$_COOKIE['kurastream_token'] = $hostToken;

// A. Host changes to nonexistent episode -> 404
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'episode_id' => 'ep_nonexistent_9999',
    'action' => 'episode_change'
];
$hostNonexistentBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 404) {
        $hostNonexistentBlocked = true;
    }
}
ob_get_clean();
assert($hostNonexistentBlocked, "Host changing to nonexistent episode MUST return 404");

// B. Host in Kids mode attempts to switch to adult episode -> 403
$hostKidsToken = AuthMiddleware::createToken([
    'username' => $hostUser,
    'profile_id' => 30,
    'profile_name' => 'HostKids',
    'is_kids' => true,
    'role' => 'user',
    'exp' => time() + 3600
]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostKidsToken}";
$db->prepare("UPDATE party_members SET profile_id = 30 WHERE room_id = ? AND role = 'host'")->execute([$roomId]);

$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'episode_id' => 'ep_adult_01',
    'action' => 'episode_change'
];
$hostKidsAdultBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 403 && str_contains($e->getMessage(), 'perfil infantil')) {
        $hostKidsAdultBlocked = true;
    }
}
ob_get_clean();
assert($hostKidsAdultBlocked, "Host with Kids profile switching to adult content MUST return 403");

// C. Host with normal profile changes to ep_safe_02 -> 200
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostToken}";
$_COOKIE['kurastream_token'] = $hostToken;
$db->prepare("UPDATE party_members SET profile_id = 20 WHERE room_id = ? AND role = 'host'")->execute([$roomId]);

$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'episode_id' => 'ep_safe_02',
    'current_time' => 0.0,
    'action' => 'episode_change'
];
$hostChangeOk = false;
$updatedRoom = null;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 200 && !empty($e->data['room'])) {
        $hostChangeOk = true;
        $updatedRoom = $e->data['room'];
    }
}
ob_get_clean();
assert($hostChangeOk, "Host should successfully change episode to ep_safe_02");
assert($updatedRoom['episode_id'] === 'ep_safe_02', "Room episode_id in DB must be ep_safe_02");
echo "    ✓ Host episode switch to valid episode OK, 404 on nonexistent, 403 on Kids maturity restriction\n";

// Cleanup test fixtures
$GLOBALS['_MOCKED_JSON_INPUT'] = [];
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_COOKIE['kurastream_token']);
$db->exec("DELETE FROM party_messages WHERE room_id = '{$roomId}'");
$db->exec("DELETE FROM party_members WHERE room_id = '{$roomId}'");
$db->exec("DELETE FROM party_rooms WHERE id = '{$roomId}'");
$db->exec("DELETE FROM episodes WHERE show_id IN ('show_wp_safe', 'show_wp_adult')");
$db->exec("DELETE FROM shows WHERE id IN ('show_wp_safe', 'show_wp_adult')");

echo "\n🎉 ALL WATCH PARTY AUTHORIZATION MATRIX TESTS PASSED!\n";
