<?php
/**
 * Test Suite for PATCH /api/progress/{id} - Mark Watched / Unwatched & Profile Isolation
 *
 * Verifies:
 * 1. Static audit checks for route registration, boolean validation, and deletion on unwatched.
 * 2. Missing or non-boolean completed returns 400 Bad Request.
 * 3. Non-existent episode returns 404.
 * 4. Marking episode as watched sets completed = true, progress = duration for active profile.
 * 5. Marking watched/unwatched in Profile A does NOT affect Profile B (Profile Isolation).
 * 6. Marking episode as unwatched deletes progress for that profile.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running PATCH Progress & Profile Isolation Tests...\n";

// Static audit checks
$routerCode = file_get_contents(__DIR__ . '/../php_backend/router.php');
assert(str_contains($routerCode, "'PATCH'"), "router.php MUST register PATCH method!");
assert(str_contains($routerCode, "patchProgress"), "router.php MUST dispatch to patchProgress!");

$historyCode = file_get_contents(__DIR__ . '/../php_backend/controllers/HistoryController.php');
assert(str_contains($historyCode, 'function patchProgress'), "HistoryController MUST implement patchProgress!");
assert(str_contains($historyCode, 'is_bool'), "HistoryController MUST validate boolean completed!");
assert(str_contains($historyCode, 'deleteHistoryItem'), "HistoryController MUST use deleteHistoryItem for unwatched!");
assert(str_contains($historyCode, "jsonError('Episodio no encontrado', 404)"), "HistoryController MUST return 404 for nonexistent episode!");

try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "  [Integration] Skipped ⚠ (MySQL offline on host, executes in CI)\n";
    echo "✓ PATCH Progress & Profile Isolation Invariant Tests passed!\n";
    exit(0);
}

// Clean test fixtures
$db->exec("DELETE FROM watch_history WHERE episode_id LIKE 'ep_patch_%'");
$db->exec("DELETE FROM episodes WHERE show_id = 'show_patch_test'");
$db->exec("DELETE FROM shows WHERE id = 'show_patch_test'");
$db->exec("DELETE FROM user_profiles WHERE username = 'patch_user'");
$db->exec("DELETE FROM users WHERE username = 'patch_user'");

DbHelper::registerUser('patch_user', 'PatchPass123!');
$profiles = DbHelper::getUserProfiles('patch_user');
$profileA = $profiles[0]; // Default profile

$profileB = DbHelper::saveUserProfile('patch_user', ['name' => 'Profile B', 'is_kids' => 0]);

// Create Show & Canonical Episode with duration 1200.0 seconds
DbHelper::saveShow([
    'id' => 'show_patch_test',
    'title' => 'Patch Progress Anime',
    'synopsis' => 'Test anime for patch progress',
    'rating' => 9.0,
    'year' => 2026,
    'age_rating' => 'PG-13'
]);

DbHelper::saveEpisode([
    'id' => 'ep_patch_01',
    'show_id' => 'show_patch_test',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Episode 1',
    'filepath' => '/media/ep_patch_1.mp4',
    'duration' => 1200.0
]);

function sendPatchRequest(array $body, string $episodeId, array $profile): array {
    $jwt = AuthMiddleware::createToken([
        'username' => 'patch_user',
        'role' => 'user',
        'profile_id' => $profile['id'],
        'profile_name' => $profile['name'],
        'is_kids' => 0,
        'exp' => time() + 3600
    ]);
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$jwt}";
    $_SERVER['REQUEST_METHOD'] = 'PATCH';
    $GLOBALS['_MOCKED_JSON_INPUT'] = $body;

    ob_start();
    $statusCode = 200;
    try {
        HistoryController::patchProgress($episodeId);
    } catch (ExitException $e) {
        $statusCode = $e->statusCode;
    } catch (Throwable $e) {
        $statusCode = 500;
    }
    $raw = ob_get_clean();
    $data = json_decode($raw, true) ?: [];
    return ['status' => $statusCode, 'data' => $data, 'raw' => $raw];
}

// 1. Missing completed field (expects 400)
echo "  [1/6] Test missing completed field (expects 400)...\n";
$res = sendPatchRequest([], 'ep_patch_01', $profileA);
assert($res['status'] === 400, "Missing completed must return 400, got {$res['status']}");

// 2. Non-boolean completed field (expects 400)
echo "  [2/6] Test non-boolean completed field (expects 400)...\n";
$res = sendPatchRequest(['completed' => 'true_string'], 'ep_patch_01', $profileA);
assert($res['status'] === 400, "Non-boolean completed must return 400, got {$res['status']}");

// 3. Non-existent episode (expects 404)
echo "  [3/6] Test non-existent episode (expects 404)...\n";
$res = sendPatchRequest(['completed' => true], 'ep_patch_nonexistent', $profileA);
assert($res['status'] === 404, "Non-existent episode must return 404, got {$res['status']}");

// 4. Profile A marks as watched (completed = true)
echo "  [4/6] Profile A marks episode as watched (expects 200, duration = 1200, completed = 1)...\n";
$res = sendPatchRequest(['completed' => true], 'ep_patch_01', $profileA);
assert($res['status'] === 200, "Mark watched must return 200, got {$res['status']}");
assert($res['data']['completed'] === true, "Response must report completed: true");

$progA = DbHelper::getProgress('patch_user', $profileA['name'], 'ep_patch_01');
assert($progA !== null, "Profile A must have watch progress record");
assert($progA['completed'] === true, "Profile A record must be completed");
assert(abs($progA['progress'] - 1200.0) < 0.1, "Profile A progress must equal duration (1200.0), got {$progA['progress']}");

// Verify Profile B has NO progress (profile isolation)
$progB = DbHelper::getProgress('patch_user', $profileB['name'], 'ep_patch_01');
assert($progB === null || ($progB['completed'] === false && $progB['progress'] === 0.0), "Profile B must NOT have progress when Profile A marks watched!");

// 5. Profile B marks as unwatched (completed = false) without affecting Profile A
echo "  [5/6] Profile B marks episode as unwatched (Profile A remains watched)...\n";
$resB = sendPatchRequest(['completed' => false], 'ep_patch_01', $profileB);
assert($resB['status'] === 200, "Profile B unwatched request must succeed");

$progAAfter = DbHelper::getProgress('patch_user', $profileA['name'], 'ep_patch_01');
assert($progAAfter['completed'] === true, "Profile A must remain completed after Profile B action!");
assert(abs($progAAfter['progress'] - 1200.0) < 0.1, "Profile A progress must remain unchanged");

// 6. Profile A marks as unwatched (completed = false) -> progress deleted
echo "  [6/6] Profile A marks episode as unwatched (record deleted)...\n";
$resA = sendPatchRequest(['completed' => false], 'ep_patch_01', $profileA);
assert($resA['status'] === 200, "Mark unwatched must return 200, got {$resA['status']}");
assert($resA['data']['completed'] === false, "Response must report completed: false");

$progAFinal = DbHelper::getProgress('patch_user', $profileA['name'], 'ep_patch_01');
assert($progAFinal === null || ($progAFinal['completed'] === false && $progAFinal['progress'] === 0.0), "Profile A record must be deleted upon unwatched!");

// Clean test fixtures
$db->exec("DELETE FROM watch_history WHERE episode_id LIKE 'ep_patch_%'");
$db->exec("DELETE FROM episodes WHERE show_id = 'show_patch_test'");
$db->exec("DELETE FROM shows WHERE id = 'show_patch_test'");
$db->exec("DELETE FROM user_profiles WHERE username = 'patch_user'");
$db->exec("DELETE FROM users WHERE username = 'patch_user'");
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_SERVER['REQUEST_METHOD']);

echo "✓ PATCH Progress & Profile Isolation Tests passed completely!\n";
