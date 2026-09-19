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
assert($rateLimited, "enforce must throw ExitException with status 429 when max attempts exceeded");
RateLimiter::clear($expectedKey);

echo "✓ Rate Limiter Tests Passed\n";
