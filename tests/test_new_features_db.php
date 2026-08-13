<?php
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';

try {
    $db = Database::getConnection();
    echo "DB Connection OK\n";

    $testUser = 'test_user_new_features';
    $testProfile = 'Principal';
    $testShowId = 'test_show_new_feat';
    $testEpId = 'test_ep_new_feat';

    // Clean up any stale test data
    $db->prepare("DELETE FROM favorites WHERE username = :u")->execute(['u' => $testUser]);
    $db->prepare("DELETE FROM watch_history WHERE username = :u")->execute(['u' => $testUser]);
    $db->prepare("DELETE FROM episodes WHERE show_id = :id")->execute(['id' => $testShowId]);
    $db->prepare("DELETE FROM shows WHERE id = :id")->execute(['id' => $testShowId]);

    // Test 1: getRandomShow
    $random = DbHelper::getRandomShow();
    // Should return null or array
    assert($random === null || is_array($random), "getRandomShow should return null or array");
    echo "getRandomShow initial call OK\n";

    // Setup test data
    DbHelper::saveShow([
        'id' => $testShowId,
        'title' => 'Test Show New Features',
        'synopsis' => 'Test Synopsis',
        'rating' => 9.5,
        'year' => 2026,
        'genres' => 'Acción, Sci-Fi',
        'media_type' => 'anime'
    ]);

    DbHelper::saveEpisode([
        'id' => $testEpId,
        'show_id' => $testShowId,
        'season_number' => 1,
        'episode_number' => 1,
        'title' => 'Test Episode 1',
        'filepath' => '/tmp/test_ep1.mp4',
        'duration' => 1200
    ]);

    // Verify getRandomShow now returns a show
    $randomWithData = DbHelper::getRandomShow();
    assert(is_array($randomWithData), "getRandomShow should return a show when data exists");
    assert(isset($randomWithData['id']), "getRandomShow return item should have id");
    echo "getRandomShow with data OK: " . $randomWithData['title'] . "\n";

    // Test 2: watch history and getUserStats
    $stmt = $db->prepare("
        INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration)
        VALUES (:u, :p, :ep, :prog, :dur)
    ");
    $stmt->execute([
        'u' => $testUser,
        'p' => $testProfile,
        'ep' => $testEpId,
        'prog' => 1000,
        'dur' => 1200
    ]);

    $stats = DbHelper::getUserStats($testUser, $testProfile);
    assert(isset($stats['total_time_seconds']), "stats should have total_time_seconds");
    assert(isset($stats['completed_shows']), "stats should have completed_shows");
    assert(isset($stats['watched_episodes']), "stats should have watched_episodes");
    assert(isset($stats['top_genre']), "stats should have top_genre");
    assert(isset($stats['genres_breakdown']), "stats should have genres_breakdown");

    assert($stats['total_time_seconds'] === 1000, "total_time_seconds should be 1000, got " . $stats['total_time_seconds']);
    assert($stats['watched_episodes'] === 1, "watched_episodes should be 1, got " . $stats['watched_episodes']);
    assert($stats['completed_shows'] === 1, "completed_shows should be 1, got " . $stats['completed_shows']);
    assert(is_string($stats['top_genre']), "top_genre should be string");
    assert(is_array($stats['genres_breakdown']), "genres_breakdown should be array");
    echo "getUserStats OK: total=" . $stats['total_time_seconds'] . "s, watched_eps=" . $stats['watched_episodes'] . ", completed_shows=" . $stats['completed_shows'] . ", top_genre=" . $stats['top_genre'] . "\n";

    // Test 3: getNotifications
    // Add favorite
    $favStmt = $db->prepare("INSERT INTO favorites (username, profile_name, show_id) VALUES (:u, :p, :s)");
    $favStmt->execute(['u' => $testUser, 'p' => $testProfile, 's' => $testShowId]);

    $notifs = DbHelper::getNotifications($testUser, $testProfile);
    assert(is_array($notifs), "getNotifications should return array");
    assert(count($notifs) >= 1, "getNotifications should return at least 1 notification for favorited show");
    assert($notifs[0]['show_id'] === $testShowId, "Notification show_id should match favorited show");
    echo "getNotifications OK: count=" . count($notifs) . "\n";

    // Test 4: deleteHistoryItem & clearUserHistory
    DbHelper::deleteHistoryItem($testUser, $testProfile, $testEpId);
    $afterDeleteStats = DbHelper::getUserStats($testUser, $testProfile);
    assert($afterDeleteStats['watched_episodes'] === 0, "watched_episodes should be 0 after deleteHistoryItem");
    echo "deleteHistoryItem OK\n";

    // Re-insert history item then test clearUserHistory
    $stmt->execute([
        'u' => $testUser,
        'p' => $testProfile,
        'ep' => $testEpId,
        'prog' => 500,
        'dur' => 1200
    ]);
    DbHelper::clearUserHistory($testUser, $testProfile);
    $afterClearStats = DbHelper::getUserStats($testUser, $testProfile);
    assert($afterClearStats['watched_episodes'] === 0, "watched_episodes should be 0 after clearUserHistory");
    echo "clearUserHistory OK\n";

    // Clean up test data
    $db->prepare("DELETE FROM favorites WHERE username = :u")->execute(['u' => $testUser]);
    $db->prepare("DELETE FROM watch_history WHERE username = :u")->execute(['u' => $testUser]);
    DbHelper::deleteShow($testShowId);

    echo "ALL TESTS PASSED\n";
} catch (Throwable $e) {
    echo "TEST FAILED: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
