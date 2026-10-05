<?php
/**
 * Unified Test Runner for KuraStream PHP/MySQL Backend
 */

// Registered test suites list
$tests = [
    'test_admin_auth_contract.php',
    'test_app_download.php',
    'test_continue_watching.php',
    'test_season_sync.php',
    'test_audio_intro.php',
    'test_calendar_airing_only.php',
    'test_audit_release_hardening.php',
    'test_auto_skip_db.php',
    'test_cinematic_pack.php',
    'test_comments_api.php',
    'test_cookie_auth.php',
    'test_episode_integrity_and_streaming.php',
    'test_ffmpeg_scanner.php',
    'test_health_endpoint.php',
    'test_no_torrent_artifacts.php',
    'test_secret_scanning.php',
    'test_history_isolation.php',
    'test_legacy_isolation.php',
    'test_library_scan_and_player_routes.php',
    'test_new_features_db.php',
    'test_party_security.php',
    'test_profile_pin_security.php',
    'test_progress_integrity.php',
    'test_rate_limiter.php',
    'test_security_and_api_fixes.php',
    'test_ui_assets.php',
    'test_upload_validation.php',
    'test_watch_party_host_impersonation.php',
    'test_migration_005_to_006.php',
    'test_party_kids_restriction.php',
    'test_party_profile_switch_security.php',
    'test_subtitle_offset.php',
    'test_backend_hardening_round2.php',
];

$testFiles = !empty($tests)
    ? array_map(fn($f) => __DIR__ . '/' . $f, $tests)
    : glob(__DIR__ . '/test_*.php');
// Include any additional discovered test_*.php files
foreach (glob(__DIR__ . '/test_*.php') as $found) {
    if (!in_array($found, $testFiles, true)) {
        $testFiles[] = $found;
    }
}
sort($testFiles);

echo "=====================================================\n";
echo "  KuraStream 2.0 Backend Test Suite (PHP 8.4 + MySQL)\n";
echo "=====================================================\n\n";

$passed = 0;
$failed = 0;
$skipped = 0;
$total = count($testFiles);
$phpBin = PHP_BINARY ?: 'php';
$phpExtDir = dirname($phpBin) . DIRECTORY_SEPARATOR . 'ext';
$requiredExts = ['pdo_mysql', 'curl', 'mbstring', 'fileinfo', 'pdo_sqlite'];
$missingExts = array_filter($requiredExts, fn($ext) => !extension_loaded($ext));
$phpExtensionArgs = '';
if (!empty($missingExts) && is_dir($phpExtDir)) {
    $phpExtensionArgs = ' -d ' . escapeshellarg("extension_dir={$phpExtDir}");
    foreach ($missingExts as $ext) {
        $phpExtensionArgs .= " -d extension={$ext}";
    }
}

$mysqlAvailable = false;
try {
    require_once __DIR__ . '/../php_backend/config.php';
    $dsn = "mysql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME;
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_TIMEOUT => 1,
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
    ]);
    // The suites create and delete users, profiles, shows and watch-party rooms. Running them against the
    // database the application serves would mix test data into (and could destroy) real data.
    if (!str_ends_with(DB_NAME, '_test') && getenv('KURA_ALLOW_NON_TEST_DB') !== '1') {
        fwrite(STDERR, "\nRefusing to run: the test suites write to the database \"" . DB_NAME . "\", which does not end in \"_test\".\n"
            . "Point them at a throwaway database instead, for example:\n"
            . "  mysql -e 'CREATE DATABASE kurastream_test' && DB_NAME=kurastream_test php tests/run_all_tests.php\n"
            . "(Set KURA_ALLOW_NON_TEST_DB=1 only if you really want to use this database.)\n");
        exit(2);
    }
    $mysqlAvailable = true;
    echo "MySQL Database: ONLINE (All integration tests enabled)\n";
    require_once __DIR__ . '/../php_backend/db.php';
    require_once __DIR__ . '/../php_backend/services/MigrationManager.php';
    Database::initializeSchema($pdo);
    MigrationManager::runPending();
    echo "Schema & Migrations: APPLIED ✓\n\n";
} catch (Throwable $e) {
    $mysqlAvailable = false;
    echo "MySQL Database: OFFLINE (DB-dependent integration tests will be skipped)\n\n";
}

foreach ($testFiles as $idx => $file) {
    $name = basename($file);
    $num = $idx + 1;
    echo "[$num/$total] Running $name... ";

    // The suites rely on assert(); production php.ini files disable it (zend.assertions=-1), which would
    // make every test pass without checking anything.
    $cmd = escapeshellarg($phpBin) . $phpExtensionArgs . ' -d zend.assertions=1 -d assert.exception=1 ' . escapeshellarg($file);
    $output = [];
    $returnCode = 0;
    exec($cmd . ' 2>&1', $output, $returnCode);
    $joinedOutput = implode("\n", $output);

    if ($returnCode === 0) {
        echo "PASS ✓\n";
        $passed++;
    } elseif (!$mysqlAvailable && (str_contains($joinedOutput, '2002') || str_contains($joinedOutput, 'actively refused') || str_contains($joinedOutput, 'Connection refused') || str_contains($joinedOutput, 'SQLSTATE[HY000]'))) {
        echo "SKIPPED ⚠ (MySQL offline)\n";
        $skipped++;
    } else {
        echo "FAIL ✗ (Exit code: $returnCode)\n";
        echo "----------------- Failure Output -----------------\n";
        echo $joinedOutput . "\n";
        echo "--------------------------------------------------\n";
        $failed++;
    }
}

echo "\n=====================================================\n";
echo "Test Results: $passed Passed, $skipped Skipped, $failed Failed, $total Total\n";
echo "=====================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
