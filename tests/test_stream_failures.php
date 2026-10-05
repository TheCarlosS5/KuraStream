<?php
/**
 * What the player gets when the server cannot convert a video. A real PHP web server answers over HTTP:
 *  - no ffmpeg installed: a clear 500 {code: FFMPEG_MISSING} (and the availability probe says so), while byte-range
 *    direct play (?direct=1) keeps working because it does not need ffmpeg;
 *  - ffmpeg installed but the file is damaged: a 500 {code: TRANSCODE_FAILED}, never "200 OK" with an empty body;
 *  - a healthy file: 200 video/mp4 with data (the headers now go out with the first byte).
 */
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';

echo "Running stream failure behaviour tests...\n";

$sfx = bin2hex(random_bytes(3));
$lib = sys_get_temp_dir() . "/kura_stream_fail_$sfx";
@mkdir("$lib/Anime/X", 0777, true);
$ffmpeg = trim((string)shell_exec('command -v ffmpeg'));
$show = "sf_show_$sfx"; $user = "sf_user_$sfx";
$db = Database::getConnection();

$cleanup = function () use ($db, $show, $user, $lib) {
    $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $show]);
    $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $show]);
    foreach (['user_profiles', 'users'] as $t) $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $user]);
    foreach (glob("$lib/Anime/X/*") ?: [] as $f) @unlink($f);
    @rmdir("$lib/Anime/X"); @rmdir("$lib/Anime"); @rmdir($lib);
};

$server = null;
try {
    DbHelper::registerUser($user, 'sf_password_1');
    $profile = DbHelper::getUserProfiles($user)[0];
    $token = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'ver' => 0, 'exp' => time() + 600]);

    file_put_contents("$lib/Anime/X/garbage.mkv", random_bytes(150000));
    DbHelper::saveShow(['id' => $show, 'title' => 'SF', 'synopsis' => 's', 'rating' => 5, 'year' => 2026]);
    $episode = fn($n, $file, $codec) => DbHelper::saveEpisode(['id' => "{$show}_e$n", 'show_id' => $show, 'season_number' => 1, 'episode_number' => $n,
        'title' => "E$n", 'filepath' => "$lib/Anime/X/$file", 'duration' => 2.0, 'video_codec' => $codec]);
    $episode(1, 'garbage.mkv', 'hevc');
    $hasGood = false;
    if ($ffmpeg !== '') {
        $cmd = escapeshellarg($ffmpeg) . " -v error -y -f lavfi -i testsrc=duration=2:size=64x64:rate=10 -f lavfi -i sine=duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest " . escapeshellarg("$lib/Anime/X/good.mkv") . ' 2>&1';
        shell_exec($cmd);
        $hasGood = is_file("$lib/Anime/X/good.mkv") && filesize("$lib/Anime/X/good.mkv") > 1000;
        if ($hasGood) $episode(2, 'good.mkv', 'h264');
    }

    $start = function (array $extraEnv) use ($lib, &$server) {
        $sock = stream_socket_server('tcp://127.0.0.1:0');
        $port = (int)substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
        fclose($sock);
        $env = array_merge(['PATH' => getenv('PATH'), 'JWT_SECRET' => getenv('JWT_SECRET'), 'DB_HOST' => DB_HOST, 'DB_PORT' => (string)DB_PORT, 'DB_NAME' => DB_NAME,
            'DB_USER' => DB_USER, 'DB_PASS' => (string)DB_PASS, 'MEDIA_LIBRARY_PATH' => $lib, 'HOME' => sys_get_temp_dir()], $extraEnv);
        $server = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/../php_backend/router.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, dirname(__DIR__), $env);
        for ($i = 0; $i < 50; $i++) { if (@fsockopen('127.0.0.1', $port, $e, $s, 0.2)) break; usleep(100000); }
        return $port;
    };
    $stop = function () use (&$server) { if (is_resource($server)) { proc_terminate($server); proc_close($server); } $server = null; };
    $get = function (int $port, string $uri, array $headers = []) use ($token) {
        $h = "Authorization: Bearer $token\r\nX-Requested-With: XMLHttpRequest\r\n";
        foreach ($headers as $k => $v) $h .= "$k: $v\r\n";
        $ctx = stream_context_create(['http' => ['method' => 'GET', 'ignore_errors' => true, 'timeout' => 40, 'header' => $h]]);
        $body = (string)@file_get_contents("http://127.0.0.1:$port$uri", false, $ctx);
        $resp = $http_response_header ?? [];
        preg_match('#HTTP/\S+ (\d+)#', $resp[0] ?? '', $m);
        $type = '';
        foreach ($resp as $line) if (stripos($line, 'Content-Type:') === 0) $type = trim(substr($line, 13));
        return [(int)($m[1] ?? 0), $type, $body];
    };

    // 1. No ffmpeg: PATH without it (the lookup uses `which`, then runs `ffmpeg -version`)
    $port = $start(['PATH' => '/nonexistent']);
    [$code, $type, $body] = $get($port, "/api/stream/{$show}_e1");
    $j = json_decode($body, true);
    assert($code === 500 && ($j['code'] ?? '') === 'FFMPEG_MISSING' && str_contains($j['error'] ?? '', 'ffmpeg'), "Missing ffmpeg is a clear 500 (got $code " . substr($body, 0, 120) . ')');
    [$code, , $body] = $get($port, "/api/stream/{$show}_e1/availability");
    $j = json_decode($body, true);
    assert($code === 200 && ($j['success'] ?? true) === false && ($j['code'] ?? '') === 'FFMPEG_MISSING', 'The availability probe reports it too (' . $body . ')');
    [$code, , $body] = $get($port, "/api/stream/{$show}_e1?direct=1", ['Range' => 'bytes=0-99']);
    assert($code === 206 && strlen($body) === 100, "Direct play does not need ffmpeg and still works (got $code, " . strlen($body) . ' bytes)');
    $stop();
    echo "✓ No ffmpeg: clear error, probe says so, direct play unaffected OK\n";

    if ($ffmpeg === '') {
        echo "  Skipped the ffmpeg-present cases: ffmpeg is not installed on this host\n";
    } else {
        $port = $start([]);
        // 2. Damaged file: an error, not an empty 200
        [$code, $type, $body] = $get($port, "/api/stream/{$show}_e1");
        $j = json_decode($body, true);
        assert($code === 500 && ($j['code'] ?? '') === 'TRANSCODE_FAILED', "A damaged file is a 500, never an empty 200 (got $code $type " . substr($body, 0, 100) . ')');
        echo "✓ Damaged file: 500 TRANSCODE_FAILED instead of an empty 200 OK\n";
        // 3. Healthy file still streams, with the video headers
        if ($hasGood) {
            [$code, $type, $body] = $get($port, "/api/stream/{$show}_e2");
            assert($code === 200 && stripos($type, 'video/mp4') === 0 && strlen($body) > 1000 && substr($body, 4, 4) === 'ftyp', "A healthy MKV is remuxed to fragmented MP4 (got $code $type " . strlen($body) . ' bytes)');
            echo "✓ Healthy file: 200 video/mp4 with data OK\n";
        }
        $stop();
    }
} finally {
    if (is_resource($server)) { proc_terminate($server); proc_close($server); }
    $cleanup();
}
echo "Stream failure behaviour tests passed!\n";
