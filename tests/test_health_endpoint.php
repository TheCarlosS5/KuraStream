<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';

echo "Running System Health Endpoint Tests...\n";

$_SERVER['REQUEST_URI'] = '/api/health';
$_SERVER['REQUEST_METHOD'] = 'GET';

ob_start();
$caught = null;
try {
    require __DIR__ . '/../php_backend/router.php';
} catch (ExitException $e) {
    $caught = $e;
}
$output = ob_get_clean();

assert($caught !== null, 'Router must throw ExitException after responding');
$data = json_decode($caught->getMessage(), true) ?: $caught->data;

if ($caught->statusCode === 200) {
    assert($data['success'] === true, 'Success flag must be true');
    assert($data['status'] === 'healthy', 'Status must be healthy');
    assert($data['database'] === 'connected', 'Database must be connected');
} elseif ($caught->statusCode === 503) {
    assert($data['success'] === false, 'Success flag must be false when DB is down');
    assert($data['status'] === 'degraded', 'Status must be degraded when DB is down');
    assert($data['database'] === 'disconnected', 'Database must be disconnected');
} else {
    assert(false, "Unexpected HTTP status: {$caught->statusCode}");
}

assert(!isset($data['php_version']), 'The PHP version must not be revealed to anonymous callers');
assert(isset($data['storage']), 'Storage status must be included');

// Administrators still get the runtime version (only meaningful when the database answered).
if ($caught->statusCode === 200) {
    require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
    putenv('ADMIN_USER=health_admin');
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . AuthMiddleware::createToken(['username' => 'health_admin', 'role' => 'admin', 'exp' => time() + 600]);
    ob_start();
    $adminCaught = null;
    try {
        require __DIR__ . '/../php_backend/router.php';
    } catch (ExitException $e) {
        $adminCaught = $e;
    }
    ob_end_clean();
    putenv('ADMIN_USER');
    unset($_SERVER['HTTP_AUTHORIZATION']);
    assert($adminCaught !== null && ($adminCaught->data['php_version'] ?? null) === PHP_VERSION, 'Administrators receive the PHP version');
}

echo "✓ Health endpoint tests passed\n";
