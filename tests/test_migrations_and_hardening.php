<?php
/**
 * Test DB Migrations, Filesystem Path Traversal, and Atomic RateLimiter
 */

if (!defined('TESTING_MODE')) {
    define('TESTING_MODE', true);
}

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/MigrationManager.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';

$errors = [];
echo "Running Migrations, Filesystem & RateLimiter Tests...\n";

// 1. Test Migration Files and Discovery
echo "  [1/3] Testing MigrationManager file discovery...\n";
$migrationFiles = MigrationManager::getMigrationFiles();

$expectedMigrations = [
    '001_initial_schema.sql',
    '002_foreign_keys_and_indexes.sql',
    '003_party_participants.sql'
];

foreach ($expectedMigrations as $exp) {
    if (!isset($migrationFiles[$exp])) {
        $errors[] = "Missing expected migration: {$exp}";
    } else {
        $sql = file_get_contents($migrationFiles[$exp]);
        if (empty(trim($sql))) {
            $errors[] = "Migration file {$exp} is empty";
        }
        if (!str_contains($sql, 'CREATE TABLE')) {
            $errors[] = "Migration file {$exp} does not contain CREATE TABLE";
        }
    }
}
echo "    -> Migrations discovery and structure OK\n";

// 2. Test Atomic RateLimiter
echo "  [2/3] Testing RateLimiter atomic check and windowing...\n";
$testKey = 'test_unit_' . uniqid();
RateLimiter::clear($testKey);

// Allow 3 attempts within 10 seconds
$pass1 = RateLimiter::check($testKey, 3, 10, $retryAfter);
$pass2 = RateLimiter::check($testKey, 3, 10, $retryAfter);
$pass3 = RateLimiter::check($testKey, 3, 10, $retryAfter);
$fail4 = RateLimiter::check($testKey, 3, 10, $retryAfter);

if (!$pass1 || !$pass2 || !$pass3) {
    $errors[] = "RateLimiter rejected requests within allowed limit";
}
if ($fail4) {
    $errors[] = "RateLimiter failed to block 4th request when max=3";
}
if ($retryAfter <= 0 || $retryAfter > 10) {
    $errors[] = "Invalid retryAfter value: {$retryAfter}";
}

RateLimiter::clear($testKey);
echo "    -> RateLimiter atomic enforcement OK\n";

// 3. Test Path Traversal Protection
echo "  [3/3] Testing AdminController path traversal verification...\n";
$validLibFile = LIBRARY_DIR . '/Anime/test.mp4';
// Create dummy file for realpath resolution
@mkdir(dirname($validLibFile), 0777, true);
@file_put_contents($validLibFile, 'dummy');

if (!AdminController::isPathWithinAllowedRoots($validLibFile)) {
    $errors[] = "Valid library path was incorrectly rejected";
}

$traversalPath = LIBRARY_DIR . '/../../../../windows/system32/cmd.exe';
if (AdminController::isPathWithinAllowedRoots($traversalPath)) {
    $errors[] = "Path traversal was incorrectly accepted";
}

@unlink($validLibFile);
echo "    -> Path traversal verification OK\n";

if (!empty($errors)) {
    echo "\nTEST FAILURES:\n";
    foreach ($errors as $e) {
        echo "  - {$e}\n";
    }
    exit(1);
}

echo "\nAll Migrations, Filesystem & RateLimiter tests passed successfully!\n";
exit(0);
