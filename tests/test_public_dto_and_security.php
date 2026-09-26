<?php
/**
 * Test Suite for Public Episode DTO & Zero Server Path Leakage
 * Verifies that GET /api/shows/:id, GET /api/episodes/:id, and DbHelper::serializeEpisodeForClient
 * NEVER leak absolute server paths (filepath, /home/, C:\, LIBRARY_DIR) to clients.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running Public Episode DTO & Security Privacy Tests...\n";

// -------------------------------------------------------------------------------------------------
// 1. Direct Serializer Unit Verification
// -------------------------------------------------------------------------------------------------
echo "  [1/3] Testing DbHelper::serializeEpisodeForClient unit privacy...\n";
$mockEpisodeRaw = [
    'id' => 'show_sec_S01_E01',
    'show_id' => 'show_sec',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Secret Test Episode',
    'synopsis' => 'Testing zero path leakage.',
    'filepath' => 'C:\\Users\\Calos\\Desktop\\KuraStream\\library\\Anime\\SecretShow\\ep1.mp4',
    'duration' => 1420.5,
    'size' => 524288000,
    'video_codec' => 'h264',
    'audio_codec' => 'aac',
    'resolution' => '1080p',
    'fps' => 23.976,
    'audio_tracks' => json_encode([['index' => 0, 'language' => 'jpn', 'title' => 'Japanese']]),
    'subtitle_tracks' => json_encode([['index' => 0, 'language' => 'spa', 'title' => 'Español']]),
    'thumbnail_path' => '/library/Anime/SecretShow/thumb.jpg',
    'intro_start' => 90.0,
    'intro_end' => 180.0,
    'outro_start' => 1350.0,
    'chapters' => json_encode([['title' => 'Intro', 'start' => 0]]),
    'created_at' => '2026-09-25 12:00:00'
];

$serialized = DbHelper::serializeEpisodeForClient($mockEpisodeRaw);
$jsonSerialized = json_encode($serialized);

assert(!array_key_exists('filepath', $serialized), "Serialized DTO must NOT contain 'filepath' key");
assert(!str_contains($jsonSerialized, 'C:\\Users'), "Serialized JSON must NOT leak local Windows path");
assert(!str_contains($jsonSerialized, 'KuraStream\\library'), "Serialized JSON must NOT leak server directory structure");
assert(!str_contains($jsonSerialized, '/home/'), "Serialized JSON must NOT leak UNIX home path");
assert($serialized['direct_playable'] === true, "MP4 video must be marked direct_playable = true");
assert($serialized['container'] === 'mp4', "Container must be detected as 'mp4'");
assert(is_array($serialized['audio_tracks']), "audio_tracks must be decoded array");
assert(is_array($serialized['subtitle_tracks']), "subtitle_tracks must be decoded array");
assert($serialized['stream_url'] === '/api/stream/show_sec_S01_E01', "stream_url must point to safe endpoint");
echo "    ✓ serializeEpisodeForClient strips filepath and computes safe container flags\n";

// Test MKV container computation
$mockMkv = $mockEpisodeRaw;
$mockMkv['filepath'] = '/home/kurastream/library/Anime/SecretShow/ep2.mkv';
$serializedMkv = DbHelper::serializeEpisodeForClient($mockMkv);
assert($serializedMkv['direct_playable'] === false, "MKV video must be marked direct_playable = false");
assert($serializedMkv['container'] === 'mkv', "Container must be detected as 'mkv'");
assert(!str_contains(json_encode($serializedMkv), '/home/kurastream'), "MKV serialized JSON must NOT leak /home/ path");
echo "    ✓ MKV container correctly marked non-direct playable without path leaks\n";

// -------------------------------------------------------------------------------------------------
// 2. Endpoint Testing: GET /api/episodes/:id (PlayerController::getEpisodeDetails)
// -------------------------------------------------------------------------------------------------
echo "  [2/3] Testing PlayerController::getEpisodeDetails endpoint output...\n";
try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "SKIPPED ⚠ (MySQL offline for DB endpoint checks)\n";
    exit(0);
}

// Clean up fixtures
$db->exec("DELETE FROM episodes WHERE show_id = 'show_sec_test'");
$db->exec("DELETE FROM shows WHERE id = 'show_sec_test'");

// Insert show and episode
$db->exec("INSERT INTO shows (id, title, synopsis, age_rating) VALUES ('show_sec_test', 'Security Test Show', 'Synopsis', 'TV-14')");
DbHelper::saveEpisode([
    'id' => 'ep_sec_1',
    'show_id' => 'show_sec_test',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Secret Ep 1',
    'filepath' => 'C:\\Sensitive\\Server\\Path\\video.mp4',
    'duration' => 1200.0
]);

// Call PlayerController::getEpisodeDetails('ep_sec_1') and capture response
ob_start();
try {
    PlayerController::getEpisodeDetails('ep_sec_1');
} catch (ExitException $e) {
    // Normal exit in testing mode
}
$epResponseJson = ob_get_clean();
$epData = json_decode($epResponseJson, true);

assert(is_array($epData), "Episode details must return valid JSON object");
assert(!isset($epData['filepath']), "Episode endpoint must NOT contain 'filepath'");
assert(!str_contains($epResponseJson, 'Sensitive'), "Response must not leak 'Sensitive' path");
assert(!str_contains($epResponseJson, 'C:\\'), "Response must not leak Windows drive path");
assert(!str_contains($epResponseJson, '/home/'), "Response must not leak Unix path");
echo "    ✓ GET /api/episodes/:id is free of internal server filepaths\n";

// -------------------------------------------------------------------------------------------------
// 3. Endpoint Testing: GET /api/shows/:id (ShowController::getShowDetails)
// -------------------------------------------------------------------------------------------------
echo "  [3/3] Testing ShowController::getShowDetails endpoint output...\n";
ob_start();
try {
    ShowController::getShowDetails('show_sec_test');
} catch (ExitException $e) {
    // Normal exit in testing mode
}
$showResponseJson = ob_get_clean();
$showData = json_decode($showResponseJson, true);

assert(is_array($showData), "Show details must return valid JSON object");
assert(!str_contains($showResponseJson, 'Sensitive'), "Show response must not leak 'Sensitive' path");
assert(!str_contains($showResponseJson, 'C:\\'), "Show response must not leak Windows drive path");
assert(!str_contains($showResponseJson, '/home/'), "Show response must not leak Unix path");
assert(!str_contains($showResponseJson, 'filepath'), "Show response must not contain 'filepath' key anywhere");

if (!empty($showData['episodes'])) {
    foreach ($showData['episodes'] as $eItem) {
        assert(!isset($eItem['filepath']), "Every episode in show details must have NO filepath");
        assert(isset($eItem['direct_playable']), "Every episode must have direct_playable");
        assert(isset($eItem['container']), "Every episode must have container");
    }
}

// Cleanup fixtures
$db->exec("DELETE FROM episodes WHERE show_id = 'show_sec_test'");
$db->exec("DELETE FROM shows WHERE id = 'show_sec_test'");

echo "    ✓ GET /api/shows/:id serialized zero server filepaths across all seasons\n";
echo "✓ All Public Episode DTO & Privacy Tests passed successfully!\n";
