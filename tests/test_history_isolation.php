<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running History and Favorites Isolation Tests...\n";

// 1. Simular un atacante enviando ?username=victima sin token
$_GET['username'] = 'victima';
$_GET['profile_name'] = 'Principal';
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);

$blocked = false;
try {
    HistoryController::getHistory();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $blocked = true;
    }
}
assert($blocked, "getHistory MUST reject request with 401 when not authenticated, ignoring ?username=");

// 2. Simular usuario autenticado 'legituser' intentando pasar ?username=victima en query
$token = AuthMiddleware::createToken(['username' => 'legituser', 'role' => 'user', 'exp' => time() + 3600]);
$_COOKIE['kurastream_token'] = $token;
$_GET['username'] = 'victima';

$reflector = new ReflectionClass('HistoryController');
$method = $reflector->getMethod('resolveUserAndProfile');
$method->setAccessible(true);
list($user, $profile) = $method->invoke(null, []);

assert($user === 'legituser', "resolveUserAndProfile MUST use JWT username ('legituser') and ignore query param 'victima'");

echo "✓ History & Favorites Isolation Tests Passed\n";
