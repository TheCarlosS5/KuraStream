<?php
/**
 * What a person sees when the database is down. A real PHP web server (the same router) is started against a closed
 * database port and queried over HTTP: the API must answer 503 with a readable message and Retry-After (never a 500
 * with a driver message), /api/health must describe the outage as JSON, and nothing sensitive may reach the client.
 */
echo "Running database outage behaviour test...\n";

$root = realpath(__DIR__ . '/..');
$secret = 'super-secret-db-password';

$sock = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
$port = (int)substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
fclose($sock);

$env = ['PATH' => getenv('PATH'), 'JWT_SECRET' => bin2hex(random_bytes(32)), 'DB_HOST' => '127.0.0.1', 'DB_PORT' => '1',
    'DB_NAME' => 'x', 'DB_USER' => 'kurastream', 'DB_PASS' => $secret, 'HOME' => sys_get_temp_dir()];
$server = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", $root . '/php_backend/router.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $root, $env);
register_shutdown_function(function () use ($server) { if (is_resource($server)) { proc_terminate($server); } });
for ($i = 0; $i < 50; $i++) {
    if (@fsockopen('127.0.0.1', $port, $e, $s, 0.2)) break;
    usleep(100000);
}

function outage_get(int $port, string $method, string $uri): array {
    $ctx = stream_context_create(['http' => ['method' => $method, 'ignore_errors' => true, 'timeout' => 15, 'content' => $method === 'POST' ? '{"username":"a","password":"b12345678"}' : '',
        'header' => "Content-Type: application/json\r\n"]]);
    $body = (string)@file_get_contents("http://127.0.0.1:$port$uri", false, $ctx);
    $headers = $http_response_header ?? [];
    preg_match('#HTTP/\S+ (\d+)#', $headers[0] ?? '', $m);
    return [(int)($m[1] ?? 0), $headers, $body];
}

[$code, $headers, $body] = outage_get($port, 'GET', '/api/health');
$health = json_decode($body, true);
assert($code === 503 && ($health['status'] ?? '') === 'degraded' && ($health['database'] ?? '') === 'disconnected', "/api/health describes the outage (got $code $body)");

foreach ([['GET', '/api/shows'], ['POST', '/api/login'], ['GET', '/api/history']] as [$m, $u]) {
    [$code, $headers, $body] = outage_get($port, $m, $u);
    $j = json_decode($body, true) ?: [];
    // Some routes refuse an anonymous caller before touching the database (401): fine. A 500 is not.
    assert(in_array($code, [503, 401, 403], true), "$u must not answer 500 while the database is down (got $code $body)");
    if ($code === 503) {
        assert(($j['code'] ?? '') === 'DATABASE_UNAVAILABLE' && str_contains($j['error'] ?? '', 'base de datos'), "$u has a readable message: $body");
        assert(count(preg_grep('/^Retry-After:\s*\d+/i', $headers)) === 1, "$u sends Retry-After");
    }
    foreach ([$secret, 'SQLSTATE', 'PDOException', '/home/', 'Stack trace'] as $leak) {
        assert(!str_contains($body . implode("\n", $headers), $leak), "$u never shows '$leak' to the client");
    }
}
proc_terminate($server);
echo "✓ Database down: 503 + readable message + Retry-After, health says degraded, nothing leaks OK\n";
echo "Database outage behaviour test passed!\n";
