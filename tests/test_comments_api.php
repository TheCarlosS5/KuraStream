<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';

echo "Running Comments Alignment Tests...\n";

// 1. Probar que getComments acepta parámetro 'showId' tanto como 'show_id'
$_GET = ['showId' => 'test_show_123'];
$failedOnMissingShowId = false;
try {
    ShowController::getComments();
} catch (ExitException $e) {
    if ($e->statusCode === 400 && str_contains($e->getMessage(), 'show_id requerido')) {
        $failedOnMissingShowId = true;
    }
} catch (PDOException $e) {
    // Reaching database query confirms showId was accepted
}
assert(!$failedOnMissingShowId, "getComments must accept 'showId' fallback without 400 'show_id requerido'");

// 2. Probar que getComments rechaza petición sin show_id ni showId
$_GET = [];
$missingShowIdCaught = false;
try {
    ShowController::getComments();
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $missingShowIdCaught = true;
    }
}
assert($missingShowIdCaught, "getComments must reject request with 400 when show_id and showId are absent");

// 3. Probar que addComment exige autenticación
$unauth = false;
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);
try {
    ShowController::addComment();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauth = true;
    }
}
assert($unauth, "addComment must reject unauthenticated requests with 401");

// 4. Probar rate limiting en addComment (RateLimiter::enforce('comment', 5, 60))
$ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
RateLimiter::clear("comment_{$ip}");

$token = AuthMiddleware::createToken(['username' => 'testuser', 'role' => 'user', 'exp' => time() + 3600]);
$_COOKIE['kurastream_token'] = $token;

$rateLimited = false;
for ($i = 0; $i < 6; $i++) {
    try {
        ShowController::addComment();
    } catch (ExitException $e) {
        if ($e->statusCode === 429) {
            $rateLimited = true;
            break;
        }
    }
}
assert($rateLimited, "addComment must enforce rate limiting (5 attempts per minute) and reject 6th attempt with 429");

// Limpiar rate limit para las siguientes pruebas
RateLimiter::clear("comment_{$ip}");

// 5. Probar validación de longitud máxima (1000 caracteres)
$longCommentCaught = false;
$longContent = str_repeat('a', 1001);
try {
    ShowController::addComment(['show_id' => 'test_123', 'content' => $longContent]);
} catch (ExitException $e) {
    if ($e->statusCode === 400 && str_contains($e->getMessage(), '1000 caracteres')) {
        $longCommentCaught = true;
    }
}
assert($longCommentCaught, "addComment must reject comments longer than 1000 characters with 400");

// 6. Probar que addComment acepta alias de parámetros ('showId' y 'comment')
$missingParamsCaught = false;
try {
    ShowController::addComment(['showId' => 'test_123', 'comment' => 'comentario valido']);
} catch (ExitException $e) {
    if ($e->statusCode === 400 && str_contains($e->getMessage(), 'requeridos')) {
        $missingParamsCaught = true;
    }
} catch (PDOException $e) {
    // Reaching database insert confirms aliases were accepted
}
assert(!$missingParamsCaught, "addComment must accept 'showId' and 'comment' parameter aliases");

echo "✓ Comments Alignment Tests Passed\n";
