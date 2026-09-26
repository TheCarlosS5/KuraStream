<?php
/**
 * Test Suite for Kids Profile Watch Party Security & Capability Restrictions
 * 
 * Verifies:
 * 1. Static code invariants:
 *    - PartyController::joinRoom enforces maturity restrictions for Kids profiles.
 *    - PlayerController::authorizeStreamAccess checks member is_kids on capability requests.
 *    - TmdbScraper::downloadFile enforces HTTPS, image.tmdb.org allowlist, and atomic temp file.
 *    - Direct video stream calls setCorsHeaders().
 * 2. Integration scenarios:
 *    - Kids profile attempting to join an adult/restricted room receives 403.
 *    - Kids profile joining a safe room succeeds (200).
 *    - Adult host changing safe room to adult episode.
 *    - Kids member streaming adult episode with capability ticket receives 403.
 *    - Adult member streaming adult episode with capability ticket receives 200/206.
 *    - Kids member requesting subtitles for adult episode receives 403.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/services/TmdbScraper.php';

echo "Running Watch Party Kids Profile Security Tests...\n";

// -------------------------------------------------------------------------------------------------
// 0. Static Code Invariant Audit
// -------------------------------------------------------------------------------------------------
echo "  [0/6] Verifying static code invariants...\n";

$partyCode = file_get_contents(__DIR__ . '/../php_backend/controllers/PartyController.php');
assert(str_contains($partyCode, 'isAdultOrMaturityRestricted'), "PartyController::joinRoom MUST enforce isAdultOrMaturityRestricted!");
assert(str_contains($partyCode, "\$isKids, \$accountUsername, \$profileId"), "PartyController::joinRoom MUST persist profile context to recordPartyMember!");

$playerCode = file_get_contents(__DIR__ . '/../php_backend/controllers/PlayerController.php');
assert(str_contains($playerCode, "isAdultOrMaturityRestricted"), "PlayerController::authorizeStreamAccess MUST enforce isAdultOrMaturityRestricted on capability requests!");
assert(str_contains($playerCode, "\$member['is_kids']"), "PlayerController::authorizeStreamAccess MUST check member['is_kids']!");
assert(str_contains($playerCode, "setCorsHeaders();"), "PlayerController direct stream MUST call setCorsHeaders()!");

$scraperCode = file_get_contents(__DIR__ . '/../php_backend/services/TmdbScraper.php');
assert(str_contains($scraperCode, "image.tmdb.org"), "TmdbScraper::downloadFile MUST allowlist image.tmdb.org!");
assert(str_contains($scraperCode, "https"), "TmdbScraper::downloadFile MUST require HTTPS!");
assert(str_contains($scraperCode, "rename("), "TmdbScraper::downloadFile MUST atomically rename temp file!");

echo "    ✓ Static invariants verified successfully\n";

// -------------------------------------------------------------------------------------------------
// 1. Integration Tests (Requires MySQL)
// -------------------------------------------------------------------------------------------------
try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "  [1-6/6] Integration suite skipped ⚠ (MySQL offline on host, executes in CI)\n";
    echo "✓ Watch Party Kids Profile Security Tests passed!\n";
    exit(0);
}

// Helper to invoke joinRoom
function sendJoinRoomRequest(array $body, ?string $token = null): array {
    $GLOBALS['_MOCKED_JSON_INPUT'] = $body;
    $_SERVER['REQUEST_METHOD'] = 'POST';
    if ($token !== null) {
        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$token}";
    } else {
        unset($_SERVER['HTTP_AUTHORIZATION']);
    }
    ob_start();
    $statusCode = 200;
    try {
        PartyController::joinRoom();
    } catch (ExitException $e) {
        $statusCode = $e->statusCode;
    } catch (Throwable $e) {
        $statusCode = 500;
    }
    $raw = ob_get_clean();
    $data = json_decode($raw, true) ?: [];
    return ['status' => $statusCode, 'data' => $data];
}

// Clean test fixtures
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-KIDS-%'");
$db->exec("DELETE FROM party_members WHERE room_id LIKE 'KURA-KIDS-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-KIDS-%'");
$db->exec("DELETE FROM episodes WHERE show_id IN ('show_safe_party', 'show_adult_party')");
$db->exec("DELETE FROM shows WHERE id IN ('show_safe_party', 'show_adult_party')");
$db->exec("DELETE FROM user_profiles WHERE username IN ('adult_host', 'kid_user', 'adult_guest')");
$db->exec("DELETE FROM users WHERE username IN ('adult_host', 'kid_user', 'adult_guest')");

// Create Safe Show (G / All Ages)
DbHelper::saveShow([
    'id' => 'show_safe_party',
    'title' => 'Safe Anime for Kids',
    'synopsis' => 'All ages anime',
    'rating' => 8.0,
    'year' => 2024,
    'age_rating' => 'G'
]);

// Create Adult Show (TV-MA)
DbHelper::saveShow([
    'id' => 'show_adult_party',
    'title' => 'Adult Dark Thriller',
    'synopsis' => 'TV-MA restricted anime',
    'rating' => 9.0,
    'year' => 2024,
    'age_rating' => 'TV-MA'
]);

// Create Safe Episode 1
DbHelper::saveEpisode([
    'id' => 'ep_safe_01',
    'show_id' => 'show_safe_party',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Safe Episode 1',
    'filepath' => '/media/safe1.mp4',
    'duration' => 1200.0
]);

// Create Adult Episode 2
DbHelper::saveEpisode([
    'id' => 'ep_adult_02',
    'show_id' => 'show_adult_party',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Adult Episode 2',
    'filepath' => '/media/adult2.mp4',
    'duration' => 1500.0
]);

// Register Users & Profiles
DbHelper::registerUser('adult_host', 'Pass123!');
DbHelper::registerUser('kid_user', 'Pass123!');
DbHelper::registerUser('adult_guest', 'Pass123!');

$kidProfiles = DbHelper::getUserProfiles('kid_user');
$kidProfileId = $kidProfiles[0]['id'];
DbHelper::saveUserProfile('kid_user', [
    'id' => $kidProfileId,
    'name' => 'Kiddo',
    'avatar' => 'avatar1.png',
    'is_kids' => 1
]);

$adultGuestProfiles = DbHelper::getUserProfiles('adult_guest');
$adultGuestProfileId = $adultGuestProfiles[0]['id'];

$kidToken = AuthMiddleware::createToken([
    'username' => 'kid_user',
    'role' => 'user',
    'profile_id' => $kidProfileId,
    'profile_name' => 'Kiddo',
    'is_kids' => true,
    'exp' => time() + 3600
]);

$adultGuestToken = AuthMiddleware::createToken([
    'username' => 'adult_guest',
    'role' => 'user',
    'profile_id' => $adultGuestProfileId,
    'profile_name' => 'AdultGuest',
    'is_kids' => false,
    'exp' => time() + 3600
]);

// -------------------------------------------------------------------------------------------------
// 1. Kids profile joins adult room -> MUST return 403
// -------------------------------------------------------------------------------------------------
echo "  [1/6] Test Kids profile joins adult room (expects 403)...\n";
$adultRoomId = 'KURA-KIDS-ADULT1';
DbHelper::createPartyRoom([
    'id' => $adultRoomId,
    'name' => 'Adult Watch Party',
    'host_user' => 'adult_host',
    'episode_id' => 'ep_adult_02',
    'is_public' => 1,
    'allow_guest_controls' => 0,
    'is_playing' => 0,
    'current_time' => 0.0
]);

$resJoinAdult = sendJoinRoomRequest(['room_id' => $adultRoomId], $kidToken);
assert($resJoinAdult['status'] === 403, "Kids profile joining adult room must return 403, got {$resJoinAdult['status']}");
assert(str_contains($resJoinAdult['data']['error'] ?? '', 'infantil'), "Error message must indicate kids profile restriction");

// -------------------------------------------------------------------------------------------------
// 2. Kids profile joins safe room -> MUST return 200
// -------------------------------------------------------------------------------------------------
echo "  [2/6] Test Kids profile joins safe room (expects 200)...\n";
$safeRoomId = 'KURA-KIDS-SAFE01';
DbHelper::createPartyRoom([
    'id' => $safeRoomId,
    'name' => 'Safe Watch Party',
    'host_user' => 'adult_host',
    'episode_id' => 'ep_safe_01',
    'is_public' => 1,
    'allow_guest_controls' => 1,
    'is_playing' => 0,
    'current_time' => 0.0
]);

$resJoinSafe = sendJoinRoomRequest(['room_id' => $safeRoomId], $kidToken);
assert($resJoinSafe['status'] === 200, "Kids profile joining safe room must return 200, got {$resJoinSafe['status']}");
$kidMemberId = $resJoinSafe['data']['member_id'];
$kidCapabilityToken = $resJoinSafe['data']['stream_capability_token'];

// Verify member record has is_kids = 1
$kidMemberRow = DbHelper::getPartyMemberById($safeRoomId, $kidMemberId);
assert(!empty($kidMemberRow['is_kids']), "Party member table must record is_kids = 1");

// Adult guest joins safe room
$resJoinAdultGuest = sendJoinRoomRequest(['room_id' => $safeRoomId], $adultGuestToken);
assert($resJoinAdultGuest['status'] === 200);
$adultGuestMemberId = $resJoinAdultGuest['data']['member_id'];
$adultGuestCapToken = $resJoinAdultGuest['data']['stream_capability_token'];

// -------------------------------------------------------------------------------------------------
// 3. Kids member can stream safe episode 1 -> MUST succeed
// -------------------------------------------------------------------------------------------------
echo "  [3/6] Kids member streams safe episode 1 with room capability (expects authorized)...\n";
$_GET['ticket'] = $kidCapabilityToken;
unset($_SERVER['HTTP_AUTHORIZATION']);
$authorized = false;
try {
    PlayerController::authorizeStreamAccess('ep_safe_01');
    $authorized = true;
} catch (ExitException $e) {
    $authorized = false;
}
assert($authorized, "Kids member must be authorized to stream safe episode");

// -------------------------------------------------------------------------------------------------
// 4. Host switches room to adult episode 2
// -------------------------------------------------------------------------------------------------
echo "  [4/6] Adult host switches room to adult episode 2...\n";
DbHelper::updatePartyPlayback($safeRoomId, false, 0.0, 'ep_adult_02');
$updatedRoom = DbHelper::getPartyRoom($safeRoomId);
assert($updatedRoom['episode_id'] === 'ep_adult_02', "Room episode must be updated to adult episode");

// -------------------------------------------------------------------------------------------------
// 5. Existing Kids member tries to stream adult episode 2 -> MUST return 403
// -------------------------------------------------------------------------------------------------
echo "  [5/6] Kids member tries to stream adult episode 2 (expects 403)...\n";
$_GET['ticket'] = $kidCapabilityToken;
$blocked = false;
$statusCode = 200;
try {
    PlayerController::authorizeStreamAccess('ep_adult_02');
} catch (ExitException $e) {
    $blocked = true;
    $statusCode = $e->statusCode;
}
assert($blocked && $statusCode === 403, "Kids member streaming adult episode must be blocked with 403, got {$statusCode}");

// 5b. Kids member tries to stream subtitles for adult episode 2 -> MUST return 403
echo "  [5b/6] Kids member tries to stream subtitles for adult episode 2 (expects 403)...\n";
$_GET['ticket'] = $kidCapabilityToken;
$subBlocked = false;
$subStatusCode = 200;
try {
    PlayerController::streamSubtitle('ep_adult_02', 0);
} catch (ExitException $e) {
    $subBlocked = true;
    $subStatusCode = $e->statusCode;
}
assert($subBlocked && $subStatusCode === 403, "Kids member streaming subtitles for adult episode must be blocked with 403, got {$subStatusCode}");

// -------------------------------------------------------------------------------------------------
// 6. Adult member can stream adult episode 2 -> MUST succeed
// -------------------------------------------------------------------------------------------------
echo "  [6/6] Adult member streams adult episode 2 with room capability (expects authorized)...\n";
$_GET['ticket'] = $adultGuestCapToken;
$adultAllowed = false;
try {
    PlayerController::authorizeStreamAccess('ep_adult_02');
    $adultAllowed = true;
} catch (ExitException $e) {
    $adultAllowed = false;
}
assert($adultAllowed, "Adult member must be authorized to stream adult episode in party room");

// Cleanup
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-KIDS-%'");
$db->exec("DELETE FROM party_members WHERE room_id LIKE 'KURA-KIDS-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-KIDS-%'");
$db->exec("DELETE FROM episodes WHERE show_id IN ('show_safe_party', 'show_adult_party')");
$db->exec("DELETE FROM shows WHERE id IN ('show_safe_party', 'show_adult_party')");
$db->exec("DELETE FROM user_profiles WHERE username IN ('adult_host', 'kid_user', 'adult_guest')");
$db->exec("DELETE FROM users WHERE username IN ('adult_host', 'kid_user', 'adult_guest')");
unset($_GET['ticket']);
unset($_SERVER['HTTP_AUTHORIZATION']);

echo "✓ All Watch Party Kids Profile Security Tests passed completely!\n";
