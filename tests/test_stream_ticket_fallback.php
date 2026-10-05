<?php
$lib = sys_get_temp_dir() . '/kura_tf_' . getmypid();
@mkdir("$lib/Anime/tf", 0777, true);
putenv('MEDIA_LIBRARY_PATH=' . $lib);
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running stream ticket fallback tests (an expired room ticket plus a session)...\n";

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$showId = "tf_show_$suffix"; $epId = "tf_ep_$suffix"; $user = "tf_user_$suffix";
$server = null;
try {
    $file = "$lib/Anime/tf/ep.mp4";
    exec(sprintf('ffmpeg -nostdin -y -v error -f lavfi -i testsrc=duration=1:size=64x64:rate=5 -c:v libx264 -pix_fmt yuv420p %s 2>&1', escapeshellarg($file)), $o, $rc);
    assert($rc === 0, 'fixture');
    DbHelper::saveShow(['id' => $showId, 'title' => 'TF', 'type' => 'anime', 'folder' => 'tf']);
    DbHelper::saveEpisode(['id' => $epId, 'show_id' => $showId, 'season_number' => 1, 'episode_number' => 1, 'title' => 'E', 'filepath' => $file, 'duration' => 1, 'size' => filesize($file),
        'video_codec' => 'h264', 'resolution' => '64x64', 'fps' => 5, 'audio_tracks' => [], 'subtitle_tracks' => [], 'thumbnail_path' => '', 'chapters' => []]);
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    $profile = DbHelper::getUserProfiles($user)[0];
    $session = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'is_kids' => false, 'exp' => time() + 3600]);
    $expired = AuthMiddleware::createToken(['type' => 'watch_party_stream', 'room_id' => 'NO-SUCH-ROOM', 'member_id' => 'm1', 'exp' => time() - 60]);

    [$server, $port] = kura_start_server(['MEDIA_LIBRARY_PATH' => $lib]);
    [$code] = kura_http($port, 'GET', "/api/stream/$epId?ticket=" . urlencode($expired), null, null, 'Range: bytes=0-9' . "\r\n");
    assert($code === 403, "an expired ticket with no session is refused (got $code)");
    [$code] = kura_http($port, 'GET', "/api/stream/$epId", null, null, 'X-Stream-Capability: ' . $expired . "\r\nRange: bytes=0-9\r\n");
    assert($code === 403, "the header form behaves the same (got $code)");
    [$code] = kura_http($port, 'GET', "/api/stream/$epId?ticket=" . urlencode($expired), null, $session, 'Range: bytes=0-9' . "\r\n");
    assert($code === 206 || $code === 200, "an expired ticket does not lock out a signed-in viewer (got $code)");
    [$code] = kura_http($port, 'GET', "/api/stream/$epId", null, $session, 'X-Stream-Capability: ' . $expired . "\r\nRange: bytes=0-9\r\n");
    assert($code === 206 || $code === 200, "header form with a session (got $code)");
    [$code] = kura_http($port, 'GET', "/api/stream/$epId", null, 'not.a.valid.token', 'Range: bytes=0-9' . "\r\n");
    assert($code === 401, "a bad session alone is still 401 (got $code)");
    echo "✓ Expired room ticket falls back to the session OK\n";
} finally {
    kura_stop_server($server);
    $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $showId]);
    DbHelper::deleteShow($showId);
    $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $user]);
    $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $user]);
    foreach ([$file ?? ''] as $f) { if ($f) @unlink($f); }
    @rmdir("$lib/Anime/tf"); @rmdir("$lib/Anime"); @rmdir($lib);
}
echo "All stream ticket fallback tests passed.\n";
