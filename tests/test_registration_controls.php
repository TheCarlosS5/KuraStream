<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running registration control tests...\n";

function rc_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$created = [];
$origAdmin = getenv('ADMIN_USER');
$origMode = getenv('REGISTRATION_MODE');
$server = null;
$reg = function (string $name, string $pass = 'long_enough_pw_1') use (&$created) {
    $created[] = $name;
    return rc_status(fn() => AuthController::register(['username' => $name, 'password' => $pass]));
};

try {
    // 1. Username format
    foreach (['ab', 'john doe', 'josé', str_repeat('a', 33), '../etc', 'a<b>c', "tab\tname", 'emoji🙂name'] as $bad) {
        assert($reg($bad) === 400, 'Username ' . json_encode($bad) . ' must be refused');
    }
    foreach (["ok.name-$suffix", "UPPER_$suffix", "a-$suffix"] as $good) {
        assert($reg($good) === 200, "Username $good must be accepted");
    }
    $max = 'm' . substr(md5($suffix), 0, 31);
    assert(strlen($max) === 32 && $reg($max) === 200, 'A name of exactly 32 characters is within the limit');
    echo "✓ Username must be 3-32 of [A-Za-z0-9_.-] OK\n";

    // 2. Password bounds (bcrypt only reads 72 bytes)
    assert($reg("pw1_$suffix", 'short') === 400, '7 or fewer characters refused');
    assert($reg("pw2_$suffix", str_repeat('p', 73)) === 400, 'More than 72 bytes refused');
    assert($reg("pw3_$suffix", str_repeat('p', 72)) === 200, 'Exactly 72 bytes accepted');
    assert($reg("pw4_$suffix", str_repeat('p', 8)) === 200, 'Exactly 8 accepted');
    echo "✓ Password must be 8-72 bytes OK\n";

    // 3. Duplicate and reserved administrator name
    assert($reg("ok.name-$suffix") === 409, 'A taken name answers 409');
    putenv("ADMIN_USER=Reserved_Admin_$suffix");
    assert($reg("reserved_admin_$suffix") === 409, 'The ADMIN_USER name (any case) cannot be registered');
    putenv('ADMIN_USER');
    echo "✓ Duplicate and reserved names answer 409 OK\n";

    // 4. REGISTRATION_MODE (a typo must close, not open)
    putenv('REGISTRATION_MODE=closed');
    assert($reg("closed1_$suffix") === 403, 'closed mode refuses sign-up');
    putenv('REGISTRATION_MODE=close');
    assert($reg("closed2_$suffix") === 403, 'an unknown value fails closed');
    putenv('REGISTRATION_MODE=OPEN');
    assert($reg("open1_$suffix") === 200, 'OPEN (any case) allows sign-up');
    putenv('REGISTRATION_MODE');
    assert($reg("open2_$suffix") === 200, 'unset keeps sign-up open');
    echo "✓ REGISTRATION_MODE open/closed/typo OK\n";

    // 5. Per-address limit through the real router (configurable)
    RateLimiter::clear('auth_127.0.0.1');
    RateLimiter::clear('register_127.0.0.1');
    [$server, $port] = kura_start_server(['REGISTER_MAX_PER_HOUR' => '2']);
    $codes = [];
    foreach (['a', 'b', 'c'] as $i) {
        $name = "lim_{$i}_$suffix";
        $created[] = $name;
        $codes[] = kura_http($port, 'POST', '/api/register', ['username' => $name, 'password' => 'long_enough_pw_1'])[0];
    }
    assert($codes === [200, 200, 429], 'REGISTER_MAX_PER_HOUR=2 allows two sign-ups, then 429 (got ' . implode(',', $codes) . ')');
    $loginCode = kura_http($port, 'POST', '/api/login', ['username' => "lim_a_$suffix", 'password' => 'long_enough_pw_1'])[0];
    assert($loginCode === 200, "The sign-up limit must not block login (got $loginCode)");
    echo "✓ HTTP: per-address sign-up limit OK\n";
} finally {
    kura_stop_server($server);
    if ($origAdmin !== false) putenv("ADMIN_USER=$origAdmin"); else putenv('ADMIN_USER');
    if ($origMode !== false) putenv("REGISTRATION_MODE=$origMode"); else putenv('REGISTRATION_MODE');
    foreach ($created as $u) {
        $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $u]);
        $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $u]);
    }
    RateLimiter::clear('auth_127.0.0.1');
    RateLimiter::clear('register_127.0.0.1');
}

echo "All registration control tests passed.\n";
