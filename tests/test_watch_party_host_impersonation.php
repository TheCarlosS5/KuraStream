<?php
/**
 * Test Suite for Watch Party Host Impersonation Prevention
 * 
 * Verifies that a guest joining with the identical display name as the host:
 * 1. Has role = 'guest' in party_members table.
 * 2. resolvePartyParticipant resolves is_host = false (never elevated by display name).
 * 3. Episode change attempts return 403 HOST_PRIVILEGE_REQUIRED.
 * 4. Room configuration / settings updates return 403 for guest.
 * 5. Play/pause with allow_guest_controls = true is permitted for guest.
 * 6. Real host still retains full host permissions.
 * 7. Ephemeral SSE ticket generated for guest does NOT grant host elevation.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';

echo "Running Watch Party Host Impersonation Security Tests...\n";

// Helper function to invoke private resolvePartyParticipant via Reflection
function callResolvePartyParticipant(array $data, array $room): ?array {
    $ref = new ReflectionMethod('PartyController', 'resolvePartyParticipant');
    $ref->setAccessible(true);
    return $ref->invoke(null, $data, $room);
}

// -------------------------------------------------------------------------------------------------
// 0. Static Code Invariant Audit: Ensure display name is NEVER compared for host authorization
// -------------------------------------------------------------------------------------------------
echo "  [0/6] Verifying static invariants: display name is NEVER used for host authorization...\n";
$partyCode = file_get_contents(__DIR__ . '/../php_backend/controllers/PartyController.php');
assert(!str_contains($partyCode, "\$room['host_user'] === \$member['username']"), "CRITICAL: PartyController MUST NOT infer is_host by comparing display name to room host_user!");
assert(!str_contains($partyCode, "\$member['username'] === \$room['host_user']"), "CRITICAL: PartyController MUST NOT infer is_host by comparing display name to room host_user!");

$playerJs = file_get_contents(__DIR__ . '/../frontend/player.js');
assert(!str_contains($playerJs, "partyManager.activeRoom.host_user === msg.username"), "CRITICAL: player.js MUST NOT infer host by comparing msg.username to host_user!");
echo "    ✓ Static code invariants verified: no display-name host inference\n";

try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "  [1-6/6] Integration suite skipped ⚠ (MySQL offline on host, executes in CI)\n";
    echo "✓ Watch Party Host Impersonation Invariant Tests passed!\n";
    exit(0);
}

// Clean test fixtures
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-%'");
$db->exec("DELETE FROM party_members WHERE room_id LIKE 'KURA-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-%'");
$db->exec("DELETE FROM episodes WHERE show_id = 'show_impersonation_test'");
$db->exec("DELETE FROM shows WHERE id = 'show_impersonation_test'");
$db->exec("DELETE FROM user_profiles WHERE username = 'Carlos'");
$db->exec("DELETE FROM users WHERE username = 'Carlos'");

// Create Show and 2 Episodes (ep_1 and ep_2)
DbHelper::saveShow([
    'id' => 'show_impersonation_test',
    'title' => 'Impersonation Test Anime',
    'synopsis' => 'Test anime for host impersonation verification',
    'rating' => 8.5,
    'year' => 2026,
    'age_rating' => 'PG-13'
]);

DbHelper::saveEpisode([
    'id' => 'ep_imp_01',
    'show_id' => 'show_impersonation_test',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Episode 1',
    'filepath' => '/media/ep1.mp4'
]);

DbHelper::saveEpisode([
    'id' => 'ep_imp_02',
    'show_id' => 'show_impersonation_test',
    'season_number' => 1,
    'episode_number' => 2,
    'title' => 'Episode 2',
    'filepath' => '/media/ep2.mp4'
]);

// -------------------------------------------------------------------------------------------------
// 1. Host "Carlos" creates the Watch Party Room
// -------------------------------------------------------------------------------------------------
echo "  [1/6] Host account 'Carlos' creates room with allow_guest_controls = true...\n";
DbHelper::registerUser('Carlos', 'HostPassword123!');
$hostProfiles = DbHelper::getUserProfiles('Carlos');
$hostProfile = $hostProfiles[0];

$hostJwt = AuthMiddleware::createToken([
    'username' => 'Carlos',
    'role' => 'user',
    'profile_id' => $hostProfile['id'],
    'profile_name' => $hostProfile['name'],
    'is_kids' => 0,
    'exp' => time() + 3600
]);

$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostJwt}";
$_SERVER['REMOTE_ADDR'] = '198.51.100.55';
RateLimiter::clear('party_create_198.51.100.55');
RateLimiter::clear('party_join_198.51.100.55');
RateLimiter::clear('party_sync_198.51.100.55');

$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'name' => 'Sala Oficial de Carlos',
    'episode_id' => 'ep_imp_01',
    'is_public' => 1,
    'allow_guest_controls' => 1
];

ob_start();
try {
    PartyController::createRoom();
} catch (ExitException $e) {
    // Expected exit from jsonResponse
}
$createOut = json_decode(ob_get_clean(), true);
assert(!empty($createOut['success']) && !empty($createOut['room_id']), "Room creation must succeed");

$roomId = $createOut['room_id'];
$hostMemberId = $createOut['member_id'];
$hostMemberToken = $createOut['member_token'];
$room = DbHelper::getPartyRoom($roomId);
assert($room['host_user'] === 'Carlos', "Host of room must be 'Carlos'");

// -------------------------------------------------------------------------------------------------
// 2. Guest with IDENTICAL display name "Carlos" joins without JWT
// -------------------------------------------------------------------------------------------------
echo "  [2/6] Unauthenticated guest joins using identical display name 'Carlos'...\n";
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_COOKIE['kurastream_session']);
unset($_COOKIE['kurastream_party_session']);

$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'username' => 'Carlos' // Attacker attempting display-name impersonation
];

ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {
    // Expected exit
}
$joinOut = json_decode(ob_get_clean(), true);
assert(!empty($joinOut['success']), "Guest join must succeed");

$guestMemberId = $joinOut['member_id'];
$guestMemberToken = $joinOut['member_token'];
$guestSseTicket = $joinOut['sse_ticket'];

// Verify Guest DB Role in party_members
$guestMemberDb = DbHelper::getPartyMemberById($roomId, $guestMemberId);
assert($guestMemberDb !== null, "Guest member must exist in DB");
assert($guestMemberDb['role'] === 'guest', "Guest DB role MUST be 'guest', got '{$guestMemberDb['role']}'");
echo "    ✓ Guest DB role is correctly 'guest'\n";

// -------------------------------------------------------------------------------------------------
// 3. Assert resolvePartyParticipant resolves is_host = false for guest
// -------------------------------------------------------------------------------------------------
echo "  [3/6] Verifying resolvePartyParticipant evaluates is_host = false for guest 'Carlos'...\n";
$guestParticipant = callResolvePartyParticipant([
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken
], $room);

assert($guestParticipant !== null, "Participant must resolve with valid member token");
assert($guestParticipant['role'] === 'guest', "Participant role must be 'guest'");
assert($guestParticipant['is_host'] === false, "CRITICAL: Guest called 'Carlos' must NOT resolve as host! is_host must be false");
echo "    ✓ resolvePartyParticipant resolved is_host = false\n";

// -------------------------------------------------------------------------------------------------
// 4. Guest attempts episode change: MUST return 403 HOST_PRIVILEGE_REQUIRED
// -------------------------------------------------------------------------------------------------
echo "  [4/6] Guest 'Carlos' attempts episode change to ep_imp_02 (must fail with 403)...\n";
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'action' => 'episode_change',
    'episode_id' => 'ep_imp_02'
];

$episodeChangeBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 403) {
        $episodeChangeBlocked = true;
    }
}
$syncOut = ob_get_clean();
assert($episodeChangeBlocked === true, "Guest with name 'Carlos' changing episode MUST return 403, got response: {$syncOut}");
echo "    ✓ Guest episode change correctly blocked with HTTP 403\n";

// Guest also tries disguised episode change (action = 'seek' with different episode_id)
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'action' => 'seek',
    'episode_id' => 'ep_imp_02'
];
$disguisedBlocked = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 403) {
        $disguisedBlocked = true;
    }
}
ob_get_clean();
assert($disguisedBlocked === true, "Disguised episode change by guest MUST return 403");
echo "    ✓ Disguised episode change correctly blocked with HTTP 403\n";

// -------------------------------------------------------------------------------------------------
// 5. Guest tries host-only room configuration / settings update
// -------------------------------------------------------------------------------------------------
echo "  [5/6] Guest 'Carlos' tries host-only settings update (must return 403)...\n";
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'name' => 'Sala Hackeada',
    'allow_guest_controls' => 0
];

$settingsBlocked = false;
ob_start();
try {
    PartyController::updateSettings();
} catch (ExitException $e) {
    if ($e->statusCode === 403 || $e->statusCode === 401) {
        $settingsBlocked = true;
    }
}
ob_get_clean();
assert($settingsBlocked === true, "Guest updating room settings MUST return 403/401");
echo "    ✓ Guest settings update correctly blocked\n";

// -------------------------------------------------------------------------------------------------
// 6. Guest play/pause (with allow_guest_controls = true) allowed; Host retains full privileges
// -------------------------------------------------------------------------------------------------
echo "  [6/6] Verifying normal guest controls and host permissions...\n";
// Guest play/pause is allowed because allow_guest_controls = true
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'member_id' => $guestMemberId,
    'member_token' => $guestMemberToken,
    'is_playing' => 1,
    'current_time' => 45.0
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
$guestSyncRes = json_decode(ob_get_clean(), true);
assert($guestPlayOk === true || (!empty($guestSyncRes['success'])), "Guest play/pause must succeed when allow_guest_controls = true");
echo "    ✓ Guest play/pause allowed with allow_guest_controls = true\n";

// Guest SSE ticket resolution MUST NOT elevate to host
$sseParticipant = callResolvePartyParticipant([
    'sse_ticket' => $guestSseTicket
], $room);
assert($sseParticipant !== null, "SSE ticket participant must resolve");
assert($sseParticipant['is_host'] === false, "CRITICAL: Guest SSE ticket must NOT elevate to host!");
echo "    ✓ Guest SSE ticket has is_host = false (zero elevation)\n";

// Real Host STILL has host permissions
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostJwt}";
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $roomId,
    'action' => 'episode_change',
    'episode_id' => 'ep_imp_02'
];

$hostChangeOk = false;
ob_start();
try {
    PartyController::syncPlayback();
} catch (ExitException $e) {
    if ($e->statusCode === 200) {
        $hostChangeOk = true;
    }
}
$hostRes = json_decode(ob_get_clean(), true);
assert($hostChangeOk === true || (!empty($hostRes['success'])), "Real Host episode change must succeed");
$updatedRoom = DbHelper::getPartyRoom($roomId);
assert($updatedRoom['episode_id'] === 'ep_imp_02', "Room episode must be updated to ep_imp_02 by real host");
echo "    ✓ Real host retains full privileges and changed episode to ep_imp_02\n";

// Cleanup
$db->exec("DELETE FROM party_messages WHERE room_id = '{$roomId}'");
$db->exec("DELETE FROM party_members WHERE room_id = '{$roomId}'");
$db->exec("DELETE FROM party_rooms WHERE id = '{$roomId}'");
$db->exec("DELETE FROM episodes WHERE show_id = 'show_impersonation_test'");
$db->exec("DELETE FROM shows WHERE id = 'show_impersonation_test'");
$db->exec("DELETE FROM user_profiles WHERE username = 'Carlos'");
$db->exec("DELETE FROM users WHERE username = 'Carlos'");
unset($_SERVER['HTTP_AUTHORIZATION']);

echo "✓ Watch Party Host Impersonation Security Tests passed completely!\n";
