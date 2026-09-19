<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/TorrentDownloader.php';

echo "Running TorrentDownloader Platform Compatibility Tests...\n";

// 1. Probar resolución del ejecutable aria2c
$path = TorrentDownloader::getAria2Path();
assert(!empty($path), "getAria2Path() returned an empty string");

if (PHP_OS_FAMILY === 'Windows') {
    assert(str_ends_with(strtolower($path), '.exe') || file_exists($path . '.exe') || file_exists($path), 
        "On Windows, candidate path should consider .exe extensions");
}

// 2. Probar isProcessAlive con PID actual
$myPid = getmypid();
$alive = TorrentDownloader::isProcessAlive($myPid);
assert($alive === true, "isProcessAlive must detect the current running process ($myPid)");

// PID ficticio
$dead = TorrentDownloader::isProcessAlive(9999999);
assert($dead === false, "isProcessAlive must return false for nonexistent PID");

echo "✓ TorrentDownloader Platform Compatibility Tests Passed\n";
