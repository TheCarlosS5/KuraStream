<?php
define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';
require_once __DIR__ . '/../php_backend/services/LibraryScanner.php';

echo "Running Library Scanner & Player Routes Tests...\n";

Database::initializeSchema();

// 1. Test Library Scanner Execution
$scanResult = LibraryScanner::runScan();
assert($scanResult['success'] === true, "Library scan failed");
echo "✓ LibraryScanner::runScan() executed successfully (scanned {$scanResult['scanned_count']} episodes in {$scanResult['shows_count']} shows)\n";

// 2. Test Show Retrieval and Stable IDs
$shows = DbHelper::getShows();
assert(is_array($shows), "DbHelper::getShows() should return an array");
echo "✓ Shows in database: " . count($shows) . "\n";

// 3. Test Progress Saving and Retrieval
$userToken = AuthMiddleware::createToken(['username' => 'testuser', 'role' => 'user', 'exp' => time() + 3600]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$userToken}";
$_GET['profile_name'] = 'Principal';

$testEpisodeId = 'test_show_S1_E1';
DbHelper::saveProgress('testuser', 'Principal', $testEpisodeId, 250.5, 1400.0, false);

$prog = DbHelper::getProgress('testuser', 'Principal', $testEpisodeId);
assert($prog !== null, "Progress should be found");
assert($prog['progress'] >= 250, "Progress seconds mismatch");
assert($prog['completed'] === false, "Completed status mismatch");

// Via Controller
$_GET['episode_id'] = $testEpisodeId;
$caughtProgress = false;
ob_start();
try {
    HistoryController::getProgress($testEpisodeId);
} catch (ExitException $e) {
    $caughtProgress = ($e->statusCode === 200);
    assert($e->data['progress'] >= 250, "Controller returned wrong progress");
}
ob_get_clean();
assert($caughtProgress, "HistoryController::getProgress should return 200 OK");
echo "✓ Watch Progress GET/POST Endpoints OK\n";

// 4. Test Subtitle Delivery
$caughtSub = false;
ob_start();
try {
    PlayerController::streamSubtitle($testEpisodeId, 0);
} catch (ExitException $e) {
    $caughtSub = ($e->statusCode === 200 || $e->statusCode === 404);
}
$subContent = ob_get_clean();
assert($caughtSub, "Subtitle stream should respond with 200/404");
echo "✓ Subtitle Stream Endpoint OK\n";

// 5. Test Check Favorite Endpoint
$_GET['showId'] = 'test_show';
$caughtFav = false;
ob_start();
try {
    HistoryController::checkFavorite();
} catch (ExitException $e) {
    $caughtFav = ($e->statusCode === 200);
}
ob_get_clean();
assert($caughtFav, "HistoryController::checkFavorite should return 200 OK");
// 6. Test Delete Show Endpoint (Admin Restricted)
$adminToken = AuthMiddleware::createToken(['username' => 'admin', 'role' => 'admin', 'exp' => time() + 3600]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$adminToken}";

$dummyShowId = 'dummy_test_delete_show';
DbHelper::saveShow([
    'id' => $dummyShowId,
    'title' => 'Dummy Delete Test',
    'media_type' => 'anime'
]);
assert(DbHelper::getShow($dummyShowId) !== null, "Dummy show should be in DB");

$caughtDelete = false;
ob_start();
try {
    ShowController::deleteShow($dummyShowId);
} catch (ExitException $e) {
    $caughtDelete = ($e->statusCode === 200);
}
ob_get_clean();
assert($caughtDelete, "ShowController::deleteShow should return 200 OK");
assert(DbHelper::getShow($dummyShowId) === null, "Dummy show should be deleted from DB");
echo "✓ Delete Show Endpoint (Admin Restricted) OK\n";

// 7. Test Admin Stats & Disk Info (both camelCase and snake_case)
$caughtStats = false;
ob_start();
try {
    AdminController::getStats();
} catch (ExitException $e) {
    $caughtStats = ($e->statusCode === 200);
    assert(isset($e->data['showsCount']), "showsCount missing");
    assert(isset($e->data['shows_count']), "shows_count missing");
    assert(isset($e->data['diskInfo']), "diskInfo missing");
}
ob_get_clean();
assert($caughtStats, "AdminController::getStats should return 200 OK");
echo "✓ Admin Stats & Disk Info Endpoint OK\n";

// 8. Test Admin Logs
$caughtLogs = false;
ob_start();
try {
    AdminController::getLogs();
} catch (ExitException $e) {
    $caughtLogs = ($e->statusCode === 200);
    assert(isset($e->data['logs']), "logs missing");
    assert(is_array($e->data['lines']), "lines should be array");
}
ob_get_clean();
assert($caughtLogs, "AdminController::getLogs should return 200 OK");
echo "✓ Admin Logs Endpoint OK\n";

// 9. Test Autodownload Status
$caughtTorrent = false;
ob_start();
try {
    AdminController::getTorrentStatus();
} catch (ExitException $e) {
    $caughtTorrent = ($e->statusCode === 200);
}
ob_get_clean();
assert($caughtTorrent, "AdminController::getTorrentStatus should return 200 OK");
echo "✓ Torrent / Autodownload Status Endpoint OK\n";

// 10. Test Show Details Dual Object Compatibility
$caughtShowDetails = false;
ob_start();
try {
    ShowController::getShowDetails('Akashic Records');
} catch (ExitException $e) {
    $caughtShowDetails = ($e->statusCode === 200);
    assert(isset($e->data['title']), "Root title missing");
    assert(isset($e->data['show']['title']), "Nested show.title missing");
    assert(isset($e->data['episodes']), "episodes list missing");
}
ob_get_clean();
assert($caughtShowDetails, "ShowController::getShowDetails should return dual-compatible payload");
echo "✓ Show Details Dual Object Compatibility OK\n";

// 11. Test Staged Imports Key Compatibility
$caughtStaged = false;
ob_start();
try {
    AdminController::getStaged();
} catch (ExitException $e) {
    $caughtStaged = ($e->statusCode === 200);
    assert(is_array($e->data), "staged list should be array");
}
ob_get_clean();
assert($caughtStaged, "AdminController::getStaged should return 200 OK");
echo "✓ Staged Imports Endpoint OK\n";

echo "\n🎉 ALL SCANNER, PLAYER, AND API ROUTE TESTS PASSED 100%!
";
