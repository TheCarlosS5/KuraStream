<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/AppDownloadController.php';

echo "Running Android App Download Tests...\n";

function callInfo(): array {
    ob_start();
    try {
        AppDownloadController::info();
    } catch (ExitException $e) {
        ob_end_clean();
        return [$e->statusCode, json_decode($e->getMessage(), true) ?: $e->data];
    }
    ob_end_clean();
    throw new RuntimeException('info() must respond');
}

$apk = tempnam(sys_get_temp_dir(), 'kura_apk_');
file_put_contents($apk, str_repeat('A', 1234));
putenv('ANDROID_APK_PATH=' . $apk);

[$status, $data] = callInfo();
assert($status === 200, 'Info must answer 200');
assert($data['available'] === true, 'APK present must be reported as available');
assert($data['size_bytes'] === 1234, 'Size must match the APK on disk');
assert($data['download_url'] === '/api/app/android/download', 'Download URL must stay under /api/ (service worker bypass)');
assert(array_key_exists('version', $data), 'Version key must be present');

unlink($apk);
[$status, $data] = callInfo();
assert($status === 200 && $data['available'] === false, 'Missing APK must be reported as unavailable, not an error');
assert(!isset($data['download_url']), 'No download URL when the APK is missing');

putenv('ANDROID_APK_PATH');
echo "✓ Android app download tests passed\n";
