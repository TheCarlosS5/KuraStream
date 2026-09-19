<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running Cookie Auth Tests...\n";

// 1. Verificar extracción de token desde $_COOKIE
$testPayload = ['username' => 'testuser', 'role' => 'user', 'exp' => time() + 3600];
$testToken = AuthMiddleware::createToken($testPayload);

$_COOKIE['kurastream_token'] = $testToken;
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_SERVER['Authorization']);

$extracted = AuthMiddleware::getBearerToken();
assert($extracted === $testToken, "AuthMiddleware did not extract token from \$_COOKIE['kurastream_token']");

$user = AuthMiddleware::requireAuth();
assert($user['username'] === 'testuser', "requireAuth failed to authenticate user via cookie");

// 2. Probar que si no hay cookie ni header, falla con 401
unset($_COOKIE['kurastream_token']);
$unauthCaught = false;
try {
    AuthMiddleware::requireAuth();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauthCaught = true;
    }
}
assert($unauthCaught, "requireAuth must throw 401 when neither cookie nor Authorization header is present");

// 3. Probar logout
$_COOKIE['kurastream_token'] = $testToken;
$logoutCaught = false;
try {
    AuthController::logout();
} catch (ExitException $e) {
    if ($e->statusCode === 200 && empty($_COOKIE['kurastream_token'])) {
        $logoutCaught = true;
    }
}
assert($logoutCaught, "logout must clear kurastream_token cookie and return 200");

echo "✓ Cookie Auth Tests Passed\n";
