<?php
// Library rooted in a temp dir so deletions can be exercised without touching real media.
$lib = sys_get_temp_dir() . '/kura_lp_' . getmypid();
$outside = sys_get_temp_dir() . '/kura_lp_outside_' . getmypid();
foreach (["$lib/Anime/showA", "$lib/Anime/showB", "$lib/Movies/m1", $outside] as $d) {
    mkdir($d, 0777, true);
}
file_put_contents("$lib/Anime/showA/ep1.mkv", 'a');
file_put_contents("$lib/Anime/showB/ep1.mkv", 'b');
file_put_contents("$lib/Movies/m1/movie.mp4", 'm');
file_put_contents("$outside/precious.txt", 'keep me');
putenv('MEDIA_LIBRARY_PATH=' . $lib);

define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/services/LibraryPaths.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';

echo "Running library path / show deletion security tests...\n";

function rmTree(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (array_diff(scandir($p), ['.', '..']) as $e) rmTree("$p/$e");
    @rmdir($p);
}
function status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}

try {
    // 1. LibraryPaths::isSafeSegment
    foreach (['.', '..', '', '../Movies', 'a/b', 'a\\b', "a\0b", "a\nb", '/etc', str_repeat('x', 256)] as $bad) {
        assert(LibraryPaths::isSafeSegment($bad) === false, 'Unsafe segment must be rejected: ' . json_encode($bad));
    }
    foreach (['naruto', 'Re:Zero', 'Show Name (2024)', '...', 'ñandú-1', 'frieren_2'] as $good) {
        assert(LibraryPaths::isSafeSegment($good) === true, "Safe segment must be accepted: $good");
    }
    assert(LibraryPaths::showDir('anime', '..') === null && LibraryPaths::showDir('movie', '.') === null, 'showDir must refuse traversal ids');
    echo "✓ LibraryPaths::isSafeSegment OK\n";

    // 2. Deleting with dangerous ids is refused and nothing is removed
    $adminToken = AuthMiddleware::createToken(['username' => 'admin', 'role' => 'admin', 'exp' => time() + 3600]);
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$adminToken}";
    foreach (['.', '..', '../Movies', 'Anime/showA', '', "x\0y"] as $evil) {
        $code = status(fn() => ShowController::deleteShow($evil));
        assert($code === 400, 'deleteShow(' . json_encode($evil) . ') must answer 400, got ' . var_export($code, true));
    }
    assert(file_exists("$lib/Anime/showA/ep1.mkv") && file_exists("$lib/Anime/showB/ep1.mkv") && file_exists("$lib/Movies/m1/movie.mp4"),
        'Dangerous delete ids must not remove any media');
    echo "✓ deleteShow refuses ., .., traversal and separators OK\n";

    // 3. Unknown show: success response, filesystem untouched (never fuzzy-resolved)
    $code = status(fn() => ShowController::deleteShow('no_such_show'));
    assert($code === 200, 'Deleting an unknown show keeps the 200 success response');
    assert(file_exists("$lib/Anime/showB/ep1.mkv"), 'Unknown show delete must not touch other media');
    echo "✓ deleteShow on an unknown id changes nothing OK\n";

    // 4. Symlinks are never followed
    symlink($outside, "$lib/Anime/linked");
    DbHelper::saveShow(['id' => 'linked', 'title' => 'Linked', 'media_type' => 'anime']);
    $code = status(fn() => ShowController::deleteShow('linked'));
    assert($code === 200, 'Deleting a show whose folder is a symlink must succeed');
    assert(!file_exists("$lib/Anime/linked") && !is_link("$lib/Anime/linked"), 'The symlink itself must be removed');
    assert(file_exists("$outside/precious.txt"), 'The symlink TARGET must never be deleted');

    mkdir("$lib/Anime/nested/sub", 0777, true);
    file_put_contents("$lib/Anime/nested/sub/ep.mkv", 'n');
    symlink($outside, "$lib/Anime/nested/escape");
    DbHelper::saveShow(['id' => 'nested', 'title' => 'Nested', 'media_type' => 'anime']);
    $code = status(fn() => ShowController::deleteShow('nested'));
    assert($code === 200, 'Deleting a show containing a symlink must succeed');
    assert(!is_dir("$lib/Anime/nested"), 'The show folder must be removed');
    assert(file_exists("$outside/precious.txt"), 'A symlink inside the show must not make deletion leave the library');
    echo "✓ deleteShow never follows symlinks OK\n";

    // 5. Normal deletion removes only that show
    DbHelper::saveShow(['id' => 'showA', 'title' => 'Show A', 'media_type' => 'anime']);
    $code = status(fn() => ShowController::deleteShow('showA'));
    assert($code === 200, 'Normal delete must succeed');
    assert(!is_dir("$lib/Anime/showA"), 'showA folder removed');
    assert(is_dir("$lib/Anime/showB") && is_dir("$lib/Movies/m1"), 'Sibling shows and movies must be kept');
    assert(DbHelper::getShow('showA') === null, 'showA must be removed from the catalog');
    echo "✓ deleteShow removes only the selected show OK\n";

    // 6. Admin upload / scrape handlers refuse traversal ids
    foreach (['uploadShowMedia' => ['showId' => '../../escaped', 'poster' => 1], 'uploadShowLoop' => ['showId' => '..']] as $fn => $post) {
        $_POST = ['showId' => $post['showId']];
        $_FILES = $fn === 'uploadShowMedia' ? [] : ['video' => ['error' => UPLOAD_ERR_OK, 'size' => 1, 'name' => 'x.mp4', 'tmp_name' => __FILE__, 'type' => 'video/mp4']];
        $code = status(fn() => AdminController::$fn());
        assert($code === 400, "$fn must refuse a traversal showId (got " . var_export($code, true) . ')');
    }
    assert(!file_exists(dirname($lib) . '/escaped'), 'No directory may be created outside the library');
    $_POST = [];
    $_FILES = [];
    echo "✓ Admin upload handlers refuse traversal show ids OK\n";

    // 7. Import by server path no longer accepts files from the system temp directory
    $tmpFile = sys_get_temp_dir() . '/kura_lp_source_' . getmypid() . '.mp4';
    file_put_contents($tmpFile, str_repeat('v', 2048));
    $_POST = ['title' => 'Temp Source Show', 'sourcePath' => $tmpFile];
    $code = status(fn() => AdminController::handleImportUpload());
    assert($code === 403, 'sourcePath inside the temp directory must be refused (got ' . var_export($code, true) . ')');
    @unlink($tmpFile);
    $_POST = [];
    echo "✓ Import sourcePath outside library/downloads/staging refused OK\n";

    // 8. End-to-end through the router: encoded dot segments must not reach the filesystem
    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int)substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
    fclose($sock);
    // ADMIN_USER makes the token's "admin" the environment administrator (the server validates sessions against the database).
    $env = array_merge(getenv(), ['JWT_SECRET' => JWT_SECRET, 'MEDIA_LIBRARY_PATH' => $lib, 'ADMIN_USER' => 'admin', 'PHP_CLI_SERVER_WORKERS' => '2']);
    $server = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/../php_backend/router.php'],
        [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, __DIR__ . '/..', $env);
    assert(is_resource($server), 'Could not start the PHP built-in server');
    try {
        $up = false;
        for ($i = 0; $i < 50 && !$up; $i++) {
            $up = @fsockopen('127.0.0.1', $port, $en, $es, 0.2) !== false;
            if (!$up) usleep(100000);
        }
        assert($up, 'Built-in server did not start');
        $call = function (string $path) use ($port, $adminToken): int {
            $ctx = stream_context_create(['http' => ['method' => 'DELETE', 'ignore_errors' => true, 'timeout' => 10,
                'header' => "Authorization: Bearer {$adminToken}\r\n"]]);
            @file_get_contents("http://127.0.0.1:$port$path", false, $ctx);
            preg_match('#HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m);
            return (int)($m[1] ?? 0);
        };
        foreach (['/api/shows/%2E', '/api/shows/%2E%2E', '/api/shows/..%2FMovies', '/api/shows/%2E%2E%2FAnime'] as $path) {
            $http = $call($path);
            assert($http === 400, "DELETE $path must answer 400, got $http");
        }
        assert(is_dir("$lib/Anime/showB") && is_dir("$lib/Movies/m1"), 'Router-level traversal must not delete any media');
        echo "✓ DELETE /api/shows/%2E and friends answer 400 through the real router OK\n";
    } finally {
        proc_terminate($server);
        proc_close($server);
    }
} finally {
    DbHelper::deleteShow('linked');
    DbHelper::deleteShow('nested');
    DbHelper::deleteShow('showA');
    unset($_SERVER['HTTP_AUTHORIZATION']);
    rmTree($lib);
    rmTree($outside);
}

echo "All library path security tests passed.\n";
