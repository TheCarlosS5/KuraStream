<?php
$lib = sys_get_temp_dir() . '/kura_tm_' . getmypid();
mkdir("$lib/Anime/tm", 0777, true);
putenv('MEDIA_LIBRARY_PATH=' . $lib);
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/services/FfmpegScanner.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running transcode management tests (bit depth, limits, session replacement, availability)...\n";

function tm_rm(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (array_diff(scandir($p), ['.', '..']) as $e) tm_rm("$p/$e");
    @rmdir($p);
}
/** Starts a PHP child that takes a transcode slot (like a streaming request would) and reports READY <pid-of-fake-ffmpeg>. */
function tm_holder(string $key, string $fakeProcess, int $maxWorkers = 1, int $holdSeconds = 25): array {
    $code = 'define("TESTING_MODE", true); require ' . var_export(__DIR__ . '/../php_backend/controllers/PlayerController.php', true) . ';'
        . 'TranscodeLimiter::$maxWorkers = ' . $maxWorkers . ';'
        . 'if (!TranscodeLimiter::acquireSlot(2, ' . var_export($key, true) . ')) { echo "NOSLOT\n"; exit(1); }'
        . '$p = proc_open(["bash", "-c", ' . var_export($fakeProcess, true) . '], [1 => ["file", "/dev/null", "w"]], $pipes);'
        . '$pid = proc_get_status($p)["pid"]; TranscodeLimiter::setProcessPid($pid, ' . var_export($key, true) . ');'
        . 'echo "READY $pid\n"; $end = time() + ' . $holdSeconds . ';'
        . 'while (time() < $end && proc_get_status($p)["running"]) usleep(25000);'   // the streaming loop ends when ffmpeg dies
        . '@proc_terminate($p, 9); TranscodeLimiter::releaseSlot(); echo "RELEASED\n";';
    $proc = proc_open([PHP_BINARY, '-r', $code], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, getenv());
    $line = fgets($pipes[1]);
    assert(preg_match('/^READY (\d+)/', (string)$line, $m) === 1, "slot holder failed to start: " . trim((string)$line));
    return [$proc, $pipes, (int)$m[1]];
}
function tm_alive(int $pid): bool { return $pid > 0 && file_exists("/proc/$pid") && !str_contains((string)@file_get_contents("/proc/$pid/stat"), ') Z'); }
function tm_stop(array $h): void {
    if (!is_resource($h[0])) { return; }   // already stopped
    @proc_terminate($h[0], 9);
    if (is_resource($h[1][1])) { @fclose($h[1][1]); }
    @proc_close($h[0]);
}

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$showId = "tm_show_$suffix"; $ep8 = "tm_ep8_$suffix"; $ep10 = "tm_ep10_$suffix";
$server = null; $holders = [];

try {
    // 1. Pixel format -> bit depth
    foreach (['yuv420p' => 8, 'nv12' => 8, 'rgb24' => 8, 'yuv420p10le' => 10, 'p010le' => 10, 'yuv444p12le' => 12, 'gray10le' => 10, '' => 8, null => 8] as $fmt => $depth) {
        assert(FfmpegScanner::bitDepthFromPixFmt($fmt === '' ? null : (string)$fmt) === $depth, "pix_fmt '$fmt' -> $depth bits");
    }
    assert(FfmpegScanner::bitDepthOfStream(['pix_fmt' => 'yuv420p', 'bits_per_raw_sample' => '10']) === 10, 'bits_per_raw_sample wins');
    echo "✓ Bit depth from pixel format OK\n";

    // 2. Real files: 8-bit plays directly, Hi10P is sent to ffmpeg; the answer is stored for next time
    $mk = function (string $name, string $pixFmt, string $extra = '') use ($lib) {
        $out = "$lib/Anime/tm/$name.mp4";
        exec(sprintf('ffmpeg -y -v error -f lavfi -i testsrc=duration=1:size=64x64:rate=5 -c:v libx264 %s -pix_fmt %s %s 2>&1', $extra, $pixFmt, escapeshellarg($out)), $o, $rc);
        return $rc === 0 && is_file($out) ? $out : null;
    };
    $f8 = $mk('eight', 'yuv420p');
    assert($f8 !== null, 'ffmpeg must be able to create an 8-bit H.264 fixture');
    $f10 = $mk('ten', 'yuv420p10le', '-profile:v high10');
    DbHelper::saveShow(['id' => $showId, 'title' => 'TM', 'rating' => 7.0, 'year' => 2024, 'age_rating' => 'PG-13', 'genres' => 'Action']);
    foreach ([[$ep8, $f8, 1], [$ep10, $f10 ?? $f8, 2]] as [$id, $path, $n]) {
        DbHelper::saveEpisode(['id' => $id, 'show_id' => $showId, 'season_number' => 1, 'episode_number' => $n, 'title' => "E$n", 'filepath' => (string)$path, 'duration' => 1, 'video_codec' => 'h264']);
    }
    $row8 = DbHelper::getEpisode($ep8);
    assert($row8['bit_depth'] === null, 'a library scanned before migration 017 starts without a bit depth');
    assert(PlayerController::canDirectPlay($row8, $f8, []) === true, '8-bit H.264 MP4 plays directly');
    assert((int)DbHelper::getEpisode($ep8)['bit_depth'] === 8, 'the probe result is stored on first playback');
    assert(PlayerController::canDirectPlay($row8, $f8, ['audio' => 1, 'start' => 30]) === false, 'a start offset still needs ffmpeg');
    if ($f10 !== null) {
        $row10 = DbHelper::getEpisode($ep10);
        assert(PlayerController::canDirectPlay($row10, $f10, []) === false, 'Hi10P H.264 must NOT be direct-played');
        assert((int)DbHelper::getEpisode($ep10)['bit_depth'] === 10, '10-bit is recorded');
        $probe = FfmpegScanner::probeVideo($f10);
        assert($probe['bit_depth'] === 10 && str_starts_with($probe['pix_fmt'], 'yuv420p10'), 'the scanner probe reports 10-bit');
        echo "✓ 10-bit H.264 is detected and not direct-played OK\n";
    } else {
        echo "  (skipped 10-bit checks: this ffmpeg build cannot encode 10-bit H.264)\n";
    }
    echo "✓ Direct-play decision and lazy bit-depth probe OK\n";

    // 3. Worker limit follows TRANSCODE_MAX_WORKERS, else half the cores
    $maxFor = function (?string $env) {
        $cmd = ($env !== null ? "TRANSCODE_MAX_WORKERS=$env " : 'env -u TRANSCODE_MAX_WORKERS ') . escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg('define("TESTING_MODE", true); require ' . var_export(__DIR__ . '/../php_backend/controllers/PlayerController.php', true) . '; echo TranscodeLimiter::maxWorkers();');
        return (int)shell_exec($cmd);
    };
    assert($maxFor('3') === 3, 'TRANSCODE_MAX_WORKERS=3 gives 3 workers');
    $auto = $maxFor(null);
    assert($auto >= 2, "default is at least 2 (got $auto)");
    echo "✓ Worker limit is configurable (auto = $auto here) OK\n";

    // 4. A new stream of the same session replaces the old ffmpeg; others and non-ffmpeg processes are left alone
    TranscodeLimiter::$maxWorkers = 1;
    TranscodeLimiter::resetAllSlots();
    $key = "$ep8|s:AAAA1111";
    $holders[] = $a = tm_holder($key, 'exec -a ffmpeg sleep 60');
    assert(tm_alive($a[2]), 'the fake ffmpeg of stream A is running');
    assert(TranscodeLimiter::acquireSlot(0, "$ep8|s:ZZZZ9999") === false, 'a different session must wait when every slot is busy');
    assert(tm_alive($a[2]), 'and must not stop the other stream');
    $t0 = microtime(true);
    assert(TranscodeLimiter::acquireSlot(3, $key) === true, 'a new stream of the SAME session takes over the slot (a seek)');
    $took = microtime(true) - $t0;
    assert($took < 2.5, sprintf('takeover is quick (%.2fs)', $took));
    assert(!tm_alive($a[2]), 'the previous ffmpeg of that session was stopped');
    TranscodeLimiter::releaseSlot();
    tm_stop($a);

    $holders[] = $b = tm_holder("$ep8|s:BBBB2222", 'exec -a notmpeg sleep 60');
    assert(TranscodeLimiter::acquireSlot(1, "$ep8|s:BBBB2222") === false, 'a slot whose process is not an ffmpeg is never signalled (pid reuse guard)');
    assert(tm_alive($b[2]), 'the unrelated process survives');
    tm_stop($b);
    posix_kill($b[2], 9);
    TranscodeLimiter::resetAllSlots();
    echo "✓ Same-session takeover stops the old ffmpeg; nothing else is touched OK\n";

    // 5. Availability endpoint through the real router, with every slot taken
    $user = "tm_user_$suffix";
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    $profile = DbHelper::getUserProfiles($user)[0];
    $token = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'is_kids' => false, 'exp' => time() + 3600]);
    [$server, $port] = kura_start_server(['MEDIA_LIBRARY_PATH' => $lib, 'TRANSCODE_MAX_WORKERS' => '1']);
    [$code] = kura_http($port, 'GET', "/api/stream/$ep8/availability");
    assert($code === 401, "availability needs a session (got $code)");
    [$code, , $json] = kura_http($port, 'GET', "/api/stream/$ep8/availability", null, $token);
    assert($code === 200 && $json['mode'] === 'direct' && $json['busy'] === false && $json['max_transcodes'] === 1, 'an idle server serves a direct-playable file directly');
    [, , $json] = kura_http($port, 'GET', "/api/stream/$ep8/availability?start=30", null, $token);
    assert($json['mode'] === 'transcode' && $json['busy'] === false && $json['active_transcodes'] === 0, 'a start offset needs a transcode slot, and one is free');

    $holders[] = $c = tm_holder("other|s:CCCC3333", 'exec -a ffmpeg sleep 60', 1);
    [, , $json] = kura_http($port, 'GET', "/api/stream/$ep8/availability?start=30", null, $token);
    assert($json['busy'] === true && $json['active_transcodes'] === 1, 'with every slot taken the probe says busy');
    [, , $json] = kura_http($port, 'GET', "/api/stream/$ep8/availability", null, $token);
    assert($json['mode'] === 'direct' && $json['busy'] === false, 'direct play is never "busy"');
    [$code, $h] = kura_http($port, 'GET', "/api/stream/$ep8?start=30", null, $token);
    assert($code === 503 && isset($h['retry-after']) && ($h['x-transcode-busy'] ?? '') === '1/1', "the stream answers 503 with Retry-After and X-Transcode-Busy (got $code)");
    tm_stop($c);
    echo "✓ Availability endpoint and 503 hints OK\n";
} finally {
    kura_stop_server($server);
    foreach ($holders as $h) { tm_stop($h); }
    TranscodeLimiter::resetAllSlots();
    $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $showId]);
    DbHelper::deleteShow($showId);
    if (isset($user)) {
        $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $user]);
        $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $user]);
    }
    tm_rm($lib);
}

echo "All transcode management tests passed.\n";
