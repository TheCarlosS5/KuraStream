<?php
require_once __DIR__ . '/../config.php';

class RateLimiter {
    public static function check(string $key, int $maxAttempts, int $windowSeconds, &$retryAfter = null): bool {
        $tempDir = rtrim(sys_get_temp_dir(), '/\\') . '/kura_ratelimits';
        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0777, true);
        }

        $file = $tempDir . '/rl_' . md5($key) . '.json';
        $now = time();
        $records = [];

        if (file_exists($file)) {
            $data = json_decode(@file_get_contents($file), true) ?: [];
            // Filtrar timestamps fuera de la ventana
            $records = array_values(array_filter($data, fn($ts) => ($now - $ts) < $windowSeconds));
        }

        if (count($records) >= $maxAttempts) {
            $retryAfter = max(1, ($records[0] + $windowSeconds) - $now);
            return false;
        }

        $records[] = $now;
        @file_put_contents($file, json_encode(array_values($records)));
        return true;
    }

    public static function enforce(string $action, int $maxAttempts, int $windowSeconds): void {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $key = "{$action}_{$ip}";
        $retryAfter = 0;
        if (!self::check($key, $maxAttempts, $windowSeconds, $retryAfter)) {
            @http_response_code(429);
            @header("Retry-After: {$retryAfter}");
            @header('Content-Type: application/json; charset=utf-8');
            $payload = [
                'success' => false,
                'error' => 'Demasiadas peticiones. Por favor espera...',
                'retry_after' => $retryAfter
            ];
            echo json_encode($payload);
            if (defined('TESTING_MODE')) {
                throw new ExitException(json_encode($payload), 429, $payload);
            }
            exit();
        }
    }

    public static function clear(string $key): void {
        $tempDir = rtrim(sys_get_temp_dir(), '/\\') . '/kura_ratelimits';
        $file = $tempDir . '/rl_' . md5($key) . '.json';
        if (file_exists($file)) {
            @unlink($file);
        }
    }
}
