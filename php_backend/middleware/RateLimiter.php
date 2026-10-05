<?php
require_once __DIR__ . '/../config.php';

class RateLimiter {
    /** Purge expired rows on 1 of N calls (tests set 1 to make it deterministic). */
    public static int $housekeepingOneIn = 200;

    /**
     * Atomically records one attempt for $key and says whether it is within $maxAttempts per $windowSeconds
     * (sliding window). State lives in the rate_limits table so every PHP process and container shares it; the
     * per-host file store below is only used while that table does not exist yet. If the state cannot be read
     * or written the attempt is REFUSED: a limiter that fails open is no limiter when an attacker can make it fail.
     */
    public static function check(string $key, int $maxAttempts, int $windowSeconds, &$retryAfter = null): bool {
        $result = self::checkInDatabase($key, $maxAttempts, $windowSeconds, $retryAfter);
        if ($result !== null) {
            return $result;
        }
        return self::checkInFile($key, $maxAttempts, $windowSeconds, $retryAfter);
    }

    /** null = the database store is not usable (table missing / no connection in a test without MySQL). */
    private static function checkInDatabase(string $key, int $maxAttempts, int $windowSeconds, &$retryAfter): ?bool {
        try {
            require_once __DIR__ . '/../db.php';
            $db = Database::getConnection();
            $now = time();
            $hash = md5($key);

            $db->beginTransaction();
            try {
                $db->prepare("INSERT IGNORE INTO rate_limits (k, hits, expires_at) VALUES (:k, '[]', :e)")
                    ->execute(['k' => $hash, 'e' => $now + $windowSeconds]);
                $stmt = $db->prepare("SELECT hits FROM rate_limits WHERE k = :k FOR UPDATE");
                $stmt->execute(['k' => $hash]);
                $data = json_decode((string)$stmt->fetchColumn(), true) ?: [];

                $records = array_values(array_filter($data, fn($ts) => ($now - $ts) < $windowSeconds));
                if (count($records) >= $maxAttempts) {
                    $retryAfter = max(1, ($records[0] + $windowSeconds) - $now);
                    $allowed = false;
                } else {
                    $records[] = $now;
                    $db->prepare("UPDATE rate_limits SET hits = :h, expires_at = :e WHERE k = :k")
                        ->execute(['h' => json_encode($records), 'e' => $now + $windowSeconds, 'k' => $hash]);
                    $allowed = true;
                }
                $db->commit();
            } catch (Throwable $e) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $e;
            }

            // Housekeeping on a small share of requests keeps the table from growing.
            if (random_int(1, max(1, self::$housekeepingOneIn)) === 1) {
                $db->prepare("DELETE FROM rate_limits WHERE expires_at < :now LIMIT 1000")->execute(['now' => $now]);
            }
            return $allowed;
        } catch (PDOException $e) {
            // 42S02: table not created yet (migration pending) -> file store. Anything else: refuse.
            if (($e->errorInfo[0] ?? $e->getCode()) === '42S02') {
                return null;
            }
            if (defined('TESTING_MODE') && str_contains($e->getMessage(), 'connection')) {
                return null; // no database at all in a suite that runs without MySQL
            }
            error_log('[KuraStream] rate limiter store failed, refusing the request: ' . $e->getMessage());
            $retryAfter = 5;
            return false;
        }
    }

    private static function checkInFile(string $key, int $maxAttempts, int $windowSeconds, &$retryAfter): bool {
        $tempDir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'kura_ratelimits';
        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0777, true);
        }

        $file = $tempDir . DIRECTORY_SEPARATOR . 'rl_' . md5($key) . '.json';
        $now = time();

        $fp = @fopen($file, 'c+');
        if (!$fp || !flock($fp, LOCK_EX)) {
            if ($fp) fclose($fp);
            error_log('[KuraStream] rate limiter file store unavailable, refusing the request');
            $retryAfter = 5;
            return false;
        }

        $content = '';
        while (!feof($fp)) {
            $content .= fread($fp, 8192);
        }

        $data = json_decode($content, true) ?: [];
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

    public static function getClientIp(?array $trusted = null): string {
        $remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        if ($trusted === null) {
            $trusted = defined('TRUSTED_PROXIES') ? TRUSTED_PROXIES : [];
        }

        if (empty($trusted) || !in_array($remoteAddr, $trusted, true)) {
            return $remoteAddr;
        }

        $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['HTTP_X_REAL_IP'] ?? '');
        if (!empty($forwarded)) {
            $ips = array_map('trim', explode(',', $forwarded));
            for ($i = count($ips) - 1; $i >= 0; $i--) {
                $candidate = $ips[$i];
                if (!filter_var($candidate, FILTER_VALIDATE_IP)) {
                    continue;
                }
                if (!in_array($candidate, $trusted, true)) {
                    return $candidate;
                }
            }
        }

        return $remoteAddr;
    }

    public static function enforce(string $action, int $maxAttempts, int $windowSeconds): void {
        $ip = self::getClientIp();
        self::enforceKey("{$action}_{$ip}", $maxAttempts, $windowSeconds);
    }

    /**
     * Atomically consumes one attempt for an arbitrary key and answers 429 once the allowance is spent.
     * The attempt is counted before the protected check runs, so parallel requests cannot all slip through.
     */
    public static function enforceKey(string $key, int $maxAttempts, int $windowSeconds, string $message = 'Demasiadas peticiones. Por favor espera...'): void {
        $retryAfter = 0;
        if (!self::check($key, $maxAttempts, $windowSeconds, $retryAfter)) {
            @http_response_code(429);
            @header("Retry-After: {$retryAfter}");
            @header('Content-Type: application/json; charset=utf-8');
            $payload = [
                'success' => false,
                'error' => $message,
                'retry_after' => $retryAfter
            ];
            echo json_encode($payload);
            if (defined('TESTING_MODE')) {
                throw new ExitException(json_encode($payload), 429, $payload);
            }
            exit();
        }
    }

    public const PIN_MAX_ATTEMPTS = 5;
    public const PIN_WINDOW_SECONDS = 900;

    private static function pinKey(string $username, string $profileId): string {
        return 'pin_' . strtolower($username) . '_' . $profileId;
    }

    /**
     * Counts one PIN guess for this profile (answers 429 after PIN_MAX_ATTEMPTS within PIN_WINDOW_SECONDS).
     * Keyed by account and profile, not by IP, so changing address (or using a kids session of the same
     * account) does not multiply the attempts: a 4-digit PIN would otherwise fall in about a minute.
     */
    public static function consumePinAttempt(string $username, string $profileId): void {
        self::enforceKey(
            self::pinKey($username, $profileId),
            self::PIN_MAX_ATTEMPTS,
            self::PIN_WINDOW_SECONDS,
            'Demasiados intentos de PIN. Espera unos minutos antes de volver a intentarlo.'
        );
    }

    /** A correct PIN resets the allowance. */
    public static function clearPinAttempts(string $username, string $profileId): void {
        self::clear(self::pinKey($username, $profileId));
    }

    public static function clear(string $key): void {
        $tempDir = rtrim(sys_get_temp_dir(), '/\\') . '/kura_ratelimits';
        $file = $tempDir . '/rl_' . md5($key) . '.json';
        if (file_exists($file)) {
            @unlink($file);
        }
        try {
            require_once __DIR__ . '/../db.php';
            Database::getConnection()->prepare("DELETE FROM rate_limits WHERE k = :k")->execute(['k' => md5($key)]);
        } catch (Throwable $e) {
            // no table / no database: nothing stored there to clear
        }
    }
}
