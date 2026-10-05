<?php
/**
 * The production stack: nginx in front, two PHP-FPM pools behind it, rendered from the real deploy templates.
 * Without nginx and php-fpm installed the stack part is skipped (the header sync check always runs).
 */
define('TESTING_MODE', true);
$work = sys_get_temp_dir() . '/kura_stack_' . getmypid();
$lib = "$work/library";
@mkdir("$lib/Anime/stack", 0777, true);
putenv('MEDIA_LIBRARY_PATH=' . $lib);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running nginx + PHP-FPM deployment tests...\n";
$root = realpath(__DIR__ . '/..');

function st_rm(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (array_diff(scandir($p), ['.', '..']) as $e) st_rm("$p/$e");
    @rmdir($p);
}
function st_render(string $template, array $vars): string {
    $env = array_merge(getenv(), $vars);
    $proc = proc_open(['bash', "scripts/render_deploy.sh", $template], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, dirname(__DIR__), $env);
    $out = stream_get_contents($pipes[1]); $err = stream_get_contents($pipes[2]);
    $code = proc_close($proc);
    assert($code === 0, "render_deploy failed for $template: $err");
    return $out;
}
function st_find(array $names): ?string {
    foreach ($names as $n) {
        $p = trim((string)shell_exec('command -v ' . escapeshellarg($n) . ' 2>/dev/null'));
        if ($p !== '') return $p;
    }
    return null;
}
/** HTTP with raw response access (no redirects, optional extra headers, returns body bytes). */
function st_http(int $port, string $method, string $path, array $headers = [], ?string $body = null): array {
    $h = '';
    foreach ($headers as $k => $v) $h .= "$k: $v\r\n";
    $ctx = stream_context_create(['http' => ['method' => $method, 'ignore_errors' => true, 'timeout' => 20, 'header' => $h, 'content' => $body ?? '', 'follow_location' => 0]]);
    $raw = (string)@file_get_contents("http://127.0.0.1:$port$path", false, $ctx);
    preg_match('#HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m);
    $out = [];
    foreach ($http_response_header ?? [] as $line) {
        if (str_contains($line, ':')) { [$k, $v] = explode(':', $line, 2); $out[strtolower(trim($k))][] = trim($v); }
    }
    return [(int)($m[1] ?? 0), $out, $raw];
}

$procs = [];
try {
    // 1. The nginx security headers are generated from config.php: they cannot drift apart
    $expected = shell_exec(PHP_BINARY . ' ' . escapeshellarg("$root/php_backend/scripts/print_security_headers.php"));
    assert($expected === file_get_contents("$root/deploy/nginx/security-headers.conf"),
        'deploy/nginx/security-headers.conf is stale: run php php_backend/scripts/print_security_headers.php > deploy/nginx/security-headers.conf');
    echo "✓ nginx security headers are in sync with config.php\n";

    // X-Accel-Redirect URIs: library-relative, percent-encoded per segment, never outside the library
    assert(PlayerController::accelUri('/srv/lib/Anime/Show Name/Ep 01 #1.mkv', '/srv/lib') === '/_media/Anime/Show%20Name/Ep%2001%20%231.mkv', 'accel URI is encoded per segment');
    assert(PlayerController::accelUri('/srv/library2/x.mkv', '/srv/lib') === null && PlayerController::accelUri('/etc/passwd', '/srv/lib') === null, 'files outside the library are never redirected');
    $_SERVER['SERVER_SOFTWARE'] = 'nginx/1.24.0'; putenv('X_ACCEL');
    assert(PlayerController::useAccelRedirect() === true, 'nginx is detected');
    $_SERVER['SERVER_SOFTWARE'] = 'PHP 8.4.0 Development Server';
    assert(PlayerController::useAccelRedirect() === false, 'php -S is not nginx');
    putenv('X_ACCEL=1'); assert(PlayerController::useAccelRedirect() === true, 'X_ACCEL=1 forces it');
    $_SERVER['SERVER_SOFTWARE'] = 'nginx'; putenv('X_ACCEL=0'); assert(PlayerController::useAccelRedirect() === false, 'X_ACCEL=0 disables it');
    putenv('X_ACCEL'); unset($_SERVER['SERVER_SOFTWARE']);

    // 2. Templates render completely
    $vars = ['KURA_PORT' => '3000', 'KURA_APP_DIR' => '/opt/kurastream', 'KURA_LIBRARY_DIR' => '/opt/kurastream/library',
        'KURA_API_UPSTREAM' => 'unix:/run/php/kurastream-api.sock', 'KURA_STREAM_UPSTREAM' => 'unix:/run/php/kurastream-stream.sock'];
    $conf = st_render('deploy/nginx/kurastream.conf.template', $vars);
    assert(!str_contains($conf, '${KURA_') && str_contains($conf, 'alias /opt/kurastream/library/;') && str_contains($conf, '$uri'), 'nginx template renders and keeps nginx variables');
    foreach (['api', 'stream'] as $pool) {
        $p = st_render("deploy/php-fpm/kurastream-$pool.conf.template", ['KURA_USER' => 'kurastream', 'KURA_GROUP' => 'kurastream', 'KURA_WEB_USER' => 'www-data', 'KURA_WEB_GROUP' => 'www-data',
            'KURA_API_LISTEN' => '/run/php/a.sock', 'KURA_STREAM_LISTEN' => '/run/php/s.sock', 'KURA_PHP_ERROR_LOG' => '/var/log/x.log']);
        assert(!str_contains($p, '${KURA_') && str_contains($p, "[kurastream-$pool]"), "$pool pool renders");
    }
    echo "✓ Deployment templates render\n";

    $nginx = st_find(['nginx']);
    $fpm = st_find(['php-fpm', 'php-fpm8.4', 'php-fpm8.3', 'php-fpm8.2', 'php-fpm8.5']);
    $fpmHasMysql = $fpm && str_contains((string)shell_exec(escapeshellarg($fpm) . ' -m 2>/dev/null'), 'pdo_mysql');
    if (!$nginx || !$fpm || !$fpmHasMysql || !is_file('/etc/nginx/mime.types') || !is_file('/etc/nginx/fastcgi_params')) {
        echo "  (nginx / php-fpm not installed: live stack checks skipped)\n";
        echo "All deployment tests passed.\n";
        return;
    }

    // 3. Fixtures: users, a show with an MP4 and an MKV episode
    $db = Database::getConnection();
    $suffix = bin2hex(random_bytes(3));
    $showId = "stack_show_$suffix";
    $mp4 = "$lib/Anime/stack/ep1.mp4"; $mkv = "$lib/Anime/stack/ep2.mkv";
    foreach ([$mp4, $mkv] as $f) {
        exec(sprintf('ffmpeg -nostdin -y -v error -f lavfi -i testsrc=duration=2:size=64x64:rate=10 -c:v libx264 -pix_fmt yuv420p %s 2>&1', escapeshellarg($f)), $o, $rc);
        assert($rc === 0, 'fixture video');
    }
    DbHelper::saveShow(['id' => $showId, 'title' => 'Stack Show', 'type' => 'anime', 'folder' => 'stack']);
    $ep = fn(string $id, string $file, int $n) => ['id' => $id, 'show_id' => $showId, 'season_number' => 1, 'episode_number' => $n, 'title' => "Ep $n",
        'filepath' => $file, 'duration' => 2, 'size' => filesize($file), 'video_codec' => 'h264', 'resolution' => '64x64', 'fps' => 10,
        'audio_tracks' => [], 'subtitle_tracks' => [], 'thumbnail_path' => '', 'chapters' => []];
    DbHelper::saveEpisode($ep("stk_a_$suffix", $mp4, 1));
    DbHelper::saveEpisode($ep("stk_b_$suffix", $mkv, 2));
    $user = "stack_user_$suffix";
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    $profile = DbHelper::getUserProfiles($user)[0];
    $token = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'is_kids' => false, 'exp' => time() + 3600]);

    // 4. Render and start php-fpm + nginx as the current user (root runs the workers as "nobody")
    $isRoot = function_exists('posix_geteuid') && posix_geteuid() === 0;
    $runUser = $isRoot ? 'nobody' : (string)posix_getpwuid(posix_geteuid())['name'];
    $runGroup = $isRoot ? 'nogroup' : (string)posix_getgrgid(posix_getegid())['name'];
    chmod($work, 0755);
    foreach ([$lib, "$lib/Anime", "$lib/Anime/stack"] as $d) chmod($d, 0755);
    foreach ([$mp4, $mkv] as $f) chmod($f, 0644);

    $free = function (): int {
        $s = stream_socket_server('tcp://127.0.0.1:0'); $p = (int)substr(strrchr(stream_socket_get_name($s, false), ':'), 1); fclose($s); return $p;
    };
    $port = $free();
    @mkdir("$work/run/pools", 0777, true); @mkdir("$work/nginx/kurastream.d", 0777, true); @mkdir("$work/prefix", 0777, true);
    chmod("$work/run", 0777); chmod("$work/nginx", 0755); chmod("$work/prefix", 0777);
    $poolVars = ['KURA_USER' => $runUser, 'KURA_GROUP' => $runGroup, 'KURA_WEB_USER' => $runUser, 'KURA_WEB_GROUP' => $runGroup,
        'KURA_API_LISTEN' => "$work/run/api.sock", 'KURA_STREAM_LISTEN' => "$work/run/stream.sock", 'KURA_PHP_ERROR_LOG' => "$work/run/php-error.log"];
    foreach (['api', 'stream'] as $pool) {
        file_put_contents("$work/run/pools/$pool.conf", st_render("deploy/php-fpm/kurastream-$pool.conf.template", $poolVars));
    }
    file_put_contents("$work/run/fpm.conf", "[global]\npid = $work/run/fpm.pid\nerror_log = $work/run/fpm.log\ndaemonize = no\ninclude = $work/run/pools/*.conf\n");
    @mkdir("$work/tmp", 0777, true); chmod("$work/tmp", 0777);
    $fpmEnv = array_merge(getenv(), ['TMPDIR' => "$work/tmp", 'JWT_SECRET' => JWT_SECRET, 'MEDIA_LIBRARY_PATH' => $lib, 'DB_HOST' => DB_HOST, 'DB_PORT' => DB_PORT, 'DB_NAME' => DB_NAME, 'DB_USER' => DB_USER, 'DB_PASS' => DB_PASS]);
    $procs[] = $fpmProc = proc_open([$fpm, '--nodaemonize', '--fpm-config', "$work/run/fpm.conf", '--allow-to-run-as-root'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', "$work/run/fpm.stderr", 'w']], $p1, $root, $fpmEnv);

    $nginxConf = st_render('deploy/nginx/kurastream.conf.template', ['KURA_PORT' => (string)$port, 'KURA_APP_DIR' => $root, 'KURA_LIBRARY_DIR' => $lib,
        'KURA_API_UPSTREAM' => "unix:$work/run/api.sock", 'KURA_STREAM_UPSTREAM' => "unix:$work/run/stream.sock"]);
    copy('/etc/nginx/mime.types', "$work/nginx/mime.types");
    copy('/etc/nginx/fastcgi_params', "$work/nginx/fastcgi_params");
    file_put_contents("$work/nginx/nginx.conf", "user $runUser $runGroup;\nworker_processes 2;\npid $work/run/nginx.pid;\nerror_log $work/run/nginx-error.log;\ndaemon off;\n"
        . "events { worker_connections 256; }\nhttp {\n include mime.types;\n default_type application/octet-stream;\n sendfile on;\n access_log off;\n"
        . " client_body_temp_path $work/prefix/body; fastcgi_temp_path $work/prefix/fcgi; proxy_temp_path $work/prefix/proxy; uwsgi_temp_path $work/prefix/uwsgi; scgi_temp_path $work/prefix/scgi;\n"
        . $nginxConf . "\n}\n");
    $procs[] = $nginxProc = proc_open([$nginx, '-p', "$work/prefix", '-c', "$work/nginx/nginx.conf"], [1 => ['file', '/dev/null', 'w'], 2 => ['file', "$work/run/nginx.stderr", 'w']], $p2, $root);
    $up = false;
    for ($i = 0; $i < 80 && !$up; $i++) {
        $up = file_exists("$work/run/api.sock") && file_exists("$work/run/stream.sock") && @fsockopen('127.0.0.1', $port, $en, $es, 0.2) !== false;
        if (!$up) usleep(100000);
    }
    assert($up, 'nginx + php-fpm did not start: ' . @file_get_contents("$work/run/nginx.stderr") . @file_get_contents("$work/run/nginx-error.log") . @file_get_contents("$work/run/fpm.log"));

    // 5. The web app is served by nginx, with exactly one set of security headers
    [$code, $h, $body] = st_http($port, 'GET', '/');
    assert($code === 200 && str_contains($body, '<html') && str_contains($h['content-type'][0], 'text/html'), "index served (got $code)");
    assert(count($h['content-security-policy'] ?? []) === 1 && ($h['x-frame-options'][0] ?? '') === 'DENY', 'one CSP and X-Frame-Options on the app shell');
    assert(($h['cache-control'][0] ?? '') === 'no-cache', 'the shell is revalidated');
    assert(!isset($h['x-powered-by']) && !str_contains($h['server'][0] ?? '', '/'), 'no version banners');
    [$code, $h] = st_http($port, 'GET', '/js/main.js', ['Accept-Encoding' => 'gzip']);
    assert($code === 200 && ($h['content-encoding'][0] ?? '') === 'gzip' && isset($h['etag']), 'scripts are gzipped and carry an ETag');
    [$code, $h] = st_http($port, 'GET', '/js/main.js', ['If-None-Match' => $h['etag'][0]]);
    assert($code === 304, 'revalidation costs a 304');
    [$code] = st_http($port, 'GET', '/.env');
    assert($code === 403 || $code === 404, 'dotfiles are not served');
    [$code, , $body] = st_http($port, 'GET', '/nothing-here');
    assert($code === 404, 'unknown paths fall through to the PHP 404');

    // 6. The API runs in PHP-FPM: real client address, JSON errors without traces, body limits
    [$code, $h, $body] = st_http($port, 'GET', '/api/health');
    $json = json_decode($body, true);
    assert($code === 200 && is_array($json), "health through PHP-FPM (got $code: $body)");
    assert(count($h['content-security-policy'] ?? []) === 1, 'API responses carry one CSP (PHP adds it, nginx does not duplicate)');
    [$code] = st_http($port, 'POST', '/api/login', ['Content-Type' => 'application/json'], str_repeat('a', 2 * 1024 * 1024));
    assert($code === 413, "a 2 MB body to an ordinary endpoint is refused by nginx (got $code)");
    [$code, , $body] = st_http($port, 'GET', '/api/party/stream');
    assert($code === 401 || $code === 403 || $code === 400, "the SSE route answers from the stream pool (got $code)");
    echo "✓ nginx serves the app and routes the API to PHP-FPM\n";

    // 7. Artwork and media confinement
    file_put_contents("$lib/Anime/stack/poster.jpg", "\xFF\xD8\xFF\xE0fakejpeg"); chmod("$lib/Anime/stack/poster.jpg", 0644);
    [$code, $h, $body] = st_http($port, 'GET', '/library/Anime/stack/poster.jpg');
    assert($code === 200 && str_starts_with($body, "\xFF\xD8\xFF"), 'artwork is served by nginx');
    [$code] = st_http($port, 'GET', '/library/Anime/stack/ep1.mp4');
    assert($code === 403, "videos are never downloadable from /library (got $code)");
    [$code] = st_http($port, 'GET', '/library/%2e%2e/%2e%2e/etc/passwd');
    assert(in_array($code, [400, 403, 404], true), "no traversal out of the library (got $code)");
    [$code] = st_http($port, 'GET', '/_media/Anime/stack/ep1.mp4');
    assert($code === 404, '/_media/ is internal: a client cannot reach it directly');
    echo "✓ Library confinement OK\n";

    // 8. Video: PHP authorizes, nginx sends the bytes (ranges, MKV direct play)
    $a = "stk_a_$suffix"; $b = "stk_b_$suffix";
    [$code] = st_http($port, 'GET', "/api/stream/$a", ['Range' => 'bytes=0-99']);
    assert($code === 401 || $code === 403, "no token, no video (got $code)");
    $auth = ['Authorization' => "Bearer $token"];
    $bytes = file_get_contents($mp4);
    [$code, $h, $body] = st_http($port, 'GET', "/api/stream/$a", $auth + ['Range' => 'bytes=10-109']);
    assert($code === 206 && $body === substr($bytes, 10, 100), "range served (got $code, " . strlen($body) . ' bytes)');
    assert(($h['content-range'][0] ?? '') === 'bytes 10-109/' . strlen($bytes), 'Content-Range is right');
    assert(isset($h['last-modified']) && !isset($h['x-accel-redirect']), 'the bytes came from nginx (static handler), not from PHP');
    [$code, $h, $body] = st_http($port, 'GET', "/api/stream/$a", $auth);
    assert($code === 200 && $body === $bytes && $h['content-type'][0] === 'video/mp4', 'whole file without a Range header');
    [$code, $h, $body] = st_http($port, 'GET', "/api/stream/$b?direct=1", $auth + ['Range' => 'bytes=0-49']);
    assert($code === 206 && strlen($body) === 50 && ($h['content-type'][0] ?? '') === 'video/x-matroska', "an MKV is sent as-is with ?direct=1 (got $code " . ($h['content-type'][0] ?? '') . ')');
    [$code, $h] = st_http($port, 'HEAD', "/api/stream/$a", $auth);
    assert($code === 200 && (int)($h['content-length'][0] ?? 0) === strlen($bytes), 'HEAD reports the size');
    [$code, $h, $tbody] = st_http($port, "GET", "/api/stream/$a?transcode=1", $auth);
    assert($code === 200 && ($h['accept-ranges'][0] ?? '') === 'none', "transcode got $code " . json_encode($h) . ' ' . substr($tbody, 0, 200) . ' a forced transcode is a live ffmpeg stream through the stream pool');
    echo "✓ Direct play via X-Accel-Redirect and live remux OK\n";
} finally {
    foreach (array_reverse($procs) as $p) {
        if (is_resource($p)) { proc_terminate($p, 15); }
    }
    usleep(300000);
    foreach ($procs as $p) {
        if (is_resource($p)) { @proc_terminate($p, 9); @proc_close($p); }
    }
    if (isset($db, $showId)) {
        $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $showId]);
        DbHelper::deleteShow($showId);
    }
    if (isset($user)) {
        $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $user]);
        $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $user]);
    }
    st_rm($work);
}
echo "All deployment tests passed.\n";
