<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

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
     * Extract token from cookie or HTTP Authorization header
     */
    /** The token of an `Authorization: Bearer ...` header (never the cookie). */
    private static function authorizationBearer(): ?string {
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
     * CSRF: the session cookie is sent by the browser on any request to this origin, including ones a page on
     * another site (or another port of this host) makes on the user's behalf. A page cannot add a custom header
     * to such a request without a CORS preflight, which this server only grants to ALLOWED_ORIGINS. The real
     * clients always send `Authorization: Bearer`; anything that relies on the cookie alone must say so.
     */
    private static function hasCsrfProofHeader(): bool {
        return trim((string)($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) !== '';
    }

    /**
     * Extract token from the Authorization header or the session cookie. The cookie is only honoured for reads
     * (<video>, subtitles, images need it) or when the request carries X-Requested-With.
     */
    public static function getBearerToken(): ?string {
        $bearer = self::authorizationBearer();
        if ($bearer !== null) {
            return $bearer;
        }

        if (!empty($_COOKIE['kurastream_token'])) {
            $safeMethod = in_array(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), ['GET', 'HEAD', 'OPTIONS'], true);
            if (!$safeMethod && !self::hasCsrfProofHeader()) {
                return null;
            }
            return trim($_COOKIE['kurastream_token']);
        }

        return null;
    }

    /**
     * Whether a session must belong to an account that still exists. Always true in production; test suites
     * mint tokens for accounts that were never created, so there it is opt-in (see tests/test_session_revocation.php).
     */
    public static ?bool $strictAccounts = null;

    private static function isStrictAccounts(): bool {
        return self::$strictAccounts ?? !defined('TESTING_MODE');
    }

    /** The administrator configured in the environment has no row in `users`; its token is trusted as issued. */
    private static function isEnvAdmin(array $payload): bool {
        $admin = getenv('ADMIN_USER');
        return ($payload['role'] ?? '') === 'admin'
            && $admin !== false && $admin !== ''
            && strcasecmp((string)($payload['username'] ?? ''), $admin) === 0;
    }

    /**
     * Verifies a SESSION token. Unlike verifyToken() it
     *  - refuses tokens that carry a `type` claim (Watch Party stream/SSE tickets are signed with the same key
     *    and must never be accepted as a login), and
     *  - re-reads the account: a deleted account, a token issued before the last password change / "sign out
     *    everywhere" (token_version), a changed role and a profile's current name and kids flag all take effect
     *    immediately instead of when the 30-day token expires.
     */
    public static function sessionPayload(?string $token): ?array {
        $payload = self::verifyToken($token);
        if (!$payload) {
            return null;
        }
        if (isset($payload['type']) && $payload['type'] !== 'session') {
            return null;
        }
        if (self::isEnvAdmin($payload)) {
            return $payload;
        }

        $username = (string)($payload['username'] ?? '');
        $account = $username !== '' ? DbHelper::getAccountState($username) : null;
        if ($account === null) {
            return self::isStrictAccounts() ? null : $payload;
        }
        if ((int)($payload['ver'] ?? 0) !== $account['token_version']) {
            return null;
        }
        if (!empty($account['disabled'])) {
            return null;   // locked by an administrator: every session ends at once
        }
        $payload['role'] = $account['role'];

        if (!empty($payload['profile_id']) || !empty($payload['profile_name'])) {
            $profile = DbHelper::getSessionProfile($account['username'], $payload['profile_id'] ?? null, $payload['profile_name'] ?? null);
            if ($profile) {
                $payload['profile_id'] = $profile['id'];
                $payload['profile_name'] = $profile['name'];
                $payload['is_kids'] = !empty($profile['is_kids']);
            } elseif (self::isStrictAccounts()) {
                // The profile was deleted: the session is still the account's, but without an active profile.
                unset($payload['profile_id'], $payload['profile_name'], $payload['is_kids']);
            }
        }
        return $payload;
    }

    /**
     * Catalog browsing (shows, episodes, calendar, comments) is open to guests by default, as the web client
     * expects. CATALOG_ACCESS=members makes it require a signed-in session, so an anonymous visitor on the
     * network can neither list the library nor see titles regardless of kids mode.
     */
    public static function requireCatalogAccess(): void {
        if (strtolower(trim((string)getenv('CATALOG_ACCESS'))) === 'members') {
            self::requireAuth();
        }
    }

    /**
     * Enforce Admin Role Check
     */
    public static function requireAdmin(): array {
        // Administration also has GET endpoints with side effects (scans, timing detection), so for any method a
        // cookie-only request must carry the CSRF proof header.
        if (self::authorizationBearer() === null && !self::hasCsrfProofHeader()) {
            jsonError('Acceso denegado: Token inválido o expirado', 401);
        }
        $token = self::getBearerToken();
        $payload = self::sessionPayload($token);

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
        $payload = self::sessionPayload($token);

        if (!$payload) {
            jsonError('Acceso denegado: Se requiere iniciar sesión', 401);
        }

        return $payload;
    }

    /**
     * Enforce User Authentication AND Active Profile Check
     */
    public static function requireProfile(): array {
        $payload = self::requireAuth();

        if (empty($payload['profile_id']) && empty($payload['profile_name'])) {
            jsonError('Selección de perfil requerida', 403, ['code' => 'PROFILE_REQUIRED']);
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
