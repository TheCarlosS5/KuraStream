<?php
define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/services/FfmpegScanner.php';

echo "Running FFmpeg Scanner Tests...\n";

// Replacing parseFrameRate() with a hard-coded value would break these cases.
assert(FfmpegScanner::parseFrameRate('24000/1001') === 23.976, '24000/1001 should parse to 23.976 fps');
assert(FfmpegScanner::parseFrameRate('24/1') === 24.0, '24/1 should parse to 24 fps');
assert(FfmpegScanner::parseFrameRate('') === 24.0, 'Missing frame rate should default to 24 fps');
assert(FfmpegScanner::parseFrameRate('24/0') === 24.0, 'Zero denominator should default to 24 fps');
assert(FfmpegScanner::parseFrameRate('0/1') === 24.0, 'Zero frame rate should default to 24 fps');
assert(FfmpegScanner::parseFrameRate('0.0001/1') === 24.0, 'Frame rates rounded to zero should default to 24 fps');
assert(FfmpegScanner::parseFrameRate('-24/1') === 24.0, 'Non-positive frame rate should default to 24 fps');
assert(FfmpegScanner::parseFrameRate('not-a-rate') === 24.0, 'Invalid frame rate should default to 24 fps');

echo "✓ Frame-rate parsing preserves valid fps and safely defaults invalid input\n";
