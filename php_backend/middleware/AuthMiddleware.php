<?php
require_once __DIR__ . '/../config.php';

class AuthMiddleware {
    /**
     * Create a signed token with HMAC-SHA256
     */
    public static function createToken(array $payload): string {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $base64Header = self::base64UrlEncode(json_encode($header));
        $base64Payload = self::base64UrlEncode(json_encode($payload));
        $signature = hash_hmac('sha256', "{$base64Header}.{$base64Payload}", JWT_SECRET, true);
        $base64Signature = self::base64UrlEncode($signature);

        return "{$base64Header}.{$base64Payload}.{$base64Signature}";
    }

    /**
     * Verify and decode token
     */
    public static function verifyToken(?string $token): ?array {
        if (empty($token)) {
            return null;
        }

        // Reject token if not 3 parts
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        list($base64Header, $base64Payload, $base64Signature) = $parts;
        $expectedSignature = self::base64UrlEncode(hash_hmac('sha256', "{$base64Header}.{$base64Payload}", JWT_SECRET, true));

        if (!hash_equals($expectedSignature, $base64Signature)) {
            return null;
        }

        $payload = json_decode(self::base64UrlDecode($base64Payload), true);
        if (!$payload) {
            return null;
        }

        if (isset($payload['exp']) && $payload['exp'] < time()) {
            return null;
        }

        return $payload;
    }

    /**
     * Extract token from HTTP Authorization header
     */
    public static function getBearerToken(): ?string {
        $headers = null;
        if (isset($_SERVER['Authorization'])) {
            $headers = trim($_SERVER['Authorization']);
        } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers = trim($_SERVER['HTTP_AUTHORIZATION']);
        } elseif (function_exists('apache_request_headers')) {
            $requestHeaders = apache_request_headers();
            $headers = $requestHeaders['Authorization'] ?? $requestHeaders['authorization'] ?? null;
        }

        if ($headers && preg_match('/Bearer\s+(.*)$/i', $headers, $matches)) {
            return $matches[1];
        }

        return null;
    }

    /**
     * Enforce Admin Role Check
     */
    public static function requireAdmin(): array {
        $token = self::getBearerToken();
        $payload = self::verifyToken($token);

        if (!$payload) {
            jsonError('Acceso denegado: Token inválido o expirado', 401);
        }

        if (($payload['role'] ?? '') !== 'admin') {
            jsonError('Acceso denegado: Permisos administrativos requeridos', 403);
        }

        return $payload;
    }

    /**
     * Enforce User Authentication Check
     */
    public static function requireAuth(): array {
        $token = self::getBearerToken();
        $payload = self::verifyToken($token);

        if (!$payload) {
            jsonError('Acceso denegado: Se requiere iniciar sesión', 401);
        }

        return $payload;
    }

    private static function base64UrlEncode(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4));
    }
}
