<?php
define('TESTING_MODE', true);
$errorLog = tempnam(sys_get_temp_dir(), 'kura_errlog_');
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/Input.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running global error handling & input validation tests...\n";

function eh_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}

// 1. Classification
$typeError = null;
try { trim([]); } catch (TypeError $e) { $typeError = $e; }
assert($typeError !== null && kuraClassifyThrowable($typeError)[0] === 400, 'trim(array) TypeError is the client\'s fault: 400');
$dup = new PDOException('Duplicate entry'); $dup->errorInfo = ['23000', 1062, 'Duplicate entry'];
assert(kuraClassifyThrowable($dup)[0] === 409, 'Duplicate key maps to 409');
$long = new PDOException('Data too long'); $long->errorInfo = ['22001', 1406, 'Data too long for column'];
assert(kuraClassifyThrowable($long)[0] === 400, 'Data too long maps to 400');
$other = new PDOException('Lost connection'); $other->errorInfo = ['HY000', 2006, 'MySQL server has gone away'];
assert(kuraClassifyThrowable($other)[0] === 500, 'Other database errors are 500');
assert(kuraClassifyThrowable(new RuntimeException('boom'))[0] === 500, 'Unknown errors are 500');
echo "✓ kuraClassifyThrowable OK\n";

// 2. The handler never puts internals in the response and always gives a request id
file_put_contents($errorLog, '');
$previousErrorLog = ini_set('error_log', $errorLog); // only while we inspect the handler's log line
$secretish = new RuntimeException('SQLSTATE[HY000] password=hunter2 in /var/www/secret/path.php');
ob_start();
try { kuraHandleThrowable($secretish); } catch (ExitException $e) { $captured = $e; }
ob_end_clean();
ini_set('error_log', (string)$previousErrorLog);
assert(isset($captured) && $captured->statusCode === 500, 'Handler answers 500 for unexpected errors');
$body = json_encode($captured->data);
assert(!str_contains($body, 'hunter2') && !str_contains($body, '/var/www') && !str_contains($body, 'SQLSTATE') && !str_contains($body, __FILE__),
    'Response must not contain the exception message or any path');
assert(preg_match('/^[0-9a-f]{12}$/', $captured->data['request_id'] ?? '') === 1, 'Response must carry a request id');
$logged = file_get_contents($errorLog);
assert(str_contains($logged, $captured->data['request_id']) && str_contains($logged, 'hunter2'), 'The detail must be in the server log under the same request id');
echo "✓ Handler hides internals, logs them with a request id OK\n";

// 3. Input::string
assert(eh_status(fn() => Input::string(['a' => []], 'a')) === 400, 'array field refused');
assert(eh_status(fn() => Input::string(['a' => ['x' => 1]], 'a')) === 400, 'object field refused');
assert(eh_status(fn() => Input::string(['a' => true], 'a')) === 400, 'boolean field refused');
assert(eh_status(fn() => Input::string(['a' => str_repeat('x', 11)], 'a', 10)) === 400, 'too long refused (not truncated)');
assert(Input::string([], 'a') === '' && Input::string(['a' => null], 'a') === '', 'missing/null gives empty string');
assert(Input::string(['a' => 42], 'a') === '42', 'numbers become strings');
assert(Input::string(['a' => '  hi  '], 'a') === 'hi' && Input::string(['a' => '  hi  '], 'a', 10, false) === '  hi  ', 'trim is optional');
assert(Input::string(['a' => str_repeat('ñ', 10)], 'a', 10) === str_repeat('ñ', 10), 'length counts characters, not bytes');
assert(Input::json('not json') === [] && Input::json('"str"') === [] && Input::json('{"a":1}') === ['a' => 1], 'Input::json only returns objects');
echo "✓ Input helper OK\n";

// 4. Login / register / profile refuse non-string fields with 400 instead of crashing
assert(eh_status(fn() => AuthController::login(['username' => [], 'password' => 'x'])) === 400, 'login with array username -> 400');
assert(eh_status(fn() => AuthController::login(['username' => 'u', 'password' => ['a']])) === 400, 'login with array password -> 400');
assert(eh_status(fn() => AuthController::register(['username' => ['a'], 'password' => 'long_enough_pw'])) === 400, 'register with array username -> 400');
assert(eh_status(fn() => AuthController::register(['username' => 'ok_name', 'password' => str_repeat('p', 2000)])) === 400, 'register with absurdly long password -> 400');
$u = 'eh_' . bin2hex(random_bytes(4));
DbHelper::registerUser($u, 'a_long_password_1', 'user');
assert(eh_status(fn() => DbHelper::saveUserProfile($u, ['name' => ['x']])) === 400, 'profile name must be text');
assert(eh_status(fn() => DbHelper::saveUserProfile($u, ['name' => str_repeat('n', 65)])) === 400, 'profile name over 64 chars refused');
$db = Database::getConnection();
$db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $u]);
$db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $u]);
echo "✓ Auth/profile input validation OK\n";

// 5. Duplicate-key races
class EhFakeStmt extends PDOStatement {
    public function __construct(private string $sql, private bool $failInsert) {}
    public function execute(?array $params = null): bool {
        if ($this->failInsert && stripos($this->sql, 'INSERT INTO users') === 0) {
            $e = new PDOException('Duplicate entry'); $e->errorInfo = ['23000', 1062, 'Duplicate entry'];
            throw $e;
        }
        return true;
    }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed { return false; }
}
class EhFakePdo extends PDO {
    public function __construct() {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new EhFakeStmt($query, true); }
}
Database::setConnection(new EhFakePdo());
try {
    assert(DbHelper::registerUser('racer', 'a_long_password_1', 'user') === null, 'losing a registration race must report "already registered" (null), not crash');
} finally {
    Database::setConnection(null);
}
echo "✓ registerUser duplicate-key race OK\n";

// 6. End to end through the real router (handlers are installed there because TESTING_MODE is not defined)
function eh_start(array $env): array {
    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int)substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
    fclose($sock);
    $env = array_merge(getenv(), ['JWT_SECRET' => JWT_SECRET, 'PHP_CLI_SERVER_WORKERS' => '2'], $env);
    $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/../php_backend/router.php'],
        [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, __DIR__ . '/..', $env);
    assert(is_resource($proc), 'Could not start the PHP built-in server');
    $up = false;
    for ($i = 0; $i < 50 && !$up; $i++) {
        $up = @fsockopen('127.0.0.1', $port, $en, $es, 0.2) !== false;
        if (!$up) usleep(100000);
    }
    assert($up, 'Built-in server did not start');
    return [$proc, $port];
}
function eh_http(int $port, string $method, string $path, ?string $body = null, string $extraHeaders = ''): array {
    $ctx = stream_context_create(['http' => ['method' => $method, 'ignore_errors' => true, 'timeout' => 20,
        'header' => "Content-Type: application/json\r\n" . $extraHeaders, 'content' => $body ?? '']]);
    $resp = @file_get_contents("http://127.0.0.1:$port$path", false, $ctx);
    preg_match('#HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m);
    $headers = [];
    foreach ($http_response_header ?? [] as $h) {
        if (str_contains($h, ':')) { [$k, $v] = explode(':', $h, 2); $headers[strtolower(trim($k))] = trim($v); }
    }
    return [(int)($m[1] ?? 0), $headers, (string)$resp];
}

[$procOk, $portOk] = eh_start([]);
try {
    [$code, , $resp] = eh_http($portOk, 'POST', '/api/login', json_encode(['username' => [], 'password' => 'x']));
    assert($code === 400 && !str_contains($resp, 'Stack trace') && !str_contains($resp, 'TypeError'), "login with {\"username\":[]} must be a clean 400 (got $code: $resp)");
    [$code, , $resp] = eh_http($portOk, 'GET', '/api/shows?type[]=anime');
    assert($code === 400 && !str_contains($resp, 'Stack trace'), "array query parameter must be a clean 400 (got $code)");
    [$code] = eh_http($portOk, 'GET', '/api/health', null, "Cookie: kurastream_token[]=x\r\n");
    assert($code === 200, "array-shaped cookie must be ignored, not crash (got $code)");
    // /api/party/join has no field validation of its own: only the global handler stands between a
    // {"room_id": []} body and a raw TypeError page.
    [$code, $headers, $resp] = eh_http($portOk, 'POST', '/api/party/join', json_encode(['room_id' => []]));
    $json = json_decode($resp, true);
    assert($code === 400 && is_array($json) && isset($json['request_id']), "TypeError from a hostile body must become a JSON 400 with request_id (got $code: $resp)");
    assert(($headers['x-request-id'] ?? '') === $json['request_id'], 'X-Request-Id header must match the body request id');
    foreach (['TypeError', 'Stack trace', '.php', '/home/'] as $leak) {
        assert(!str_contains($resp, $leak), "Response must not leak '$leak' (got: $resp)");
    }
    echo "✓ Router: hostile JSON/query/cookie shapes answer cleanly OK\n";
} finally {
    proc_terminate($procOk); proc_close($procOk);
}

[$procDown, $portDown] = eh_start(['DB_HOST' => '127.0.0.1', 'DB_PORT' => '1']);
try {
    [$code, $headers, $resp] = eh_http($portDown, 'GET', '/api/shows');
    assert($code === 503, "Database down must be a 503 (the server is fine, its database is not reachable) (got $code)");
    $json = json_decode($resp, true);
    assert(is_array($json) && isset($json['error']), "503 body must be JSON with an error message (got: $resp)");
    foreach (['PDOException', 'Stack trace', '.php', 'SQLSTATE', '/home/', 'mysql:host'] as $leak) {
        assert(!str_contains($resp, $leak), "500 body must not leak '$leak' (got: $resp)");
    }
    echo "✓ Router: database outage answers a generic 500, no leaks OK\n";
} finally {
    proc_terminate($procDown); proc_close($procDown);
    @unlink($errorLog);
}

echo "All error handling tests passed.\n";
