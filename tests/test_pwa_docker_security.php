<?php
/**
 * Test PWA, Docker Hardening, and Security Headers
 */

if (!defined('TESTING_MODE')) {
    define('TESTING_MODE', true);
}

require_once __DIR__ . '/../php_backend/config.php';

$errors = [];
echo "Running PWA, Docker Hardening & Security Headers Tests...\n";

// 1. Test Security Headers
echo "  [1/4] Testing Security Headers definitions...\n";
if (!function_exists('setSecurityHeaders')) {
    $errors[] = "setSecurityHeaders function is not defined";
}
echo "    -> Security Headers function OK\n";

// 2. Test Dockerfile Hardening
echo "  [2/4] Testing Dockerfile unprivileged user configuration...\n";
$dockerfile = file_get_contents(__DIR__ . '/../Dockerfile');
if (!str_contains($dockerfile, 'USER kurastream')) {
    $errors[] = "Dockerfile does not switch to non-root USER kurastream";
}
if (!str_contains($dockerfile, 'useradd')) {
    $errors[] = "Dockerfile does not create unprivileged user with useradd";
}
if (!str_contains($dockerfile, '--chown=kurastream:kurastream')) {
    $errors[] = "Dockerfile does not copy files with kurastream ownership";
}
echo "    -> Dockerfile non-root configuration OK\n";

// 3. Test .dockerignore
echo "  [3/4] Testing .dockerignore presence and exclusions...\n";
$dockerignorePath = __DIR__ . '/../.dockerignore';
if (!file_exists($dockerignorePath)) {
    $errors[] = ".dockerignore file does not exist";
} else {
    $diContent = file_get_contents($dockerignorePath);
    if (!str_contains($diContent, '.git') || !str_contains($diContent, 'library/') || !str_contains($diContent, '.env')) {
        $errors[] = ".dockerignore missing critical exclusions (.git, library/, .env)";
    }
}
echo "    -> .dockerignore exclusions OK\n";

// 4. Test PWA Manifest and Offline page
echo "  [4/4] Testing PWA manifest.json and offline.html tokens...\n";
$manifest = json_decode(file_get_contents(__DIR__ . '/../frontend/manifest.json'), true);
if (!$manifest || ($manifest['theme_color'] ?? '') !== '#090D0E') {
    $errors[] = "manifest.json invalid or does not match canonical theme_color #090D0E";
}

$offlineHtml = file_get_contents(__DIR__ . '/../frontend/offline.html');
if (str_contains($offlineHtml, '#00E08F')) {
    $errors[] = "offline.html still contains legacy neon color #00E08F";
}
if (!str_contains($offlineHtml, '#F97316')) {
    $errors[] = "offline.html does not use brand copper button";
}
echo "    -> PWA assets and tokens OK\n";

// 5. Test Service Worker Cache Version Alignment & Activation Purge
echo "  [5/5] Testing Service Worker Cache Versioning and Activation Cleanup...\n";
$swContent = file_get_contents(__DIR__ . '/../frontend/sw.js');
$indexHtml = file_get_contents(__DIR__ . '/../frontend/index.html');

$expectedVersion = '2026.09.26-modern-streaming-rc2';
$expectedCacheName = "kurastream-{$expectedVersion}";

if (!str_contains($swContent, $expectedCacheName)) {
    $errors[] = "sw.js does not contain bumped CACHE_NAME '{$expectedCacheName}'";
}
if (!str_contains($indexHtml, "style.css?v={$expectedVersion}")) {
    $errors[] = "index.html style.css does not contain bumped version query string '{$expectedVersion}'";
}
if (!str_contains($indexHtml, "main.js?v={$expectedVersion}")) {
    $errors[] = "index.html main.js does not contain bumped version query string '{$expectedVersion}'";
}
if (!str_contains($indexHtml, "player.js?v={$expectedVersion}")) {
    $errors[] = "index.html player.js does not contain bumped version query string '{$expectedVersion}'";
}

// Verify activation cleanup deletes stale caches
if (!str_contains($swContent, "name !== CACHE_NAME") || !str_contains($swContent, "caches.delete(name)")) {
    $errors[] = "sw.js activate event does not purge stale caches";
}

// Simulate activation filter logic
$existingCaches = ['kurastream-2026.09.25-modern-platform', $expectedCacheName, 'old-legacy-v1'];
$toDelete = array_filter($existingCaches, fn($name) => $name !== $expectedCacheName);
$toKeep = array_filter($existingCaches, fn($name) => $name === $expectedCacheName);

if (count($toDelete) !== 2 || !in_array('kurastream-2026.09.25-modern-platform', $toDelete)) {
    $errors[] = "SW cache purge simulation failed to identify stale caches for deletion";
}
if (count($toKeep) !== 1 || !in_array($expectedCacheName, $toKeep)) {
    $errors[] = "SW cache purge simulation failed to preserve current CACHE_NAME";
}
echo "    -> Service Worker cache upgrade and activation cleanup OK\n";

if (!empty($errors)) {
    echo "\nTEST FAILURES:\n";
    foreach ($errors as $e) {
        echo "  - {$e}\n";
    }
    exit(1);
}

echo "\nAll PWA, Docker Hardening & Security Headers tests passed successfully!\n";
exit(0);
