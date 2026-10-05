<?php
// Global Configuration for KuraStream PHP Backend

class ExitException extends RuntimeException {
    public int $statusCode;
    public $data;
    public function __construct(string $message = '', int $statusCode = 200, $data = null) {
        parent::__construct($message);
        $this->statusCode = $statusCode;
        $this->data = $data;
    }
}

// Load .env file if present in project root
$envFile = dirname(__DIR__) . '/.env';
if (file_exists($envFile) && is_readable($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) continue;
        if (str_contains($line, '=')) {
            list($k, $v) = explode('=', $line, 2);
            $k = trim($k);
            $v = trim($v, " \t\n\r\0\x0B\"'");
            if (!getenv($k)) {
                putenv("{$k}={$v}");
                $_ENV[$k] = $v;
            }
        }
    }
}

define('DB_HOST', getenv('DB_HOST') ?: '127.0.0.1');
define('DB_PORT', getenv('DB_PORT') ?: '3306');
define('DB_NAME', getenv('DB_NAME') ?: 'kurastream');
define('DB_USER', getenv('DB_USER') ?: 'kurastream');
define('DB_PASS', getenv('DB_PASS') !== false ? getenv('DB_PASS') : '');

/**
 * Returns a human readable problem when the JWT secret is unsafe, or null when it is acceptable.
 * Tokens (including admin ones) are only as trustworthy as this secret: with a published
 * placeholder such as the one in .env.example anybody could forge an administrator token.
 */
if (!function_exists('kuraJwtSecretProblem')) {
    function kuraJwtSecretProblem(string $secret): ?string {
        if (strlen($secret) < 32) {
            return 'JWT_SECRET must be at least 32 characters long (generate one with: openssl rand -hex 32).';
        }
        $lower = strtolower($secret);
        foreach (['change_me', 'changeme', 'change-me', 'replace_me', 'replace-me', 'your_secret', 'your-secret', 'your_jwt', 'your-jwt'] as $placeholder) {
            if (str_contains($lower, $placeholder)) {
                return 'JWT_SECRET still contains a placeholder value; set a random secret (openssl rand -hex 32).';
            }
        }
        if (count(array_unique(str_split($secret))) < 8) {
            return 'JWT_SECRET is too repetitive; set a random secret (openssl rand -hex 32).';
        }
        return null;
    }
}

/**
 * True when the configured administrator password is an obvious placeholder/default value
 * (for example the "change_me" shipped in .env.example). Such a password must never authenticate.
 */
if (!function_exists('kuraAdminPasswordIsPlaceholder')) {
    function kuraAdminPasswordIsPlaceholder(string $password): bool {
        return in_array(strtolower(trim($password)), [
            'change_me', 'changeme', 'change-me', 'replace_me', 'admin', 'password', 'admin123', '12345678', '123456789', 'kurastream',
        ], true);
    }
}

// Require a strong JWT_SECRET in production
$jwtSecret = getenv('JWT_SECRET');
if (empty($jwtSecret)) {
    if (php_sapi_name() === 'cli' || defined('TESTING_MODE')) {
        $jwtSecret = 'test_dev_jwt_secret_key_random_' . md5(__DIR__);
    } else {
        http_response_code(500);
        die(json_encode(['error' => 'JWT_SECRET environment variable is missing and must be configured.']));
    }
} else {
    $jwtSecretProblem = kuraJwtSecretProblem($jwtSecret);
    if ($jwtSecretProblem !== null) {
        error_log('[KuraStream] ' . $jwtSecretProblem);
        if (php_sapi_name() === 'cli') {
            fwrite(STDERR, '[KuraStream] ' . $jwtSecretProblem . PHP_EOL);
            exit(1);
        }
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        die(json_encode(['error' => 'Server misconfigured: ' . $jwtSecretProblem]));
    }
}
define('JWT_SECRET', $jwtSecret);
define('PASSWORD_SALT', getenv('PASSWORD_SALT') ?: 'kurasalt');

define('ROOT_DIR', dirname(__DIR__));

// Local time zone for user-facing dates (calendar weekdays). PHP defaults to UTC, which files
// shows airing after 19:00 in the Americas under the next day.
$appTimezone = getenv('APP_TIMEZONE') ?: '';
if ($appTimezone !== '' && in_array($appTimezone, timezone_identifiers_list(), true)) {
    date_default_timezone_set($appTimezone);
}
$trustedProxies = getenv('TRUSTED_PROXIES') ?: '';
define('TRUSTED_PROXIES', array_filter(array_map('trim', explode(',', $trustedProxies))));

$configuredMediaPath = getenv('MEDIA_LIBRARY_PATH');
if (!empty($configuredMediaPath)) {
    if (!str_starts_with($configuredMediaPath, '/') && !preg_match('#^[a-zA-Z]:[/\\\\]#', $configuredMediaPath)) {
        $configuredMediaPath = ROOT_DIR . '/' . ltrim($configuredMediaPath, './');
    }
    define('LIBRARY_DIR', rtrim($configuredMediaPath, '/\\'));
} else {
    define('LIBRARY_DIR', ROOT_DIR . '/library');
}

/**
 * Whether the browser reached us over HTTPS (cookies get the Secure flag). nginx passes HTTPS through FastCGI;
 * X-Forwarded-Proto is only believed from a configured TRUSTED_PROXIES address, so a client cannot claim it.
 */
function kuraIsSecureRequest(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    if ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }
    $forwarded = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    return $forwarded === 'https' && in_array($_SERVER['REMOTE_ADDR'] ?? '', TRUSTED_PROXIES, true);
}

// Security and CSP headers. One list feeds both PHP (setSecurityHeaders) and nginx, which serves the static files
// itself: deploy/nginx/security-headers.conf is generated from it (php_backend/scripts/print_security_headers.php)
// and tests/test_nginx_deploy.php fails when the two drift apart.
function kuraSecurityHeaders(): array {
    return [
        'X-Content-Type-Options' => 'nosniff',
        'X-Frame-Options' => 'DENY',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy' => implode(' ', [
            "default-src 'self';",
            // No inline scripts and no eval: an injected <script> or onclick="" cannot run. 'wasm-unsafe-eval' lets the
            // subtitle renderer (libass compiled to WebAssembly) use its fast engine instead of the 4.8 MB asm.js one.
            "script-src 'self' 'wasm-unsafe-eval' blob:;",
            "worker-src 'self' blob:;",
            // Dynamic style="" attributes (avatars, progress bars) still need inline styles.
            "style-src 'self' 'unsafe-inline';",
            "img-src 'self' data: blob: https://image.tmdb.org https://s4.anilist.co;",
            "media-src 'self' blob:;",
            "connect-src 'self';",
            "font-src 'self';",
            "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com;",
            "object-src 'none';",
            "base-uri 'self';",
            "form-action 'self';",
            "frame-ancestors 'none';",
        ]),
    ];
}

function setSecurityHeaders(): void {
    foreach (kuraSecurityHeaders() as $name => $value) {
        @header("{$name}: {$value}");
    }
}

// Set JSON headers and CORS
function setCorsHeaders() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigins = array_filter(array_map('trim', explode(',', getenv('ALLOWED_ORIGINS') ?: '')));

    if (!empty($allowedOrigins)) {
        if (in_array($origin, $allowedOrigins, true)) {
            @header("Access-Control-Allow-Origin: {$origin}");
        }
    } else {
        // Safe default: only match localhost, 127.0.0.1, or local LAN IP origins if request origin matches
        if ($origin && preg_match('#^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$#', $origin)) {
            @header("Access-Control-Allow-Origin: {$origin}");
        }
    }

    @header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    @header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Stream-Capability, X-SSE-Ticket, X-Party-Member-Id, X-Party-Member-Token');
    @header('Vary: Origin');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        @http_response_code(200);
        if (defined('TESTING_MODE')) {
            throw new ExitException('OPTIONS 200', 200);
        }
        exit();
    }
}

/**
 * Database timestamps ("2026-10-05 14:03:00", always UTC: see Database::getConnection) leave the API as ISO-8601 with
 * a zone ("2026-10-05T14:03:00Z"), so a browser or phone in any time zone shows the right local time. Only string
 * values of keys that are timestamps (`*_at`, `timestamp`, `last_ping`) in that exact format are converted.
 */
function kuraIsoDates($data) {
    if (!is_array($data)) {
        return $data;
    }
    foreach ($data as $key => $value) {
        if (is_array($value)) {
            $data[$key] = kuraIsoDates($value);
        } elseif (is_string($value) && is_string($key)
            && ($key === 'timestamp' || $key === 'last_ping' || str_ends_with($key, '_at'))
            && preg_match('/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?$/', $value, $m)) {
            $data[$key] = $m[1] . 'T' . $m[2] . 'Z';
        }
    }
    return $data;
}

/**
 * @param bool $revalidate send an ETag and answer 304 when the client already has this exact body. For read-mostly,
 *                         per-viewer lists (the catalogue): `Cache-Control: private, no-cache` makes the browser ask
 *                         every time, and an unchanged answer costs a few bytes instead of the whole list.
 */
function jsonResponse($data, $statusCode = 200, bool $revalidate = false) {
    $data = kuraIsoDates($data);
    setCorsHeaders();
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($revalidate && $statusCode === 200) {
        $etag = '"' . md5($json) . '"';
        @header('ETag: ' . $etag);
        @header('Cache-Control: private, no-cache');
        $sent = trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
        if ($sent !== '' && in_array($etag, array_map('trim', explode(',', str_replace('W/', '', $sent))), true)) {
            @http_response_code(304);
            if (defined('TESTING_MODE')) {
                throw new ExitException('', 304, $data);
            }
            exit();
        }
    }
    @http_response_code($statusCode);
    @header('Content-Type: application/json; charset=utf-8');
    echo $json;
    if (defined('TESTING_MODE')) {
        throw new ExitException($json, $statusCode, $data);
    }
    exit();
}

function jsonError($message, $statusCode = 400, array $extra = []) {
    $payload = array_merge(['error' => $message], $extra);
    jsonResponse($payload, $statusCode);
}

// Global error handling: never leak stack traces, paths or SQL to clients (web entrypoint only; the CLI and the
// test suites keep PHP's default behaviour so failures stay visible there).
require_once __DIR__ . '/error_handling.php';
if (php_sapi_name() !== 'cli' && !defined('TESTING_MODE')) {
    kuraInstallErrorHandlers();
}
