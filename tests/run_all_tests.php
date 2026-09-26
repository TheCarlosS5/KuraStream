<?php
/**
 * Unified Test Runner for KuraStream PHP/MySQL Backend
 */

// Registered test suites list
$tests = [
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
    'test_rate_limiter.php',
    'test_security_and_api_fixes.php',
    'test_ui_assets.php',
    'test_upload_validation.php',
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
$requiredExts = ['pdo_mysql', 'curl', 'mbstring', 'fileinfo'];
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

    $cmd = escapeshellarg($phpBin) . $phpExtensionArgs . ' ' . escapeshellarg($file);
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
