<?php
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';

try {
    $db = Database::getConnection();
    echo "DB Connection OK\n";

    // Test 1: getUserPreferences default
    $prefs = DbHelper::getUserPreferences('test_user_autoskip', 'Principal');
    assert(isset($prefs['auto_skip_intro']), "auto_skip_intro should be present in default preferences");
    assert(isset($prefs['auto_play_next']), "auto_play_next should be present in default preferences");
    assert(is_bool($prefs['auto_skip_intro']), "auto_skip_intro should be boolean");
    assert(is_bool($prefs['auto_play_next']), "auto_play_next should be boolean");
    echo "Default prefs OK: auto_skip_intro=" . var_export($prefs['auto_skip_intro'], true) . ", auto_play_next=" . var_export($prefs['auto_play_next'], true) . "\n";

    // Test 2: saveUserPreferences
    DbHelper::saveUserPreferences('test_user_autoskip', 'Principal', ['auto_skip_intro' => true, 'auto_play_next' => true]);
    $updated = DbHelper::getUserPreferences('test_user_autoskip', 'Principal');
    assert($updated['auto_skip_intro'] === true, "auto_skip_intro should be true after save");
    assert($updated['auto_play_next'] === true, "auto_play_next should be true after save");
    assert(is_bool($updated['auto_skip_intro']), "auto_skip_intro should be boolean");
    assert(is_bool($updated['auto_play_next']), "auto_play_next should be boolean");
    echo "Save prefs OK\n";

    // Test 3: saveEpisodeTimestamps non-existent episode return false
    $nonExistentResult = DbHelper::saveEpisodeTimestamps('non_existent_ep_id_xyz', ['intro_start' => 10]);
    assert($nonExistentResult === false, "saveEpisodeTimestamps should return false for non-existent episode");
    echo "Non-existent episode timestamp save OK\n";

    // Test 3: saveEpisodeTimestamps and chapters column
    // First ensure dummy show and episode exist for testing
    DbHelper::saveShow([
        'id' => 'test_show_timestamps',
        'title' => 'Test Show Timestamps',
        'synopsis' => 'Test',
        'rating' => 8.0,
        'year' => 2026,
        'studio' => 'Test',
        'media_type' => 'anime'
    ]);

    DbHelper::saveEpisode([
        'id' => 'test_ep_timestamps',
        'show_id' => 'test_show_timestamps',
        'season_number' => 1,
        'episode_number' => 1,
        'title' => 'Test Ep 1',
        'synopsis' => 'Test Ep',
        'filepath' => '/tmp/test_ep.mp4',
        'duration' => 1400,
        'intro_start' => 0,
        'intro_end' => 90,
        'outro_start' => 1200
    ]);

    $chapters = [
        ['title' => 'Intro', 'start' => 0, 'end' => 90],
        ['title' => 'Episodio', 'start' => 90, 'end' => 1200],
        ['title' => 'Outro', 'start' => 1200, 'end' => 1400]
    ];

    DbHelper::saveEpisodeTimestamps('test_ep_timestamps', [
        'intro_start' => 10,
        'intro_end' => 100,
        'outro_start' => 1250,
        'chapters' => $chapters
    ]);

    $ep = DbHelper::getEpisode('test_ep_timestamps');
    assert($ep !== null, "Episode should exist");
    assert($ep['intro_start'] == 10, "intro_start should be 10");
    assert($ep['intro_end'] == 100, "intro_end should be 100");
    assert($ep['outro_start'] == 1250, "outro_start should be 1250");
    assert(is_array($ep['chapters']), "chapters should be an array");
    assert(count($ep['chapters']) == 3, "chapters count should be 3");
    assert($ep['chapters'][0]['title'] === 'Intro', "first chapter title should be Intro");
    echo "Episode timestamps and chapters OK\n";

    // Clean up test data
    DbHelper::deleteShow('test_show_timestamps');
    $db->prepare("DELETE FROM user_preferences WHERE username = 'test_user_autoskip'")->execute();

    echo "ALL TESTS PASSED\n";
} catch (Throwable $e) {
    echo "TEST FAILED: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
