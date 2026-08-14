<?php
define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';

echo "Running Security and API Fixes Tests...\n";

// 1. Test AuthMiddleware JWT Token Creation & Verification
$payload = [
    'username' => 'admin',
    'role' => 'admin',
    'exp' => time() + 3600
];
$token = AuthMiddleware::createToken($payload);
assert(!empty($token), "Token creation failed");

$verified = AuthMiddleware::verifyToken($token);
assert($verified !== null, "Token verification failed");
assert($verified['username'] === 'admin', "Token payload username mismatch");
assert($verified['role'] === 'admin', "Token payload role mismatch");
echo "✓ JWT Token Creation & Verification OK\n";

// 2. Test Tampered Token & Legacy Token Rejection
$tamperedToken = $token . "tampered";
$verifiedTampered = AuthMiddleware::verifyToken($tamperedToken);
assert($verifiedTampered === null, "Tampered token should be rejected");

$legacyBase64 = base64_encode(json_encode(['username' => 'admin', 'role' => 'admin']));
$verifiedLegacy = AuthMiddleware::verifyToken($legacyBase64);
assert($verifiedLegacy === null, "Legacy base64 unsigned token MUST be rejected");
echo "✓ Legacy & Tampered Token Rejection OK\n";

// 3. Test Expired Token Rejection
$expiredPayload = [
    'username' => 'user',
    'role' => 'user',
    'exp' => time() - 3600
];
$expiredToken = AuthMiddleware::createToken($expiredPayload);
$verifiedExpired = AuthMiddleware::verifyToken($expiredToken);
assert($verifiedExpired === null, "Expired token should be rejected");
echo "✓ Expired Token Rejection OK\n";

// 4. Test CORS Protection
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['HTTP_ORIGIN'] = 'http://malicious-website.com';
putenv('ALLOWED_ORIGINS=');
ob_start();
setCorsHeaders();
ob_get_clean();
$headers = headers_list();
$hasMaliciousCors = false;
foreach ($headers as $h) {
    if (stripos($h, 'Access-Control-Allow-Origin: http://malicious-website.com') !== false) {
        $hasMaliciousCors = true;
    }
}
assert(!$hasMaliciousCors, "Untrusted malicious origin MUST NOT be reflected by CORS");
echo "✓ CORS Safe Default Filtering OK\n";

// 5. Test Stream Path Traversal & Prefix Traversal Prevention
$_GET['filepath'] = '/etc/passwd';
$traversalCaught = false;
ob_start();
try {
    PlayerController::streamVideo();
} catch (ExitException $e) {
    $traversalCaught = ($e->statusCode === 403 || $e->statusCode === 404);
}
ob_get_clean();
assert($traversalCaught, "Arbitrary system path traversal (/etc/passwd) must return 403/404");

$_GET['filepath'] = rtrim(LIBRARY_DIR, '/\\') . '-private/secret.mp4';
$prefixTraversalCaught = false;
ob_start();
try {
    PlayerController::streamVideo();
} catch (ExitException $e) {
    $prefixTraversalCaught = ($e->statusCode === 403 || $e->statusCode === 404);
}
ob_get_clean();
assert($prefixTraversalCaught, "Prefix directory traversal (e.g. library-private) MUST return 403/404");

// 6. Test Valid Streaming within Library directory
$testVideoPath = LIBRARY_DIR . '/test_valid_video.mp4';
if (!is_dir(LIBRARY_DIR)) {
    @mkdir(LIBRARY_DIR, 0777, true);
}
file_put_contents($testVideoPath, "MOCK_VIDEO_BINARY_DATA_TEST_12345");

$_GET['filepath'] = $testVideoPath;
unset($_SERVER['HTTP_RANGE']);
$streamSuccess = false;
ob_start();
try {
    PlayerController::streamVideo();
} catch (ExitException $e) {
    $streamSuccess = ($e->statusCode === 200);
}
ob_get_clean();
assert($streamSuccess, "Valid video file within library directory must stream with 200 OK");

// Test Partial Range Stream
$_SERVER['HTTP_RANGE'] = 'bytes=0-10';
$rangeSuccess = false;
ob_start();
try {
    PlayerController::streamVideo();
} catch (ExitException $e) {
    $rangeSuccess = ($e->statusCode === 206);
}
ob_get_clean();
assert($rangeSuccess, "Valid video range must return 206 Partial Content");

// Test Invalid Range Stream
$_SERVER['HTTP_RANGE'] = 'bytes=99999-999999';
$invalidRangeCaught = false;
ob_start();
try {
    PlayerController::streamVideo();
} catch (ExitException $e) {
    $invalidRangeCaught = ($e->statusCode === 416);
}
ob_get_clean();
assert($invalidRangeCaught, "Out of bounds range must return 416 Requested Range Not Satisfiable");

if (file_exists($testVideoPath)) {
    @unlink($testVideoPath);
}
echo "✓ Path & Prefix Traversal Prevention and Range Streaming OK\n";

// 7. Test HistoryController Require Authentication
$_SERVER['HTTP_AUTHORIZATION'] = '';
$historyUnauth = false;
ob_start();
try {
    HistoryController::getHistory();
} catch (ExitException $e) {
    $historyUnauth = ($e->statusCode === 401);
}
ob_get_clean();
assert($historyUnauth, "Unauthenticated history request MUST return 401");
echo "✓ HistoryController Require Auth (401) OK\n";

// 8. Test AdminController Require Admin Role
$userPayload = [
    'username' => 'normal_user',
    'role' => 'user',
    'exp' => time() + 3600
];
$userToken = AuthMiddleware::createToken($userPayload);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$userToken}";

$adminDenied = false;
ob_start();
try {
    AuthMiddleware::requireAdmin();
} catch (ExitException $e) {
    $adminDenied = ($e->statusCode === 403);
}
ob_get_clean();
assert($adminDenied, "Normal user trying to access admin endpoint MUST return 403 Forbidden");
echo "✓ AdminController Require Admin Role (403) OK\n";

echo "\n🎉 ALL SECURITY, CORS, STREAMING, AND API TESTS PASSED 100%!\n";
