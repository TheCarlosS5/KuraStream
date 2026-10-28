<?php
// Library rooted in a temp dir for the HTTP part (the child server reads MEDIA_LIBRARY_PATH).
$lib = sys_get_temp_dir() . '/kura_pe_' . getmypid();
foreach (["$lib/Anime/s1", "$lib/Movies/m1"] as $d) mkdir($d, 0777, true);
$jpeg = base64_decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=');
file_put_contents("$lib/Anime/s1/poster.jpg", $jpeg);
file_put_contents("$lib/Anime/s1/notes.txt", 'private notes');
file_put_contents("$lib/Anime/s1/subs.srt", "1\n00:00:01,000 --> 00:00:02,000\nhi\n");
file_put_contents("$lib/Anime/s1/x.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
file_put_contents("$lib/Anime/s1/video.mkv", str_repeat('M', 512));
$clip = '';
for ($i = 0; $i < 1000; $i++) $clip .= chr(65 + ($i % 26));           // 1000 recognisable bytes
file_put_contents("$lib/Anime/s1/loop_abc.mp4", $clip);
file_put_contents("$lib/Movies/m1/loop_one.webm", $clip);
file_put_contents("$lib/Anime/s1/loop_bad.mkv", $clip);
file_put_contents("$lib/loop_root.mp4", $clip);
putenv('MEDIA_LIBRARY_PATH=' . $lib);

define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/controllers/CalendarController.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running public exposure tests (comments, catalog access, calendar, /library)...\n";

function pe_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}
function pe_rm(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (array_diff(scandir($p), ['.', '..']) as $e) pe_rm("$p/$e");
    @rmdir($p);
}

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$user = "pe_user_$suffix";
$showId = "pe_show_$suffix";
$origCatalog = getenv('CATALOG_ACCESS');
$calendarCache = sys_get_temp_dir() . '/kura_calendar_cache.json';
$calendarBackup = is_file($calendarCache) ? file_get_contents($calendarCache) : null;
$server = null;
$_SERVER['REMOTE_ADDR'] = '203.0.113.88';

try {
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    DbHelper::saveShow(['id' => $showId, 'title' => 'Exposure Show', 'rating' => 7.0, 'year' => 2024, 'age_rating' => 'PG-13', 'genres' => 'Action']);
    $token = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'exp' => time() + 3600]);

    // 1. Comments never carry the login name
    $posted = DbHelper::addComment($showId, $user, 'Perfil Visible', 'hola');
    assert(!array_key_exists('username', $posted) && $posted['profile_name'] === 'Perfil Visible', 'addComment output has no username');
    DbHelper::addComment($showId, $user, '', 'sin perfil');
    $list = DbHelper::getComments($showId);
    assert(count($list) === 2, 'both comments listed');
    foreach ($list as $c) {
        assert(!array_key_exists('username', $c), 'getComments must not expose the account (login) name');
        assert(($c['profile_name'] ?? '') !== '', 'every comment has a displayable profile name');
        assert(!str_contains(json_encode($c), $user), 'The login name must not appear anywhere in a comment');
    }
    assert(in_array('Usuario', array_column($list, 'profile_name'), true), 'A comment without a profile shows "Usuario"');
    echo "✓ Comments expose profile names, never login names OK\n";

    // 2. CATALOG_ACCESS: public by default, members-only on request
    putenv('CATALOG_ACCESS');
    unset($_SERVER['HTTP_AUTHORIZATION']);
    assert(pe_status(fn() => ShowController::getShows()) === 200, 'Guests can browse the catalog by default');
    putenv('CATALOG_ACCESS=members');
    $_GET = ['show_id' => $showId];
    $endpoints = [
        'shows' => fn() => ShowController::getShows(),
        'show details' => fn() => ShowController::getShowDetails($showId),
        'random show' => fn() => ShowController::getRandomShow(),
        'comments' => fn() => ShowController::getComments(),
        'episode details' => fn() => PlayerController::getEpisodeDetails('whatever'),
        'calendar' => fn() => CalendarController::getSchedule(),
    ];
    foreach ($endpoints as $name => $call) {
        assert(pe_status($call) === 401, "CATALOG_ACCESS=members: anonymous $name must be 401");
    }
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$token}";
    assert(pe_status($endpoints['shows']) === 200, 'A signed-in user still browses the catalog');
    assert(pe_status($endpoints['comments']) === 200, 'A signed-in user reads comments');
    unset($_SERVER['HTTP_AUTHORIZATION']);
    putenv('CATALOG_ACCESS=open');
    assert(pe_status($endpoints['shows']) === 200, 'Any value other than "members" keeps the catalog open');
    putenv('CATALOG_ACCESS');
    $_GET = [];
    echo "✓ CATALOG_ACCESS=members protects every catalog endpoint OK\n";

    // 3. Calendar: a forced refresh needs a session and is rate limited (it calls AniList)
    file_put_contents($calendarCache, json_encode(['Monday' => [['id' => 1, 'title' => 'Cached Show', 'media_id' => 1, 'time' => 0]], 'TBA' => []]));
    foreach (['calendar_force'] as $bucket) RateLimiter::clear("{$bucket}_203.0.113.88");
    for ($i = 0; $i < 3; $i++) RateLimiter::check('calendar_force_203.0.113.88', 3, 600);   // allowance already spent
    $_GET = ['force' => '1'];
    unset($_SERVER['HTTP_AUTHORIZATION']);
    assert(pe_status(fn() => CalendarController::getSchedule()) === 200, 'An anonymous ?force=1 is served from cache and never reaches AniList');
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$token}";
    assert(pe_status(fn() => CalendarController::getSchedule()) === 429, 'A signed-in forced refresh is rate limited per address');
    unset($_SERVER['HTTP_AUTHORIZATION']);
    $_GET = [];
    RateLimiter::clear('calendar_force_203.0.113.88');
    echo "✓ Calendar force needs a session and is rate limited OK\n";

    // 4. /library is an allow-list; ambient clips are served with Range support
    [$server, $port] = kura_start_server(['MEDIA_LIBRARY_PATH' => $lib]);
    [$code, $h] = kura_http($port, 'GET', '/library/Anime/s1/poster.jpg');
    assert($code === 200 && str_starts_with($h['content-type'] ?? '', 'image/jpeg'), "Artwork is served (got $code)");
    foreach (['notes.txt', 'subs.srt', 'x.svg', 'video.mkv', 'loop_bad.mkv'] as $blocked) {
        [$code] = kura_http($port, 'GET', "/library/Anime/s1/$blocked");
        assert($code === 403, "/library/Anime/s1/$blocked must not be downloadable (got $code)");
    }
    [$code] = kura_http($port, 'GET', '/library/Anime/%2E%2E/loop_root.mp4');
    assert($code === 403, "A .. segment must not reach a clip outside a show folder (got $code)");
    [$code] = kura_http($port, 'GET', '/library/Anime/s1/loop_missing.mp4');
    assert($code !== 200, 'A missing clip is not served');

    [$code, $h, , $body] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4');
    assert($code === 200 && $body === $clip && ($h['content-length'] ?? '') === '1000' && ($h['accept-ranges'] ?? '') === 'bytes' && ($h['content-type'] ?? '') === 'video/mp4', "Full clip (got $code, len " . strlen($body) . ')');
    [$code, $h, , $body] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4', null, null, "Range: bytes=0-99\r\n");
    assert($code === 206 && $body === substr($clip, 0, 100) && ($h['content-range'] ?? '') === 'bytes 0-99/1000' && ($h['content-length'] ?? '') === '100', "First 100 bytes (got $code {$h['content-range']})");
    [$code, $h, , $body] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4', null, null, "Range: bytes=900-\r\n");
    assert($code === 206 && $body === substr($clip, 900) && ($h['content-range'] ?? '') === 'bytes 900-999/1000', 'Open-ended range');
    [$code, $h, , $body] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4', null, null, "Range: bytes=-50\r\n");
    assert($code === 206 && $body === substr($clip, -50) && ($h['content-range'] ?? '') === 'bytes 950-999/1000', 'Suffix range');
    [$code, $h, , $body] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4', null, null, "Range: bytes=10-5000\r\n");
    assert($code === 206 && $body === substr($clip, 10) && ($h['content-range'] ?? '') === 'bytes 10-999/1000', 'End beyond the file is clamped');
    [$code, $h] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4', null, null, "Range: bytes=2000-\r\n");
    assert($code === 416 && ($h['content-range'] ?? '') === 'bytes */1000', "Unsatisfiable range -> 416 (got $code)");
    [$code, , , $body] = kura_http($port, 'GET', '/library/Anime/s1/loop_abc.mp4', null, null, "Range: bytes=abc\r\n");
    assert($code === 200 && $body === $clip, 'A malformed Range header is ignored (whole file)');
    [$code, $h, , $body] = kura_http($port, 'HEAD', '/library/Anime/s1/loop_abc.mp4');
    assert($code === 200 && $body === '' && ($h['content-length'] ?? '') === '1000', "HEAD has headers and no body (got $code)");
    [$code, $h] = kura_http($port, 'GET', '/library/Movies/m1/loop_one.webm');
    assert($code === 200 && ($h['content-type'] ?? '') === 'video/webm', 'WebM clips are served too');
    echo "✓ /library allow-list and Range-capable ambient clips OK\n";
} finally {
    kura_stop_server($server);
    if ($origCatalog !== false) putenv("CATALOG_ACCESS=$origCatalog"); else putenv('CATALOG_ACCESS');
    if ($calendarBackup !== null) file_put_contents($calendarCache, $calendarBackup); else @unlink($calendarCache);
    $db->prepare("DELETE FROM comments WHERE show_id = :s")->execute(['s' => $showId]);
    DbHelper::deleteShow($showId);
    $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $user]);
    $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $user]);
    RateLimiter::clear('calendar_force_203.0.113.88');
    pe_rm($lib);
}

echo "All public exposure tests passed.\n";
