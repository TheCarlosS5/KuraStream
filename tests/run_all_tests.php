<?php
/**
 * Unified Test Runner for KuraStream PHP/MySQL Backend
 */

$testFiles = glob(__DIR__ . '/test_*.php');
sort($testFiles);

echo "=====================================================\n";
echo "  KuraStream 2.0 Backend Test Suite (PHP 8.4 + MySQL)\n";
echo "=====================================================\n\n";

$passed = 0;
$failed = 0;
$total = count($testFiles);
$phpBin = PHP_BINARY ?: 'php';

foreach ($testFiles as $idx => $file) {
    $name = basename($file);
    $num = $idx + 1;
    echo "[$num/$total] Running $name... ";

    $cmd = escapeshellarg($phpBin) . ' ' . escapeshellarg($file);
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
