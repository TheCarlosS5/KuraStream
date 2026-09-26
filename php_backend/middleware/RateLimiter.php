<?php
require_once __DIR__ . '/../config.php';

class RateLimiter {
    public static function check(string $key, int $maxAttempts, int $windowSeconds, &$retryAfter = null): bool {
        $tempDir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'kura_ratelimits';
        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0777, true);
        }

        $file = $tempDir . DIRECTORY_SEPARATOR . 'rl_' . md5($key) . '.json';
        $now = time();

        $fp = @fopen($file, 'c+');
        if (!$fp) {
            return true; // Fallback gracefully if filesystem fails
        }

        if (!flock($fp, LOCK_EX)) {
            fclose($fp);
            return true;
        }

        $content = '';
        while (!feof($fp)) {
            $content .= fread($fp, 8192);
        }

        $data = json_decode($content, true) ?: [];
        // Filter timestamps within the rolling window
        $records = array_values(array_filter($data, fn($ts) => ($now - $ts) < $windowSeconds));

        if (count($records) >= $maxAttempts) {
            $retryAfter = max(1, ($records[0] + $windowSeconds) - $now);
            flock($fp, LOCK_UN);
            fclose($fp);
            return false;
        }

        $records[] = $now;
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($records));
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);

        return true;
    }

    public static function getClientIp(): string {
        $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $trusted = defined('TRUSTED_PROXIES') ? TRUSTED_PROXIES : [];

        if (empty($trusted) || !in_array($remoteAddr, $trusted, true)) {
            return $remoteAddr;
        }

        $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['HTTP_X_REAL_IP'] ?? '');
        if (!empty($forwarded)) {
            $ips = array_map('trim', explode(',', $forwarded));
            foreach ($ips as $candidate) {
                if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                    return $candidate;
                }
            }
        }

        return $remoteAddr;
    }

    public static function enforce(string $action, int $maxAttempts, int $windowSeconds): void {
        $ip = self::getClientIp();
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
