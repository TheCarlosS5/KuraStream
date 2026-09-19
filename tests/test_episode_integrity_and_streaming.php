<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running Episode Integrity & Streaming Protection Tests...\n";

// 1. Probar validación de episodio inexistente
$reflector = new ReflectionClass('AdminController');
$method = $reflector->getMethod('validateStagedEpisode');
$method->setAccessible(true);

$caught = false;
try {
    $method->invoke(null, 'C:/ruta/falsa/video_que_no_existe.mkv');
} catch (ExitException $e) {
    if ($e->statusCode === 422) {
        $caught = true;
    }
}
assert($caught, "validateStagedEpisode must fail with 422 for nonexistent file");

// 2. Probar validación de archivo menor a 1MB
$tmpSmall = tempnam(sys_get_temp_dir(), 'kura_small_');
file_put_contents($tmpSmall, str_repeat('A', 500)); // 500 bytes
$caughtSmall = false;
try {
    $method->invoke(null, $tmpSmall);
} catch (ExitException $e) {
    if ($e->statusCode === 422) {
        $caughtSmall = true;
    }
}
@unlink($tmpSmall);
assert($caughtSmall, "validateStagedEpisode must fail with 422 for file < 1MB");

// 3. Probar validación de archivo válido (>= 1MB)
$tmpValid = tempnam(sys_get_temp_dir(), 'kura_valid_');
$fp = fopen($tmpValid, 'wb');
fseek($fp, 1024 * 1024 + 10);
fwrite($fp, 'end');
fclose($fp);
$validMeta = $method->invoke(null, $tmpValid);
@unlink($tmpValid);
assert(is_array($validMeta) && $validMeta['valid'] === true && $validMeta['size'] >= 1024 * 1024, "validateStagedEpisode must return valid metadata for >= 1MB file");

// 4. Probar rechazo de path traversal en PlayerController::streamVideo
$traversalCaughtSlash = false;
try {
    PlayerController::streamVideo('../secret/video.mp4');
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $traversalCaughtSlash = true;
    }
}
assert($traversalCaughtSlash, "streamVideo must reject path traversal with '/' with 400");

$traversalCaughtBackslash = false;
try {
    PlayerController::streamVideo('..\\secret\\video.mp4');
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $traversalCaughtBackslash = true;
    }
}
assert($traversalCaughtBackslash, "streamVideo must reject path traversal with '\\' with 400");

$emptyIdCaught = false;
try {
    PlayerController::streamVideo('');
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $emptyIdCaught = true;
    }
}
assert($emptyIdCaught, "streamVideo must reject empty episode ID with 400");

// 5. Probar que streamVideo verifica la existencia en base de datos
class MockEpisodeStatement extends PDOStatement {
    public function __construct() {}
    #[\ReturnTypeWillChange]
    public function execute(?array $params = null): bool {
        return true;
    }
    #[\ReturnTypeWillChange]
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed {
        // Return false to simulate episode not found in catalog
        return false;
    }
}

class MockEpisodeDb extends PDO {
    public function __construct() {}
    #[\ReturnTypeWillChange]
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return new MockEpisodeStatement();
    }
}

$refPdo = new ReflectionProperty('Database', 'pdo');
$refPdo->setAccessible(true);
$refPdo->setValue(null, new MockEpisodeDb());

$notFoundCaught = false;
try {
    PlayerController::streamVideo('nonexistent_episode_id');
} catch (ExitException $e) {
    if ($e->statusCode === 404) {
        $notFoundCaught = true;
    }
}
assert($notFoundCaught, "streamVideo must return 404 when episode is not in the database");

// 6. Probar bloqueo de descarga directa de vídeo en router.php (/library/...)
$_SERVER['REQUEST_URI'] = '/library/Anime/test.mp4';
$_SERVER['REQUEST_METHOD'] = 'GET';
$caughtDirect = false;
try {
    require __DIR__ . '/../php_backend/router.php';
} catch (ExitException $e) {
    if ($e->statusCode === 403) {
        $caughtDirect = true;
    }
}
assert($caughtDirect, "Direct video download under /library/ must be blocked with 403 in router.php");

// 7. Probar que serveStaticFile rechaza archivos de video directamente
if (!is_dir(LIBRARY_DIR)) {
    @mkdir(LIBRARY_DIR, 0777, true);
}
$dummyVideo = LIBRARY_DIR . '/direct_test_dummy.mkv';
file_put_contents($dummyVideo, 'dummy');
$servedResult = serveStaticFile(LIBRARY_DIR, 'direct_test_dummy.mkv');
@unlink($dummyVideo);
assert($servedResult === false, "serveStaticFile must return false and refuse to serve video files");

echo "✓ Episode Integrity & Streaming Protection Tests Passed\n";
