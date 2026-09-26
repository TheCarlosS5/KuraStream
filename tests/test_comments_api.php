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

$token = AuthMiddleware::createToken(['username' => 'testuser', 'role' => 'user', 'profile_name' => 'Principal', 'exp' => time() + 3600]);
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

// 7. Probar verificación referencial de show y episodio
$showControllerCode = file_get_contents(__DIR__ . '/../php_backend/controllers/ShowController.php');
assert(str_contains($showControllerCode, "DbHelper::getShow(\$showId)"), "addComment must verify show exists in DB");
assert(str_contains($showControllerCode, "\$ep['show_id'] !== \$showId"), "addComment must verify episode belongs to show");

// 8. Integration / Routing test: Dispatched via router.php to ensure no double rate limiting
$routerCode = file_get_contents(__DIR__ . '/../php_backend/router.php');
assert(!str_contains($routerCode, "RateLimiter::enforce('comment'"), "router.php MUST NOT enforce comment rate limiting (must be solely in ShowController::addComment)");

RateLimiter::clear("comment_{$ip}");
$routerRateLimitOccurredAt = null;
$statuses = [];

try {
    $db = Database::getConnection();
    $db->exec("INSERT IGNORE INTO shows (id, title, synopsis, rating, year) VALUES ('test_show_rate', 'Rate Test Show', 'Desc', 8.0, 2026)");
} catch (Throwable $e) {
    // DB offline on host
}

for ($i = 1; $i <= 6; $i++) {
    $_SERVER['REQUEST_URI'] = '/api/comments';
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_COOKIE['kurastream_token'] = $token;
    $GLOBALS['_MOCKED_JSON_INPUT'] = ['show_id' => 'test_show_rate', 'content' => "Comment #{$i}"];

    try {
        ob_start();
        require __DIR__ . '/../php_backend/router.php';
        $rawOut = ob_get_clean();
        $statuses[$i] = 200;
    } catch (ExitException $e) {
        if (ob_get_level()) {
            ob_end_clean();
        }
        $statuses[$i] = $e->statusCode;
        if ($e->statusCode === 429) {
            $routerRateLimitOccurredAt = $i;
            break;
        }
    } catch (Throwable $e) {
        if (ob_get_level()) {
            ob_end_clean();
        }
        $statuses[$i] = 500;
    }
}

try {
    $db = Database::getConnection();
    $db->exec("DELETE FROM comments WHERE show_id = 'test_show_rate'");
    $db->exec("DELETE FROM shows WHERE id = 'test_show_rate'");
} catch (Throwable $e) {
    //
}

for ($i = 1; $i <= 5; $i++) {
    assert(isset($statuses[$i]) && $statuses[$i] !== 429, "Request #{$i} through router.php must NOT be 429, got {$statuses[$i]}");
}
assert($routerRateLimitOccurredAt === 6, "Through router.php, first 5 requests must pass rate limiting; 6th request must trigger 429. Triggered at: " . var_export($routerRateLimitOccurredAt, true));
RateLimiter::clear("comment_{$ip}");

echo "✓ Comments Alignment Tests Passed\n";
