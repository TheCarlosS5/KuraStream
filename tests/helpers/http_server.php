<?php
/**
 * Helpers for tests that need the real router: start `php -S` on a free port and talk HTTP to it.
 * The child process does NOT define TESTING_MODE, so it behaves like production (global error handler,
 * strict session validation).
 */

/** @return array{0: resource, 1: int} process handle and port */
function kura_start_server(array $env = []): array {
    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int)substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
    fclose($sock);
    $env = array_merge(getenv(), ['JWT_SECRET' => JWT_SECRET, 'PHP_CLI_SERVER_WORKERS' => '4', 'KURA_USE_DIST' => '0'], $env);
    $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", __DIR__ . '/../../php_backend/router.php'],
        [0 => ['pipe', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, __DIR__ . '/../..', $env);
    assert(is_resource($proc), 'Could not start the PHP built-in server');
    $up = false;
    for ($i = 0; $i < 50 && !$up; $i++) {
        $up = @fsockopen('127.0.0.1', $port, $en, $es, 0.2) !== false;
        if (!$up) usleep(100000);
    }
    assert($up, 'Built-in server did not start');
    return [$proc, $port];
}

function kura_stop_server($proc): void {
    if (is_resource($proc)) {
        proc_terminate($proc);
        proc_close($proc);
    }
}

/** @return array{0: int, 1: array<string,string>, 2: array|null, 3: string} status, lower-cased headers, decoded JSON, raw body */
function kura_http(int $port, string $method, string $path, ?array $json = null, ?string $bearer = null, string $extraHeaders = ''): array {
    $headers = "Content-Type: application/json\r\n" . $extraHeaders;
    if ($bearer !== null) {
        $headers .= "Authorization: Bearer {$bearer}\r\n";
    }
    $ctx = stream_context_create(['http' => ['method' => $method, 'ignore_errors' => true, 'timeout' => 20,
        'header' => $headers, 'content' => $json !== null ? json_encode($json) : '']]);
    $raw = (string)@file_get_contents("http://127.0.0.1:$port$path", false, $ctx);
    preg_match('#HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m);
    $out = [];
    foreach ($http_response_header ?? [] as $h) {
        if (str_contains($h, ':')) { [$k, $v] = explode(':', $h, 2); $out[strtolower(trim($k))] = trim($v); }
    }
    return [(int)($m[1] ?? 0), $out, json_decode($raw, true), $raw];
}
