<?php
/**
 * Unified Test Runner for KuraStream PHP/MySQL Backend
 */

// Registered test suites list
$tests = [
    'test_aria2_platform.php',
    'test_auto_skip_db.php',
    'test_cinematic_pack.php',
    'test_comments_api.php',
    'test_cookie_auth.php',
    'test_episode_integrity_and_streaming.php',
    'test_ffmpeg_scanner.php',
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
$total = count($testFiles);
$phpBin = PHP_BINARY ?: 'php';
$phpExtDir = dirname($phpBin) . DIRECTORY_SEPARATOR . 'ext';
$phpExtensionArgs = is_dir($phpExtDir)
    ? ' -d ' . escapeshellarg("extension_dir={$phpExtDir}")
        . ' -d extension=pdo_mysql -d extension=curl -d extension=mbstring -d extension=fileinfo'
    : '';

foreach ($testFiles as $idx => $file) {
    $name = basename($file);
    $num = $idx + 1;
    echo "[$num/$total] Running $name... ";

    $cmd = escapeshellarg($phpBin) . $phpExtensionArgs . ' ' . escapeshellarg($file);
    $output = [];
    $returnCode = 0;
    exec($cmd . ' 2>&1', $output, $returnCode);

    if ($returnCode === 0) {
        echo "PASS ✓\n";
        $passed++;
    } else {
        echo "FAIL ✗ (Exit code: $returnCode)\n";
        echo "----------------- Failure Output -----------------\n";
        echo implode("\n", $output) . "\n";
        echo "--------------------------------------------------\n";
        $failed++;
    }
}

echo "\n=====================================================\n";
echo "Test Results: $passed Passed, $failed Failed, $total Total\n";
echo "=====================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
