<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/AppDownloadController.php';
require_once __DIR__ . '/helpers/http_server.php';

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

// The checksum is of the file actually on disk, never taken from the metadata file
assert($data['sha256'] === hash('sha256', str_repeat('A', 1234)), 'sha256 must be the hash of the served APK');

// Release metadata written by the build (scripts/generate_app_release.mjs) is used for version/notes/variant only
$metaFile = tempnam(sys_get_temp_dir(), 'kura_rel_');
putenv('ANDROID_APP_RELEASE_JSON=' . $metaFile);
file_put_contents($metaFile, json_encode([
    'version_name' => '9.8.7', 'version_code' => 42, 'variant' => 'release',
    'notes' => '<b>Novedades</b> <script>alert(1)</script>',
    'sha256' => str_repeat('0', 64), // a stale/forged value must be ignored
    'download_url' => 'https://evil.example/app.apk',
]));
[$status, $data] = callInfo();
assert($data['version'] === '9.8.7' && $data['version_code'] === 42 && $data['variant'] === 'release', 'Version, code and variant come from the metadata');
assert(!str_contains($data['notes'], '<') && str_contains($data['notes'], 'Novedades'), 'Notes are stripped of markup');
assert($data['sha256'] === hash('sha256', str_repeat('A', 1234)), 'A sha256 in the metadata file must never override the real hash');
assert($data['download_url'] === '/api/app/android/download', 'Metadata cannot redirect the download');

// Invalid fields are ignored (the answer falls back to the Gradle script / null), never echoed back
$invalid = [
    ['version_name', ['version_name' => '1.0"; rm -rf /'], 'version', '1.0"; rm -rf /'],
    ['version_name', ['version_name' => str_repeat('1', 33)], 'version', str_repeat('1', 33)],
    ['version_code', ['version_code' => '5'], 'version_code', '5'],
    ['version_code', ['version_code' => -3], 'version_code', -3],
    ['variant', ['variant' => 'nightly'], 'variant', 'nightly'],
];
foreach ($invalid as [$field, $payload, $outKey, $forbidden]) {
    file_put_contents($metaFile, json_encode($payload));
    [, $data] = callInfo();
    assert($data[$outKey] !== $forbidden, "Invalid metadata field $field must be ignored (got " . json_encode($data[$outKey]) . ')');
}
file_put_contents($metaFile, '{not json');
[$status, $data] = callInfo();
assert($status === 200 && $data['available'] === true, 'A corrupt metadata file must not break the endpoint');

// A changed APK is re-hashed (cache is keyed on size and mtime)
file_put_contents($apk, str_repeat('B', 2000));
clearstatcache();
[, $data] = callInfo();
assert($data['sha256'] === hash('sha256', str_repeat('B', 2000)), 'A replaced APK gets its own hash');
@unlink($metaFile);
putenv('ANDROID_APP_RELEASE_JSON');

// The download itself carries the checksum too (checked through the real router)
[$server, $port] = kura_start_server(['ANDROID_APK_PATH' => $apk]);
try {
    foreach (['HEAD', 'GET'] as $method) {
        [$code, $h, , $body] = kura_http($port, $method, '/api/app/android/download');
        assert($code === 200, "$method download must answer 200 (got $code)");
        assert(($h['x-content-sha256'] ?? '') === hash('sha256', str_repeat('B', 2000)), "$method must send X-Content-SHA256 of the served file");
        if ($method === 'GET') assert($body === str_repeat('B', 2000), 'GET must send the APK bytes');
    }
} finally {
    kura_stop_server($server);
}

unlink($apk);
[$status, $data] = callInfo();
assert($status === 200 && $data['available'] === false, 'Missing APK must be reported as unavailable, not an error');
assert(!isset($data['download_url']), 'No download URL when the APK is missing');

putenv('ANDROID_APK_PATH');
echo "✓ Android app download tests passed\n";
