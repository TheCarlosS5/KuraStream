<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running profile PIN brute-force protection tests...\n";

function pinStatus(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}

$db = Database::getConnection();
$user = 'pinuser_' . bin2hex(random_bytes(4));
DbHelper::registerUser($user, 'a_long_password_1', 'user');
$secret = DbHelper::saveUserProfile($user, ['name' => 'Privado', 'pin' => '4821']);
$open = DbHelper::saveUserProfile($user, ['name' => 'Libre']);
$secretId = $secret['id'];
$token = AuthMiddleware::createToken(['username' => $user, 'role' => 'user', 'exp' => time() + 3600]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$token}";
RateLimiter::clearPinAttempts($user, $secretId);

$server = null;
try {
    // 1. PIN format is validated when it is set
    foreach (['abcd', '12', '1234567', '12 34', '12.5'] as $badPin) {
        $code = pinStatus(fn() => DbHelper::saveUserProfile($user, ['name' => 'X' . bin2hex(random_bytes(2)), 'pin' => $badPin]));
        assert($code === 400, "PIN '$badPin' must be refused with 400 (got " . var_export($code, true) . ')');
    }
    foreach (['1234', '123456'] as $goodPin) {
        $p = DbHelper::saveUserProfile($user, ['name' => 'Ok' . $goodPin, 'pin' => $goodPin]);
        assert(!empty($p['id']), "PIN '$goodPin' must be accepted");
    }
    echo "✓ PIN must be 4-6 digits OK\n";

    // 2. Brute force through POST /api/profiles/select (real router)
    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int)substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
    fclose($sock);
    $env = array_merge(getenv(), ['JWT_SECRET' => JWT_SECRET, 'PHP_CLI_SERVER_WORKERS' => '2']);
    $server = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/../php_backend/router.php'],
        [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, __DIR__ . '/..', $env);
    assert(is_resource($server), 'Could not start the PHP built-in server');
    $up = false;
    for ($i = 0; $i < 50 && !$up; $i++) {
        $up = @fsockopen('127.0.0.1', $port, $en, $es, 0.2) !== false;
        if (!$up) usleep(100000);
    }
    assert($up, 'Built-in server did not start');

    $select = function (string $profileId, string $pin) use ($port, $token): array {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'ignore_errors' => true, 'timeout' => 15,
            'header' => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
            'content' => json_encode(['profile_id' => $profileId, 'pin' => $pin])]]);
        $body = @file_get_contents("http://127.0.0.1:$port/api/profiles/select", false, $ctx);
        preg_match('#HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m);
        $retry = null;
        foreach ($http_response_header ?? [] as $h) {
            if (stripos($h, 'Retry-After:') === 0) $retry = (int)trim(substr($h, 12));
        }
        return [(int)($m[1] ?? 0), $retry, json_decode((string)$body, true)];
    };

    for ($i = 1; $i <= RateLimiter::PIN_MAX_ATTEMPTS; $i++) {
        [$http] = $select($secretId, '000' . $i);
        assert($http === 403, "Wrong PIN attempt #$i must answer 403, got $http");
    }
    [$http, $retry] = $select($secretId, '4821');
    assert($http === 429, "After " . RateLimiter::PIN_MAX_ATTEMPTS . " attempts even the CORRECT PIN must be locked out (got $http)");
    assert($retry !== null && $retry > 0, 'Lockout response must carry Retry-After');
    [$httpOpen] = $select($open['id'], '');
    assert($httpOpen === 200, 'A profile without PIN must stay selectable during the lockout (got ' . $httpOpen . ')');
    echo "✓ select: lockout after " . RateLimiter::PIN_MAX_ATTEMPTS . " wrong PINs, correct PIN blocked, PIN-less profiles unaffected OK\n";

    // 3. A correct PIN resets the allowance
    RateLimiter::clearPinAttempts($user, $secretId); // simulate the lockout window expiring
    for ($i = 1; $i <= 4; $i++) {
        [$http] = $select($secretId, '999' . $i);
        assert($http === 403, 'Wrong PIN before success must answer 403');
    }
    [$http, , $json] = $select($secretId, '4821');
    assert($http === 200 && !empty($json['token']), "Correct PIN within the allowance must select the profile (got $http)");
    for ($i = 1; $i <= 4; $i++) {
        [$http] = $select($secretId, '888' . $i);
        assert($http === 403, "After a successful PIN the counter must be reset (attempt $i got $http)");
    }
    echo "✓ select: correct PIN resets the counter OK\n";
    RateLimiter::clearPinAttempts($user, $secretId);

    // 4. Same allowance is shared with modifying / deleting the profile (no 5 x 3 guesses)
    for ($i = 1; $i <= 3; $i++) {
        $code = pinStatus(fn() => DbHelper::saveUserProfile($user, ['id' => $secretId, 'name' => 'Privado', 'current_pin' => '111' . $i]));
        assert($code === 403, "Wrong current_pin #$i must answer 403 (got " . var_export($code, true) . ')');
    }
    for ($i = 1; $i <= 2; $i++) {
        $code = pinStatus(fn() => DbHelper::deleteUserProfile($user, $secretId, '222' . $i));
        assert($code === 403, "Wrong delete PIN #$i must answer 403 (got " . var_export($code, true) . ')');
    }
    $code = pinStatus(fn() => DbHelper::deleteUserProfile($user, $secretId, '4821'));
    assert($code === 429, 'The 6th guess across edit+delete must be locked out even with the right PIN (got ' . var_export($code, true) . ')');
    $code = pinStatus(fn() => DbHelper::saveUserProfile($user, ['id' => $secretId, 'name' => 'Privado', 'current_pin' => '4821']));
    assert($code === 429, 'Editing is locked out as well (got ' . var_export($code, true) . ')');
    echo "✓ edit/delete share the same PIN allowance OK\n";

    RateLimiter::clearPinAttempts($user, $secretId);
    $code = pinStatus(fn() => DbHelper::saveUserProfile($user, ['id' => $secretId, 'name' => 'Privado', 'current_pin' => '4821']));
    assert($code === null, 'With the right PIN and no lockout the profile can be edited (got ' . var_export($code, true) . ')');

    // 5. Another account's allowance is independent (key is per account + profile)
    $other = 'pinother_' . bin2hex(random_bytes(4));
    DbHelper::registerUser($other, 'a_long_password_2', 'user');
    $otherProfile = DbHelper::saveUserProfile($other, ['name' => 'Privado', 'pin' => '5555']);
    for ($i = 0; $i < RateLimiter::PIN_MAX_ATTEMPTS; $i++) {
        RateLimiter::consumePinAttempt($user, $secretId);
    }
    $code = pinStatus(fn() => RateLimiter::consumePinAttempt($other, $otherProfile['id']));
    assert($code === null, 'Locking one account must not lock another');
    echo "✓ PIN allowance is per account+profile OK\n";
} finally {
    if (is_resource($server)) { proc_terminate($server); proc_close($server); }
    foreach ([$user, $other ?? null] as $u) {
        if ($u) {
            $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $u]);
            $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $u]);
        }
    }
    RateLimiter::clearPinAttempts($user, $secretId);
    if (isset($other, $otherProfile)) RateLimiter::clearPinAttempts($other, $otherProfile['id']);
    unset($_SERVER['HTTP_AUTHORIZATION']);
}

echo "All PIN brute-force protection tests passed.\n";
