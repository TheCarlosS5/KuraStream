<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running CSRF protection tests...\n";

function cs_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}
/** Runs $fn as a request with the given method/auth/headers, then restores the superglobals. */
function cs_request(string $method, array $opts, callable $fn): ?int {
    $_SERVER['REQUEST_METHOD'] = $method;
    unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_REQUESTED_WITH'], $_COOKIE['kurastream_token']);
    if (isset($opts['cookie'])) $_COOKIE['kurastream_token'] = $opts['cookie'];
    if (isset($opts['bearer'])) $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $opts['bearer'];
    if (!empty($opts['xhr'])) $_SERVER['HTTP_X_REQUESTED_WITH'] = 'XMLHttpRequest';
    try { return cs_status($fn); } finally {
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_REQUESTED_WITH'], $_COOKIE['kurastream_token']);
        $_SERVER['REQUEST_METHOD'] = 'GET';
    }
}

$db = Database::getConnection();
$user = 'cs_user_' . bin2hex(random_bytes(3));
$adminName = 'cs_admin_' . bin2hex(random_bytes(3));
$origAdmin = getenv('ADMIN_USER');
$server = null;

try {
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    $userToken = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'exp' => time() + 3600]);
    putenv("ADMIN_USER=$adminName");
    $adminToken = AuthMiddleware::createToken(['username' => $adminName, 'role' => 'admin', 'exp' => time() + 3600]);
    $auth = fn() => AuthMiddleware::requireAuth();
    $admin = fn() => AuthMiddleware::requireAdmin();

    // 1. The session cookie alone does not authorise requests that change data
    foreach (['POST', 'PUT', 'DELETE', 'PATCH'] as $method) {
        assert(cs_request($method, ['cookie' => $userToken], $auth) === 401, "Cookie-only $method without the proof header must be refused");
        assert(cs_request($method, ['cookie' => $userToken, 'xhr' => true], $auth) === null, "Cookie + X-Requested-With on $method is accepted");
        assert(cs_request($method, ['bearer' => $userToken], $auth) === null, "An Authorization header needs no extra proof on $method");
    }
    // ...but reads (<video>, subtitles, images) keep working with the cookie
    foreach (['GET', 'HEAD', 'OPTIONS'] as $method) {
        assert(cs_request($method, ['cookie' => $userToken], $auth) === null, "Cookie-only $method stays allowed");
    }
    echo "✓ Cookie-only writes need X-Requested-With; reads and bearer requests are unaffected OK\n";

    // 2. Administration needs the proof for ANY method (admin GET endpoints have side effects)
    assert(cs_request('GET', ['cookie' => $adminToken], $admin) === 401, 'Cookie-only admin GET must be refused');
    assert(cs_request('GET', ['cookie' => $adminToken, 'xhr' => true], $admin) === null, 'Cookie + header admin GET is accepted');
    assert(cs_request('GET', ['bearer' => $adminToken], $admin) === null, 'Bearer admin GET is accepted');
    assert(cs_request('POST', ['cookie' => $adminToken], $admin) === 401, 'Cookie-only admin POST must be refused');
    echo "✓ Admin endpoints require the proof header (or Authorization) on every method OK\n";

    // 3. End to end through the real router
    RateLimiter::clear('auth_127.0.0.1');
    [$server, $port] = kura_start_server(['ADMIN_USER' => $adminName, 'ALLOWED_ORIGINS' => 'http://allowed.example']);
    $cookie = "Cookie: kurastream_token={$userToken}\r\n";
    [$code] = kura_http($port, 'POST', '/api/favorites', ['show_id' => 'x'], null, $cookie);
    assert($code === 401, "A cross-site style POST (cookie only) must be 401 (got $code)");
    [$code] = kura_http($port, 'POST', '/api/favorites', ['show_id' => 'x'], null, $cookie . "X-Requested-With: XMLHttpRequest\r\n");
    assert($code !== 401, "The same request from the app (with the header) is authenticated (got $code)");
    [$code] = kura_http($port, 'GET', '/api/admin/stats', null, null, "Cookie: kurastream_token={$adminToken}\r\n");
    assert($code === 401, "A cookie-only admin GET must be 401 (got $code)");
    [$code] = kura_http($port, 'GET', '/api/admin/stats', null, $adminToken);
    assert($code === 200, "The same admin GET with Authorization works (got $code)");

    [$code, $h] = kura_http($port, 'OPTIONS', '/api/favorites', null, null, "Origin: http://allowed.example\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: x-requested-with\r\n");
    assert(($h['access-control-allow-origin'] ?? '') === 'http://allowed.example', 'Allowed origin is echoed');
    assert(stripos($h['access-control-allow-headers'] ?? '', 'X-Requested-With') !== false, 'CORS preflight allows X-Requested-With for allowed origins');
    [$code, $h] = kura_http($port, 'OPTIONS', '/api/favorites', null, null, "Origin: http://evil.example\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: x-requested-with\r\n");
    assert(!isset($h['access-control-allow-origin']), 'A foreign origin gets no CORS grant, so it cannot add the header');
    echo "✓ HTTP: cookie-only writes/admin reads refused, CORS grants nothing to foreign origins OK\n";
} finally {
    kura_stop_server($server);
    if ($origAdmin !== false) putenv("ADMIN_USER=$origAdmin"); else putenv('ADMIN_USER');
    $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $user]);
    $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $user]);
    RateLimiter::clear('auth_127.0.0.1');
}

echo "All CSRF protection tests passed.\n";
