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

// Require JWT_SECRET in production
$jwtSecret = getenv('JWT_SECRET');
if (empty($jwtSecret)) {
    if (php_sapi_name() === 'cli' || defined('TESTING_MODE')) {
        $jwtSecret = 'test_dev_jwt_secret_key_random_' . md5(__DIR__);
    } else {
        http_response_code(500);
        die(json_encode(['error' => 'JWT_SECRET environment variable is missing and must be configured.']));
    }
}
define('JWT_SECRET', $jwtSecret);
define('PASSWORD_SALT', getenv('PASSWORD_SALT') ?: 'kurasalt');

define('ROOT_DIR', dirname(__DIR__));

$configuredMediaPath = getenv('MEDIA_LIBRARY_PATH');
if (!empty($configuredMediaPath)) {
    if (!str_starts_with($configuredMediaPath, '/') && !preg_match('#^[a-zA-Z]:[/\\\\]#', $configuredMediaPath)) {
        $configuredMediaPath = ROOT_DIR . '/' . ltrim($configuredMediaPath, './');
    }
    define('LIBRARY_DIR', rtrim($configuredMediaPath, '/\\'));
} else {
    define('LIBRARY_DIR', ROOT_DIR . '/library');
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
    @header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        @http_response_code(200);
        if (defined('TESTING_MODE')) {
            throw new ExitException('OPTIONS 200', 200);
        }
        exit();
    }
}

function jsonResponse($data, $statusCode = 200) {
    setCorsHeaders();
    @http_response_code($statusCode);
    @header('Content-Type: application/json; charset=utf-8');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    echo $json;
    if (defined('TESTING_MODE')) {
        throw new ExitException($json, $statusCode, $data);
    }
    exit();
}

function jsonError($message, $statusCode = 400) {
    jsonResponse(['error' => $message], $statusCode);
}
