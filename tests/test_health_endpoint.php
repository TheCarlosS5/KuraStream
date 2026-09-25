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

assert(isset($data['php_version']), 'PHP version must be included');
assert(isset($data['storage']), 'Storage status must be included');

echo "✓ Health endpoint tests passed\n";
