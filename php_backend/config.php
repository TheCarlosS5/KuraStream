<?php
// Global Configuration for KuraStream PHP Backend

define('DB_HOST', getenv('DB_HOST') ?: '127.0.0.1');
define('DB_PORT', getenv('DB_PORT') ?: '3306');
define('DB_NAME', getenv('DB_NAME') ?: 'kurastream');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: 'root');

define('JWT_SECRET', getenv('JWT_SECRET') ?: 'kurastream_jwt_secret_key_2026');
define('PASSWORD_SALT', getenv('PASSWORD_SALT') ?: 'kurasalt');

define('ROOT_DIR', dirname(__DIR__));
define('LIBRARY_DIR', ROOT_DIR . '/library');

// Set JSON headers and CORS
function setCorsHeaders() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigins = array_filter(explode(',', getenv('ALLOWED_ORIGINS') ?: ''));

    if (!empty($allowedOrigins)) {
        if (in_array($origin, $allowedOrigins, true)) {
            header("Access-Control-Allow-Origin: {$origin}");
        }
    } else {
        header('Access-Control-Allow-Origin: ' . ($origin ?: '*'));
    }

    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

function jsonResponse($data, $statusCode = 200) {
    setCorsHeaders();
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}

function jsonError($message, $statusCode = 400) {
    jsonResponse(['error' => $message], $statusCode);
}
