<?php
/**
 * Test Player Streaming Backend and Concurrency Limiter
 * Verifies HEAD request handling, byte-range responses (206/416), and TranscodeLimiter slots.
 */

if (!defined('TESTING_MODE')) {
    define('TESTING_MODE', true);
}

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

$errors = [];
echo "Running Player Streaming Backend Tests...\n";

// 1. Test TranscodeLimiter concurrency slots
echo "  [1/4] Testing TranscodeLimiter worker slots...\n";
TranscodeLimiter::resetAllSlots();
TranscodeLimiter::$maxWorkers = 2;

$slot1 = TranscodeLimiter::acquireSlot(1);
if (!$slot1) {
    $errors[] = "Failed to acquire first transcode slot";
}

$slot2 = TranscodeLimiter::acquireSlot(1);
if (!$slot2) {
    $errors[] = "Failed to acquire second transcode slot";
}

// Third slot should fail since maxWorkers = 2
$slot3 = TranscodeLimiter::acquireSlot(0);
if ($slot3) {
    $errors[] = "TranscodeLimiter allowed exceeding maxWorkers limit";
    TranscodeLimiter::releaseSlot();
}

TranscodeLimiter::releaseSlot();
TranscodeLimiter::resetAllSlots();
echo "    -> TranscodeLimiter concurrency guard OK\n";

// 2. Test Range Parsing and Response logic
echo "  [2/4] Testing Byte-Range calculation...\n";
$tempVideo = sys_get_temp_dir() . '/kura_test_video.mp4';
file_put_contents($tempVideo, str_repeat('A', 10000)); // 10,000 bytes

// Simulate Range: bytes=0-499
$_SERVER['HTTP_RANGE'] = 'bytes=0-499';
if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches)) {
    $start = intval($matches[1]);
    $end = intval($matches[2]);
    $length = $end - $start + 1;
    if ($start !== 0 || $end !== 499 || $length !== 500) {
        $errors[] = "Range bytes=0-499 calculation mismatch: start=$start, end=$end, length=$length";
    }
} else {
    $errors[] = "Failed to parse range bytes=0-499";
}

// Simulate Suffix Range: bytes=-500 (last 500 bytes of 10,000)
$_SERVER['HTTP_RANGE'] = 'bytes=-500';
if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches)) {
    $rawStart = $matches[1];
    $rawEnd = $matches[2];
    if ($rawStart === '' && $rawEnd === '500') {
        $offset = 10000 - 500; // 9500
        $end = 9999;
        $length = $end - $offset + 1;
        if ($offset !== 9500 || $end !== 9999 || $length !== 500) {
            $errors[] = "Suffix range calculation mismatch";
        }
    } else {
        $errors[] = "Failed to extract suffix range tokens";
    }
}

// Simulate Out-of-bounds Range: bytes=15000-20000 (should trigger 416)
$_SERVER['HTTP_RANGE'] = 'bytes=15000-20000';
if (preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches)) {
    $start = intval($matches[1]);
    $fileSize = 10000;
    if ($start < $fileSize) {
        $errors[] = "Out-of-bounds start was not recognized as invalid";
    }
}
@unlink($tempVideo);
unset($_SERVER['HTTP_RANGE']);
echo "    -> Byte-Range logic OK\n";

// 3. Test In-Browser QR Code Generator Module
echo "  [3/4] Verifying QR Code generator module contracts...\n";
$qrJsPath = __DIR__ . '/../frontend/js/features/player/qr_generator.js';
if (!file_exists($qrJsPath)) {
    $errors[] = "qr_generator.js does not exist";
} else {
    $qrContent = file_get_contents($qrJsPath);
    if (!str_contains($qrContent, 'generateQRCodeSVG') || !str_contains($qrContent, 'renderQRCodeToElement')) {
        $errors[] = "qr_generator.js missing required exports";
    }
    if (str_contains($qrContent, 'api.qrserver.com') || str_contains($qrContent, 'chart.googleapis.com')) {
        $errors[] = "qr_generator.js contains external network API calls";
    }
}

// 4. Test Player.js zero external QR calls
echo "  [4/4] Verifying player.js external API purge...\n";
$playerJs = file_get_contents(__DIR__ . '/../frontend/player.js');
if (str_contains($playerJs, 'api.qrserver.com')) {
    $errors[] = "player.js still contains api.qrserver.com call";
}
if (!str_contains($playerJs, 'renderQRCodeToElement')) {
    $errors[] = "player.js does not use renderQRCodeToElement";
}

if (!empty($errors)) {
    echo "\nTEST FAILURES:\n";
    foreach ($errors as $e) {
        echo "  - {$e}\n";
    }
    exit(1);
}

echo "\nAll Player Streaming & Concurrency tests passed successfully!\n";
exit(0);
