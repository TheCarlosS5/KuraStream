<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';

echo "Running Rate Limiter Tests...\n";

// 1. Test RateLimiter::check and sliding window limit
$testKey = 'test_ip_' . uniqid();
RateLimiter::clear($testKey);

// Permitir hasta 3 intentos en 10 segundos
assert(RateLimiter::check($testKey, 3, 10) === true, "1st attempt should be allowed");
assert(RateLimiter::check($testKey, 3, 10) === true, "2nd attempt should be allowed");
assert(RateLimiter::check($testKey, 3, 10) === true, "3rd attempt should be allowed");
assert(RateLimiter::check($testKey, 3, 10) === false, "4th attempt must be rejected by rate limiter");

// 2. Test RateLimiter::clear
RateLimiter::clear($testKey);
assert(RateLimiter::check($testKey, 3, 10) === true, "Attempt after clear should be allowed");
RateLimiter::clear($testKey);

// 3. Test RateLimiter::enforce with ExitException (429)
$action = 'test_action_' . uniqid();
$_SERVER['REMOTE_ADDR'] = '10.0.0.42';
$expectedKey = "{$action}_10.0.0.42";
RateLimiter::clear($expectedKey);

RateLimiter::enforce($action, 2, 60);
RateLimiter::enforce($action, 2, 60);

ob_start();
try {
    RateLimiter::enforce($action, 2, 60);
} catch (ExitException $e) {
    if ($e->statusCode === 429) {
        $rateLimited = true;
    }
}
ob_end_clean();
RateLimiter::clear($expectedKey);

// 4. Test RateLimiter::getClientIp untrusted proxy spoof rejection
$_SERVER['REMOTE_ADDR'] = '198.51.100.55'; // Untrusted public IP
$_SERVER['HTTP_X_FORWARDED_FOR'] = '1.1.1.1, 8.8.8.8';
$resolvedIp = RateLimiter::getClientIp(['10.0.0.1', '10.0.0.2']);
assert($resolvedIp === '198.51.100.55', "When REMOTE_ADDR is not trusted proxy, XFF must be ignored");

// 5. Test RateLimiter::getClientIp right-to-left traversal through trusted proxies
$_SERVER['REMOTE_ADDR'] = '10.0.0.1'; // Trusted upstream reverse proxy
// Attacker injected 1.2.3.4, real client is 198.51.100.77, passed through another trusted internal proxy 10.0.0.2
$_SERVER['HTTP_X_FORWARDED_FOR'] = '1.2.3.4, 198.51.100.77, 10.0.0.2';
$resolvedBehindProxy = RateLimiter::getClientIp(['10.0.0.1', '10.0.0.2']);
assert($resolvedBehindProxy === '198.51.100.77', "getClientIp must parse right-to-left and return first untrusted IP (198.51.100.77), got '{$resolvedBehindProxy}'");

echo "✓ Rate Limiter Tests Passed\n";
