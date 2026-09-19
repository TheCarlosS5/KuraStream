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

// 7. Test Delete Show Uses Only the Selected Show's Canonical Directory
$canonicalShowId = 'naruto';
$siblingShowDir = LIBRARY_DIR . '/Anime/naruto-shippuden';
$canonicalShowDir = LIBRARY_DIR . '/Anime/' . $canonicalShowId;
$canonicalMarker = $canonicalShowDir . '/delete-me.txt';
$siblingMarker = $siblingShowDir . '/keep-me.txt';

assert(!file_exists($canonicalShowDir), 'Test requires an unused canonical naruto directory');
assert(!file_exists($siblingShowDir), 'Test requires an unused sibling naruto-shippuden directory');

@mkdir($canonicalShowDir, 0777, true);
@mkdir($siblingShowDir, 0777, true);
file_put_contents($canonicalMarker, 'delete');
file_put_contents($siblingMarker, 'keep');
DbHelper::saveShow([
    'id' => $canonicalShowId,
    // The old directory scan matches this title to the sibling folder.
    'title' => 'Naruto Shippuden',
    'media_type' => 'anime'
]);

try {
    $caughtCanonicalDelete = false;
    ob_start();
    try {
        ShowController::deleteShow($canonicalShowId);
    } catch (ExitException $e) {
        $caughtCanonicalDelete = ($e->statusCode === 200);
    }
    ob_get_clean();

    assert($caughtCanonicalDelete, "ShowController::deleteShow should return 200 OK for the canonical show");
    assert(!is_dir($canonicalShowDir), "Selected show's canonical media directory should be deleted");
    assert(is_dir($siblingShowDir), "Deleting naruto must not delete sibling naruto-shippuden directory");
    assert(file_exists($siblingMarker), "Deleting naruto must preserve sibling media files");
    echo "✓ Delete Show only removes the selected canonical media directory\n";
} finally {
    DbHelper::deleteShow($canonicalShowId);
    @unlink($siblingMarker);
    @rmdir($siblingShowDir);
}

// 8. Test Admin Stats & Disk Info (both camelCase and snake_case)
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
DbHelper::saveShow([
    'id' => 'akashic-records',
    'title' => 'Akashic Records',
    'media_type' => 'anime'
]);
DbHelper::saveEpisode([
    'id' => 'ep-akashic-1',
    'show_id' => 'akashic-records',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Episode 1',
    'filepath' => 'dummy.mp4'
]);
register_shutdown_function(function () {
    DbHelper::deleteShow('akashic-records');
});
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
DbHelper::deleteShow('akashic-records');

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
