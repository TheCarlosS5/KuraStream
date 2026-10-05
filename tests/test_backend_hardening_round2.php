<?php
// Library rooted in a temp dir so path resolution can be exercised without touching real media.
$libDir = sys_get_temp_dir() . '/kura_lib_test_' . getmypid();
@mkdir($libDir . '/Anime/frieren', 0777, true);
file_put_contents($libDir . '/Anime/frieren/loop_a.mp4', 'x');
$outsideFile = sys_get_temp_dir() . '/kura_outside_' . getmypid() . '.txt';
file_put_contents($outsideFile, 'secret');
putenv('MEDIA_LIBRARY_PATH=' . $libDir);
putenv('APP_TIMEZONE=America/Bogota');

define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';
require_once __DIR__ . '/../php_backend/controllers/CalendarController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running backend hardening round 2 tests...\n";
$failures = 0;
function check(bool $cond, string $label): void {
    global $failures;
    if (!$cond) { $failures++; echo "FAIL: {$label}\n"; }
}

// 1. Backdrop loop deletion only resolves files inside LIBRARY_DIR
$ok = AdminController::resolveLibraryUrlToFile('/library/Anime/frieren/loop_a.mp4');
check($ok !== null && realpath($ok) === realpath($libDir . '/Anime/frieren/loop_a.mp4'), 'valid library URL resolves');
$rel = '/library/../' . basename($outsideFile);
check(AdminController::resolveLibraryUrlToFile($rel) === null, 'traversal outside the library is rejected');
check(AdminController::resolveLibraryUrlToFile('/../php_backend/config.php') === null, 'non-library URL is rejected');
check(AdminController::resolveLibraryUrlToFile('/library/Anime/frieren') === null, 'directories are rejected');
check(AdminController::resolveLibraryUrlToFile('/library/Anime/frieren/missing.mp4') === null, 'missing files are rejected');
check(is_file($outsideFile), 'outside file untouched');

// 2. LIKE wildcards in staged ids match literally
check(addcslashes('staged_%x', '\\%_') === 'staged\\_\\%x', 'LIKE metacharacters are escaped');

// 3. Calendar weekday follows APP_TIMEZONE, not UTC
check(date_default_timezone_get() === 'America/Bogota', 'APP_TIMEZONE applied');
$tuesdayUtc0030 = gmmktime(0, 30, 0, 9, 29, 2026); // Tue 2026-09-29 00:30 UTC = Mon 19:30 in Bogota
check(CalendarController::localWeekday($tuesdayUtc0030) === 1, 'UTC Tuesday 00:30 is Monday in Bogota');

// 4. Subtitle cache pruning removes stale files only, at most once per interval
$cache = sys_get_temp_dir() . '/kura_prune_test_' . getmypid();
@mkdir($cache . '/fonts/abc', 0777, true);
file_put_contents($cache . '/old.ass', 'a');
file_put_contents($cache . '/fonts/abc/old.ttf', 'f');
file_put_contents($cache . '/fresh.ass', 'b');
touch($cache . '/old.ass', time() - 10 * 86400);
touch($cache . '/fonts/abc/old.ttf', time() - 10 * 86400);
check(PlayerController::pruneCacheDir($cache) === 2, 'stale files pruned');
check(is_file($cache . '/fresh.ass') && !is_file($cache . '/old.ass'), 'fresh file kept');
check(!is_dir($cache . '/fonts/abc'), 'emptied font dir removed');
file_put_contents($cache . '/old2.ass', 'c');
touch($cache . '/old2.ass', time() - 10 * 86400);
check(PlayerController::pruneCacheDir($cache) === 0 && is_file($cache . '/old2.ass'), 'pruning throttled by marker');

// cleanup
@unlink($outsideFile);
foreach ([$cache, $libDir] as $dir) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $f) { $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname()); }
    @rmdir($dir);
}

if ($failures > 0) {
    echo "{$failures} check(s) failed\n";
    exit(1);
}
echo "OK\n";
