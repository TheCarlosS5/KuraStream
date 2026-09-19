<?php
require_once __DIR__ . '/../config.php';

class RateLimiter {
    public static function check(string $key, int $maxAttempts, int $windowSeconds): bool {
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
            $records = array_filter($data, fn($ts) => ($now - $ts) < $windowSeconds);
        }

        if (count($records) >= $maxAttempts) {
            return false;
        }

        $records[] = $now;
        @file_put_contents($file, json_encode(array_values($records)));
        return true;
    }

    public static function enforce(string $action, int $maxAttempts, int $windowSeconds): void {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $key = "{$action}_{$ip}";
        if (!self::check($key, $maxAttempts, $windowSeconds)) {
            jsonError("Demasiadas peticiones. Intenta de nuevo en unos minutos.", 429);
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
