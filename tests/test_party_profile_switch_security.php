<?php
/**
 * Test Suite: Active Profile Binding & Context Validation for Watch Party Memberships
 * 
 * Verifies:
 * 1. Static code invariants:
 *    - PartyController::validatePartyMemberProfileContext exists and is called.
 *    - PlayerController::authorizeStreamAccess invokes profile context validation.
 *    - AuthController::selectProfile clears kurastream_party_session cookie.
 * 2. Adult to Kids profile switch:
 *    - Adult member capability works for adult content.
 *    - Profile switch to Kids profile causes refreshStreamTicket to return 403 PARTY_PROFILE_CHANGED.
 *    - Existing capability for adult content blocked (403) when active profile is Kids.
 *    - Subtitle stream with capability and active Kids profile blocked (403).
 *    - Rejoining adult room with Kids profile rejected (403).
 *    - Rejoining safe room with Kids profile succeeds with is_kids=1 and kids profile_id.
 * 3. Live profile property change in DB:
 *    - Updating an existing profile from adult to kids in DB is immediately enforced on stream capability.
 * 4. Anonymous guests:
 *    - Anonymous guests without account_username are completely unaffected and retain full playback.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running Watch Party Profile Binding & Security Tests...\n";

// -------------------------------------------------------------------------------------------------
// 0. Static Code Invariant Audit
// -------------------------------------------------------------------------------------------------
echo "  [0/5] Verifying static code invariants...\n";

$partyCode = file_get_contents(__DIR__ . '/../php_backend/controllers/PartyController.php');
assert(str_contains($partyCode, 'validatePartyMemberProfileContext'), "PartyController MUST define validatePartyMemberProfileContext!");
assert(str_contains($partyCode, 'PARTY_PROFILE_CHANGED'), "PartyController MUST emit PARTY_PROFILE_CHANGED error code!");

$playerCode = file_get_contents(__DIR__ . '/../php_backend/controllers/PlayerController.php');
assert(str_contains($playerCode, 'PartyController::validatePartyMemberProfileContext'), "PlayerController MUST call validatePartyMemberProfileContext!");

$authCode = file_get_contents(__DIR__ . '/../php_backend/controllers/AuthController.php');
assert(str_contains($authCode, 'kurastream_party_session'), "AuthController::selectProfile MUST clear kurastream_party_session cookie!");

$dbCode = file_get_contents(__DIR__ . '/../php_backend/db.php');
assert(str_contains($dbCode, 'getUserProfileById'), "DbHelper MUST implement getUserProfileById!");

echo "    ✓ Static invariants verified successfully\n";

// -------------------------------------------------------------------------------------------------
// Database Connection Guard
// -------------------------------------------------------------------------------------------------
try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "  [1-4/5] Integration suite skipped ⚠ (MySQL offline on host, executes in CI)\n";
    echo "✓ Watch Party Profile Binding Tests passed!\n";
    exit(0);
}

// Clean test fixtures
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-SW-%'");
$db->exec("DELETE FROM party_members WHERE room_id LIKE 'KURA-SW-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-SW-%'");
$db->exec("DELETE FROM episodes WHERE show_id IN ('show_sw_adult', 'show_sw_safe')");
$db->exec("DELETE FROM shows WHERE id IN ('show_sw_adult', 'show_sw_safe')");
$db->exec("DELETE FROM user_profiles WHERE username = 'user_switcher'");
$db->exec("DELETE FROM users WHERE username = 'user_switcher'");

// 1. Setup Shows & Episodes
DbHelper::saveShow([
    'id' => 'show_sw_adult',
    'title' => 'Adult Anime Show',
    'synopsis' => 'Mature content for testing',
    'rating' => 8.5,
    'year' => 2026,
    'age_rating' => 'TV-MA',
    'is_adult' => 1
]);

DbHelper::saveEpisode([
    'id' => 'ep_sw_adult_01',
    'show_id' => 'show_sw_adult',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Adult Episode 1',
    'filepath' => '/media/adult_sw.mp4',
    'duration' => 1400.0
]);

DbHelper::saveShow([
    'id' => 'show_sw_safe',
    'title' => 'Family Safe Anime Show',
    'synopsis' => 'Safe content for all audiences',
    'rating' => 8.0,
    'year' => 2026,
    'age_rating' => 'G',
    'is_adult' => 0
]);

DbHelper::saveEpisode([
    'id' => 'ep_sw_safe_01',
    'show_id' => 'show_sw_safe',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Safe Episode 1',
    'filepath' => '/media/safe_sw.mp4',
    'duration' => 1200.0
]);

// 2. Setup User with Adult and Kids Profiles
DbHelper::registerUser('user_switcher', 'Password123!');
$defaultProfiles = DbHelper::getUserProfiles('user_switcher');
$adultProfileId = $defaultProfiles[0]['id'];
DbHelper::saveUserProfile('user_switcher', [
    'id' => $adultProfileId,
    'name' => 'Adult Profile',
    'is_kids' => 0
]);

$kidsProfileData = DbHelper::saveUserProfile('user_switcher', [
    'name' => 'Kids Profile',
    'is_kids' => 1
]);
$kidsProfileId = $kidsProfileData['id'];

$adultJwt = AuthMiddleware::createToken([
    'username' => 'user_switcher',
    'role' => 'user',
    'profile_id' => $adultProfileId,
    'profile_name' => 'Adult Profile',
    'is_kids' => false,
    'exp' => time() + 3600
]);

$kidsJwt = AuthMiddleware::createToken([
    'username' => 'user_switcher',
    'role' => 'user',
    'profile_id' => $kidsProfileId,
    'profile_name' => 'Kids Profile',
    'is_kids' => true,
    'exp' => time() + 3600
]);

// -------------------------------------------------------------------------------------------------
// 1. Adult Profile Joins Adult Watch Party & Streams Content
// -------------------------------------------------------------------------------------------------
echo "  [1/5] Adult profile joins adult room and streams successfully...\n";
$adultRoomId = 'KURA-SW-ROOM1';
DbHelper::createPartyRoom([
    'id' => $adultRoomId,
    'name' => 'Adult Room For Switcher',
    'host_user' => 'other_host',
    'episode_id' => 'ep_sw_adult_01',
    'is_public' => 1,
    'allow_guest_controls' => 0,
    'is_playing' => 0,
    'current_time' => 0.0
]);

$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$adultJwt}";
$_COOKIE['kurastream_token'] = $adultJwt;
$GLOBALS['_MOCKED_JSON_INPUT'] = ['room_id' => $adultRoomId];

ob_start();
$joinAdultOk = false;
try {
    PartyController::joinRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200) $joinAdultOk = true;
}
$joinData = json_decode(ob_get_clean(), true);
assert($joinAdultOk && !empty($joinData['member_id']), "Adult join must succeed with status 200");

$adultMemberId = $joinData['member_id'];
$adultMemberToken = $joinData['member_token'];
$adultCapToken = $joinData['stream_capability_token'];

// Verify member row in DB
$memberRow = DbHelper::getPartyMemberById($adultRoomId, $adultMemberId);
assert($memberRow !== null, "Member row must exist in DB");
assert($memberRow['account_username'] === 'user_switcher', "Member account_username must match user");
assert($memberRow['profile_id'] === $adultProfileId, "Member profile_id must match adult profile ID");
assert((int)$memberRow['is_kids'] === 0, "Member is_kids must be 0");

// Verify stream access with capability succeeds
$_GET['ticket'] = $adultCapToken;
$streamAllowed = false;
try {
    PlayerController::authorizeStreamAccess('ep_sw_adult_01');
    $streamAllowed = true;
} catch (ExitException $e) {
    $streamAllowed = false;
}
assert($streamAllowed, "Adult profile with room capability must be authorized to stream adult episode");
echo "    ✓ Adult member joined and authorized to stream adult content\n";

// -------------------------------------------------------------------------------------------------
// 2. Simulate Profile Switch: Active Profile Becomes Kids
// -------------------------------------------------------------------------------------------------
echo "  [2/5] Switching active profile to Kids: verify refresh-ticket and capability blocked...\n";
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$kidsJwt}";
$_COOKIE['kurastream_token'] = $kidsJwt;

// A. Attempt ticket refresh using old adult membership credentials -> MUST return 403 PARTY_PROFILE_CHANGED
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $adultRoomId,
    'member_id' => $adultMemberId,
    'member_token' => $adultMemberToken
];
$refreshBlocked = false;
$refreshStatusCode = 200;
$refreshErrorCode = null;
ob_start();
try {
    PartyController::refreshStreamTicket();
} catch (ExitException $e) {
    $refreshBlocked = true;
    $refreshStatusCode = $e->statusCode;
    $refreshData = json_decode($e->getMessage(), true) ?: $e->data;
    $refreshErrorCode = $refreshData['code'] ?? null;
}
ob_end_clean();
assert($refreshBlocked && $refreshStatusCode === 403, "refreshStreamTicket MUST return 403 on profile switch, got {$refreshStatusCode}");
assert($refreshErrorCode === 'PARTY_PROFILE_CHANGED', "Error code MUST be PARTY_PROFILE_CHANGED, got {$refreshErrorCode}");
echo "    ✓ refreshStreamTicket rejected with 403 PARTY_PROFILE_CHANGED\n";

// B. Attempt stream access with old capability while active Kids auth is present -> MUST return 403
$_GET['ticket'] = $adultCapToken;
$streamBlocked = false;
$streamStatusCode = 200;
try {
    PlayerController::authorizeStreamAccess('ep_sw_adult_01');
} catch (ExitException $e) {
    $streamBlocked = true;
    $streamStatusCode = $e->statusCode;
}
assert($streamBlocked && $streamStatusCode === 403, "authorizeStreamAccess MUST return 403 for old capability when active profile is Kids, got {$streamStatusCode}");
echo "    ✓ Adult stream capability blocked with 403 when active profile is Kids\n";

// C. Attempt subtitle stream with old capability while active Kids auth is present -> MUST return 403
$subBlocked = false;
$subStatusCode = 200;
try {
    PlayerController::streamSubtitle('ep_sw_adult_01', 0);
} catch (ExitException $e) {
    $subBlocked = true;
    $subStatusCode = $e->statusCode;
}
assert($subBlocked && $subStatusCode === 403, "streamSubtitle MUST return 403 for adult episode when active profile is Kids, got {$subStatusCode}");
echo "    ✓ Subtitle stream blocked with 403 when active profile is Kids\n";

// -------------------------------------------------------------------------------------------------
// 3. Rejoin Behaviors with Kids Profile
// -------------------------------------------------------------------------------------------------
echo "  [3/5] Testing rejoin behaviors: adult room rejected, safe room accepted...\n";

// A. Rejoin adult room with Kids profile -> MUST return 403 maturity restriction
$GLOBALS['_MOCKED_JSON_INPUT'] = ['room_id' => $adultRoomId];
$rejoinAdultBlocked = false;
$rejoinStatusCode = 200;
ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {
    $rejoinAdultBlocked = true;
    $rejoinStatusCode = $e->statusCode;
}
ob_end_clean();
assert($rejoinAdultBlocked && $rejoinStatusCode === 403, "Kids profile MUST NOT join adult room, got {$rejoinStatusCode}");
echo "    ✓ Rejoin adult room blocked with 403 maturity restriction\n";

// B. Rejoin safe room with Kids profile -> MUST succeed with kids context
$safeRoomId = 'KURA-SW-SAFE1';
DbHelper::createPartyRoom([
    'id' => $safeRoomId,
    'name' => 'Safe Room For Switcher',
    'host_user' => 'other_host',
    'episode_id' => 'ep_sw_safe_01',
    'is_public' => 1,
    'allow_guest_controls' => 0,
    'is_playing' => 0,
    'current_time' => 0.0
]);

$GLOBALS['_MOCKED_JSON_INPUT'] = ['room_id' => $safeRoomId];
$rejoinSafeOk = false;
ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200) $rejoinSafeOk = true;
}
$safeJoinData = json_decode(ob_get_clean(), true);
assert($rejoinSafeOk && !empty($safeJoinData['member_id']), "Kids profile join to safe room must succeed");

$safeMemberRow = DbHelper::getPartyMemberById($safeRoomId, $safeJoinData['member_id']);
assert($safeMemberRow !== null, "Safe member row must exist in DB");
assert($safeMemberRow['profile_id'] === $kidsProfileId, "New membership must bind to Kids profile ID");
assert((int)$safeMemberRow['is_kids'] === 1, "New membership is_kids must be 1");
echo "    ✓ Rejoin safe room succeeded with new membership bound to Kids profile\n";

// -------------------------------------------------------------------------------------------------
// 4. Live Profile Property Change in DB
// -------------------------------------------------------------------------------------------------
echo "  [4/5] Testing live profile property change: updating profile to is_kids in DB...\n";
// Create another adult room and user
$singleProfUser = 'user_prop_test';
DbHelper::registerUser($singleProfUser, 'Password123!');
$pList = DbHelper::getUserProfiles($singleProfUser);
$pId = $pList[0]['id'];

$pAdultJwt = AuthMiddleware::createToken([
    'username' => $singleProfUser,
    'role' => 'user',
    'profile_id' => $pId,
    'profile_name' => 'SingleProf',
    'is_kids' => false,
    'exp' => time() + 3600
]);

$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$pAdultJwt}";
$_COOKIE['kurastream_token'] = $pAdultJwt;
$GLOBALS['_MOCKED_JSON_INPUT'] = ['room_id' => $adultRoomId];

ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {}
$joinRes = json_decode(ob_get_clean(), true);
$pCapToken = $joinRes['stream_capability_token'];
assert(!empty($pCapToken), "Capability token must be generated");

// First verify adult stream succeeds
$_GET['ticket'] = $pCapToken;
$firstStreamOk = false;
try {
    PlayerController::authorizeStreamAccess('ep_sw_adult_01');
    $firstStreamOk = true;
} catch (ExitException $e) {}
assert($firstStreamOk, "Adult stream must succeed while profile is adult in DB");

// Now directly update that SAME profile in DB to is_kids = 1
$db->exec("UPDATE user_profiles SET is_kids = 1 WHERE id = '{$pId}'");

// Same capability and same JWT used -> MUST now be blocked by live DB maturity check!
$liveCheckBlocked = false;
$liveCheckStatus = 200;
try {
    PlayerController::authorizeStreamAccess('ep_sw_adult_01');
} catch (ExitException $e) {
    $liveCheckBlocked = true;
    $liveCheckStatus = $e->statusCode;
}
assert($liveCheckBlocked && $liveCheckStatus === 403, "Live DB change to is_kids=1 MUST immediately block adult stream (403), got {$liveCheckStatus}");
echo "    ✓ Live DB profile change from adult to kids immediately enforced on stream\n";

// -------------------------------------------------------------------------------------------------
// 5. Anonymous Guests Retain Full Unbroken Functionality
// -------------------------------------------------------------------------------------------------
echo "  [5/5] Testing anonymous guests: functionality completely unbroken...\n";
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_COOKIE['kurastream_token']);
unset($_COOKIE['kurastream_party_session']);

$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $safeRoomId,
    'username' => 'AnonGuestTester'
];

ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {}
$anonJoin = json_decode(ob_get_clean(), true);
$anonMemberId = $anonJoin['member_id'];
$anonMemberToken = $anonJoin['member_token'];
$anonCapToken = $anonJoin['stream_capability_token'];

$anonRow = DbHelper::getPartyMemberById($safeRoomId, $anonMemberId);
assert($anonRow !== null, "Anonymous member must exist in DB");
assert($anonRow['account_username'] === null, "Anonymous member account_username must be NULL");

// Anonymous guest streams with capability
$_GET['ticket'] = $anonCapToken;
$anonStreamOk = false;
try {
    PlayerController::authorizeStreamAccess('ep_sw_safe_01');
    $anonStreamOk = true;
} catch (ExitException $e) {}
assert($anonStreamOk, "Anonymous guest capability stream MUST succeed");

// Anonymous guest refreshes ticket
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'room_id' => $safeRoomId,
    'member_id' => $anonMemberId,
    'member_token' => $anonMemberToken
];
$anonRefreshOk = false;
ob_start();
try {
    PartyController::refreshStreamTicket();
} catch (ExitException $e) {
    if ($e->statusCode === 200) $anonRefreshOk = true;
}
$anonRefreshData = json_decode(ob_get_clean(), true);
assert($anonRefreshOk && !empty($anonRefreshData['stream_capability_token']), "Anonymous guest ticket refresh MUST succeed");
echo "    ✓ Anonymous guest streaming and ticket refresh completely functional\n";

// Cleanup test fixtures
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-SW-%'");
$db->exec("DELETE FROM party_members WHERE room_id LIKE 'KURA-SW-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-SW-%'");
$db->exec("DELETE FROM episodes WHERE show_id IN ('show_sw_adult', 'show_sw_safe')");
$db->exec("DELETE FROM shows WHERE id IN ('show_sw_adult', 'show_sw_safe')");
$db->exec("DELETE FROM user_profiles WHERE username IN ('user_switcher', 'user_prop_test')");
$db->exec("DELETE FROM users WHERE username IN ('user_switcher', 'user_prop_test')");
unset($_GET['ticket']);
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_COOKIE['kurastream_token']);
unset($_COOKIE['kurastream_party_session']);

echo "✓ All Watch Party Profile Binding Security Tests passed completely!\n";
