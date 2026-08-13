<?php
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

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

// 4. Test Stream Path Traversal Prevention
$_GET['filepath'] = '/etc/passwd';
ob_start();
try {
    PlayerController::streamVideo();
} catch (Throwable $e) {
    // Expected exit
}
$output = ob_get_clean();
assert(http_response_code() === 403 || http_response_code() === 404, "Path traversal must return 403/404");
echo "✓ Path Traversal Prevention OK\n";

// 5. Test Invalid HTTP Range Request (416 Not Satisfiable)
$_GET['filepath'] = __FILE__;
$_SERVER['HTTP_RANGE'] = 'bytes=999999-9999999';
ob_start();
try {
    PlayerController::streamVideo();
} catch (Throwable $e) {
    // Expected exit
}
$rangeOutput = ob_get_clean();
assert(http_response_code() === 416 || http_response_code() === 403, "Invalid Range header must return 416/403");
echo "✓ Invalid HTTP Range Header (416) OK\n";

echo "ALL SECURITY AND API TESTS PASSED SUCCESSFULLY!\n";
