<?php
define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/services/FfmpegScanner.php';

echo "Running FFmpeg Scanner Tests...\n";

// Replacing parseFrameRate() with honest values without inventing defaults
assert(FfmpegScanner::parseFrameRate('24000/1001') === 23.976, '24000/1001 should parse to 23.976 fps');
assert(FfmpegScanner::parseFrameRate('24/1') === 24.0, '24/1 should parse to 24 fps');
assert(FfmpegScanner::parseFrameRate('60/1') === 60.0, '60/1 should parse to 60 fps');
assert(FfmpegScanner::parseFrameRate('30000/1001') === 29.97, '30000/1001 should parse to 29.97 fps');

// Honest zero/null handling - never invent 24.0 fps
assert(FfmpegScanner::parseFrameRate('') === 0.0, 'Missing frame rate must return 0.0 fps');
assert(FfmpegScanner::parseFrameRate(null) === 0.0, 'Null frame rate must return 0.0 fps');
assert(FfmpegScanner::parseFrameRate('24/0') === 0.0, 'Zero denominator must return 0.0 fps');
assert(FfmpegScanner::parseFrameRate('0/1') === 0.0, 'Zero frame rate must return 0.0 fps');
assert(FfmpegScanner::parseFrameRate('0.0001/1') === 0.0, 'Frame rates rounded to zero must return 0.0 fps');
assert(FfmpegScanner::parseFrameRate('-24/1') === 0.0, 'Non-positive frame rate must return 0.0 fps');
assert(FfmpegScanner::parseFrameRate('not-a-rate') === 0.0, 'Invalid frame rate must return 0.0 fps');

echo "✓ Frame-rate parsing preserves valid fps and honestly returns 0.0 on invalid input\n";
