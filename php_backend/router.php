<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/middleware/AuthMiddleware.php';
require_once __DIR__ . '/middleware/RateLimiter.php';
require_once __DIR__ . '/controllers/AuthController.php';
require_once __DIR__ . '/controllers/ShowController.php';
require_once __DIR__ . '/controllers/PlayerController.php';
require_once __DIR__ . '/controllers/CalendarController.php';
require_once __DIR__ . '/controllers/HistoryController.php';
require_once __DIR__ . '/controllers/AdminController.php';
require_once __DIR__ . '/controllers/AdminUsersController.php';
require_once __DIR__ . '/controllers/PartyController.php';
require_once __DIR__ . '/controllers/AppDownloadController.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
setSecurityHeaders();

// Query and form parameters are always scalars in this API. An array-shaped one (?type[]=x) would crash
// string functions with a TypeError deep inside a controller, so refuse it at the door.
foreach ([$_GET, $_POST] as $__params) {
    foreach ($__params as $__value) {
        if (is_array($__value)) {
            jsonError('Parámetros de solicitud inválidos', 400);
        }
    }
}
foreach ($_COOKIE as $__name => $__value) {
    if (is_array($__value)) {
        unset($_COOKIE[$__name]);
    }
}
unset($__params, $__value, $__name);

// A NUL or other control byte (also percent-encoded: %00) in the path has no legitimate use here. It used to reach
// realpath()/filesystem calls, which throw a ValueError (a 500 for every such request): refuse it at the door.
if (is_string($uri) && preg_match('/[\x00-\x1F\x7F]/', rawurldecode($uri))) {
    jsonError('Ruta no válida', 400);
}

$appStartTime = microtime(true);
register_shutdown_function(function() use ($appStartTime, $uri) {
    if (!headers_sent() && $uri !== null && str_starts_with($uri, '/api/')) {
        $ms = round((microtime(true) - $appStartTime) * 1000);
        header("X-Response-Time: {$ms}ms");
    }
});

// Serve static frontend files and library media directly
$frontendDir = ROOT_DIR . '/frontend';
$libraryDir = LIBRARY_DIR;

if (!function_exists('serveStaticFile')) {
    /** Serve a request-relative file only when its canonical path stays below $root. */
    function serveStaticFile(string $root, string $relativePath, ?string $cacheControl = null): bool {
        $realRoot = realpath($root);
        if ($realRoot === false) {
            return false;
        }

        $candidate = realpath($realRoot . DIRECTORY_SEPARATOR . ltrim($relativePath, '/\\'));
        $rootPrefix = rtrim($realRoot, '/\\') . DIRECTORY_SEPARATOR;
        if ($candidate === false || !is_file($candidate) || !str_starts_with($candidate, $rootPrefix)) {
            return false;
        }

        // Direct raw video files must NOT be served via serveStaticFile under library
        $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
        $videoExts = ['mkv', 'mp4', 'webm', 'ts', 'avi', 'mov', 'm4v'];
        if (in_array($ext, $videoExts, true)) {
            return false;
        }

        $mime = mime_content_type($candidate) ?: 'application/octet-stream';
        if (str_ends_with($candidate, '.css')) $mime = 'text/css';
        if (str_ends_with($candidate, '.js')) $mime = 'application/javascript';
        header("Content-Type: {$mime}");
        if ($cacheControl === null) {
            $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
            if (in_array($ext, ['css', 'js', 'woff2', 'svg', 'png', 'jpg', 'jpeg', 'webp'])) {
                $cacheControl = 'public, max-age=86400';
            } elseif ($ext === 'html') {
                $cacheControl = 'no-cache, no-store, must-revalidate';
            }
        }
        if ($cacheControl !== null) header("Cache-Control: {$cacheControl}");
        readfile($candidate);
        exit();
    }
}

if (!function_exists('serveBackdropLoop')) {
    /**
     * Serves a show's ambient background clip (library/<Anime|Movies>/<show>/loop_*.mp4|webm) with HTTP Range
     * support. Browsers need byte ranges to loop and seek a video; plain readfile() made them fail, and the
     * blanket "no video from /library" rule blocked the clips altogether. Only this exact file shape is served.
     */
    function serveBackdropLoop(string $root, string $relativePath): void {
        $realRoot = realpath($root);
        $file = $realRoot !== false ? realpath($realRoot . DIRECTORY_SEPARATOR . $relativePath) : false;
        if ($file === false || !is_file($file) || !str_starts_with($file, rtrim($realRoot, '/\\') . DIRECTORY_SEPARATOR)) {
            return; // not found: the caller falls through to the normal 404
        }

        $size = filesize($file);
        $start = 0;
        $end = max(0, $size - 1);
        $status = 200;
        $range = $_SERVER['HTTP_RANGE'] ?? '';
        if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $m) && ($m[1] !== '' || $m[2] !== '')) {
            if ($m[1] === '') {                       // suffix range: the last N bytes
                $start = max(0, $size - (int)$m[2]);
            } else {
                $start = (int)$m[1];
                if ($m[2] !== '') $end = min((int)$m[2], $size - 1);
            }
            if ($size === 0 || $start > $end || $start >= $size || ($m[1] === '' && (int)$m[2] === 0)) {
                http_response_code(416);
                header("Content-Range: bytes */{$size}");
                exit();
            }
            $status = 206;
            header("Content-Range: bytes {$start}-{$end}/{$size}");
        }
        // Any other Range syntax (multiple ranges, units) is ignored and the whole file is sent, as the RFC allows.

        $length = $size === 0 ? 0 : $end - $start + 1;
        http_response_code($status);
        header('Content-Type: ' . (str_ends_with(strtolower($file), '.webm') ? 'video/webm' : 'video/mp4'));
        header('Accept-Ranges: bytes');
        header('Content-Length: ' . $length);
        header('Cache-Control: public, max-age=3600');
        header('X-Content-Type-Options: nosniff');
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD' || $length === 0) {
            exit();
        }

        $fp = fopen($file, 'rb');
        fseek($fp, $start);
        while ($length > 0 && !feof($fp) && !connection_aborted()) {
            $chunk = fread($fp, min(65536, $length));
            if ($chunk === false || $chunk === '') break;
            echo $chunk;
            $length -= strlen($chunk);
            flush();
        }
        fclose($fp);
        exit();
    }
}

// `npm run build` writes frontend/dist (hashed, minified files). It is served automatically when present;
// KURA_USE_DIST=0 serves the readable sources instead (development, E2E tests).
$distDir = $frontendDir . '/dist';
$useDist = getenv('KURA_USE_DIST') !== '0' && is_file($distDir . '/index.html');

if ($uri === '/' || $uri === '/index.html') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    readfile($useDist ? $distDir . '/index.html' : $frontendDir . '/index.html');
    exit();
}

if ($useDist && $uri === '/sw.js') {
    // The service worker must live at the root to control the whole site; the built one lists this build's files.
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-cache');
    header('Service-Worker-Allowed: /');
    readfile($distDir . '/sw.js');
    exit();
}

$decodedUri = urldecode($uri);

// Hashed build files never change: cache them for a year.
if (str_starts_with($decodedUri, '/dist/')) {
    serveStaticFile($frontendDir, $decodedUri, 'public, max-age=31536000, immutable');
}

serveStaticFile($frontendDir, $decodedUri);

// The header asks for /library/logo.png (an admin can upload one); without it, serve the bundled
// KS mark instead of a 404 on every page load.
if ($decodedUri === '/library/logo.png' && !is_file($libraryDir . '/logo.png')) {
    serveStaticFile($frontendDir, '/assets/branding/icon-64.png', 'public, max-age=3600');
}

if (str_starts_with($decodedUri, '/library/')) {
    $rel = substr($decodedUri, strlen('/library/'));
    $relPath = parse_url($rel, PHP_URL_PATH) ?: $rel;
    $ext = strtolower(pathinfo($relPath, PATHINFO_EXTENSION));

    // Ambient background clips are the one kind of video the library serves directly.
    if (preg_match('#^(Anime|Movies)/(?!\.{1,2}/)[^/]+/loop_[A-Za-z0-9_.-]+\.(mp4|webm)$#i', $relPath)) {
        serveBackdropLoop($libraryDir, $relPath);
    }

    $videoExts = ['mkv', 'mp4', 'webm', 'ts', 'avi', 'mov', 'm4v'];
    if (in_array($ext, $videoExts, true)) {
        jsonError('Direct video download forbidden. Use /api/stream/{id}', 403);
    }
    // Allow-list, not block-list: artwork and avatars only. Sidecar subtitles, other containers (.mka, .m2ts,
    // .flv...), notes and anything a scan or upload leaves behind must not be downloadable by URL. SVG is excluded
    // on purpose: served from this origin it would be active content.
    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true)) {
        jsonError('Tipo de archivo no permitido', 403);
    }
    serveStaticFile($libraryDir, $rel, 'public, max-age=3600');
    serveStaticFile($libraryDir, str_replace('_', ' ', $rel), 'public, max-age=3600');
    serveStaticFile($libraryDir, str_replace(' ', '_', $rel), 'public, max-age=3600');
    // Preset avatars ship with the repository, which is not the media library when MEDIA_LIBRARY_PATH points elsewhere.
    if (str_starts_with($rel, 'avatars/presets/')) {
        serveStaticFile(ROOT_DIR . '/library', $rel, 'public, max-age=86400');
    }
}

// API Routes
setCorsHeaders();

if ($uri === '/api/login' && $method === 'POST') {
    RateLimiter::enforce('auth', 10, 300);
    AuthController::login();
}

if ($uri === '/api/register' && $method === 'POST') {
    RateLimiter::enforce('auth', 10, 300);
    // Per address; behind a reverse proxy set TRUSTED_PROXIES or every user shares one bucket.
    RateLimiter::enforce('register', max(1, (int)(getenv('REGISTER_MAX_PER_HOUR') ?: 5)), 3600);
    AuthController::register();
}

if ($uri === '/api/logout' && $method === 'POST') {
    AuthController::logout();
}

if ($uri === '/api/account/password' && $method === 'POST') {
    AuthController::changePassword();
}

if ($uri === '/api/account/logout-all' && $method === 'POST') {
    AuthController::logoutAll();
}

if ($uri === '/api/health' && $method === 'GET') {
    $response = [
        'success' => true,
        'status' => 'healthy',
        'database' => 'connected',
        'storage' => is_readable(LIBRARY_DIR) ? 'readable' : 'unreadable',
        'timestamp' => date('c')
    ];
    $healthStatusCode = 200;

    try {
        try {
            Database::$throwOnConnectFailure = true;
            $db = Database::getConnection();
        } finally {
            Database::$throwOnConnectFailure = false;   // PHP-FPM reuses the process: never leave it set
        }
        $db->query('SELECT 1');
        if (Database::migrationProblem() !== null) {
            // A schema update failed: the app may be missing columns, so the operator has to look at the log.
            $healthStatusCode = 503;
            $response['success'] = false;
            $response['status'] = 'degraded';
            $response['migrations'] = 'failed';
        }
    } catch (Throwable $e) {
        @http_response_code(503);
        $response['success'] = false;
        $response['status'] = 'degraded';
        $response['database'] = 'disconnected';
        echo json_encode($response);
        if (defined('TESTING_MODE')) throw new ExitException(json_encode($response), 503, $response);
        exit();
    }

    // The runtime version helps an attacker pick exploits; only administrators get it.
    $healthSession = AuthMiddleware::sessionPayload(AuthMiddleware::getBearerToken());
    if ($healthSession && ($healthSession['role'] ?? '') === 'admin') {
        $response['php_version'] = PHP_VERSION;
    }
    jsonResponse($response, $healthStatusCode);
}

if ($uri === '/api/app/android' && $method === 'GET') {
    AppDownloadController::info();
}

if ($uri === '/api/app/android/download' && in_array($method, ['GET', 'HEAD'], true)) {
    AppDownloadController::download($method);
}

if ($uri === '/api/debug-log' && $method === 'POST') {
    $env = getenv('APP_ENV') ?: 'production';
    if ($env !== 'development') {
        // En producción solo se permite a administradores con rate limit
        AuthMiddleware::requireAdmin();
    }
    RateLimiter::enforce('debug_log', 30, 60);

    $input = file_get_contents('php://input');
    $safeLog = mb_substr($input, 0, 2048); // Limitar a 2KB por log
    file_put_contents(ROOT_DIR . '/browser_debug.log', "[" . date('Y-m-d H:i:s') . "] " . $safeLog . "\n", FILE_APPEND);
    jsonResponse(['ok' => true]);
}

if ($uri === '/api/profiles' && $method === 'GET') {
    AuthController::getProfiles();
}

if ($uri === '/api/profiles' && $method === 'POST') {
    AuthController::saveProfile();
}

if ($uri === '/api/profiles/select' && $method === 'POST') {
    AuthController::selectProfile();
}

if (preg_match('#^/api/profiles/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
    AuthController::deleteProfile($m[1]);
}

if ($uri === '/api/profiles/delete' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $d = json_decode($raw, true) ?: [];
    $profId = $d['id'] ?? ($_GET['id'] ?? '');
    AuthController::deleteProfile((string)$profId, trim((string)($d['pin'] ?? '')));
}

if ($uri === '/api/shows' && $method === 'GET') {
    ShowController::getShows();
}

if ($uri === '/api/shows/search' && $method === 'GET') {
    ShowController::searchShows();
}

if ($uri === '/api/shows/random' && $method === 'GET') {
    ShowController::getRandomShow();
}

if (preg_match('#^/api/shows/([^/]+)$#', $uri, $m) && $method === 'GET') {
    ShowController::getShowDetails(urldecode($m[1]));
}

if (preg_match('#^/api/shows/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
    ShowController::deleteShow(urldecode($m[1]));
}

if (($uri === '/api/calendar' || $uri === '/api/calendar/schedule') && $method === 'GET') {
    CalendarController::getSchedule();
}

if (preg_match('#^/api/episodes/([^/]+)/timestamps$#', $uri, $m) && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    PlayerController::saveTimestamps(urldecode($m[1]));
}

if (preg_match('#^/api/episodes/([^/]+)/fonts/([^/]+)$#', $uri, $m) && $method === 'GET') {
    PlayerController::streamFont(urldecode($m[1]), urldecode($m[2]));
}

if (preg_match('#^/api/episodes/([^/]+)/fonts$#', $uri, $m) && $method === 'GET') {
    PlayerController::getEpisodeFonts(urldecode($m[1]));
}

if (preg_match('#^/api/episodes/([^/]+)$#', $uri, $m) && $method === 'GET') {
    PlayerController::getEpisodeDetails(urldecode($m[1]));
}

if (preg_match('#^/api/stream/([^/]+)/availability$#', $uri, $m) && $method === 'GET') {
    PlayerController::streamAvailability(urldecode($m[1]));
}

if (preg_match('#^/api/stream/([^/]+)$#', $uri, $m) && in_array($method, ['GET', 'HEAD'])) {
    PlayerController::streamVideo(urldecode($m[1]));
}

if ($uri === '/api/stream' && in_array($method, ['GET', 'HEAD'])) {
    PlayerController::streamVideo();
}

if ($uri === '/api/user/preferences' && $method === 'GET') {
    HistoryController::getUserPreferences();
}

if ($uri === '/api/user/preferences' && $method === 'POST') {
    HistoryController::saveUserPreferences();
}

if ($uri === '/api/user/summary' && $method === 'GET') {
    HistoryController::getYearSummary();
}

if ($uri === '/api/user/stats' && $method === 'GET') {
    HistoryController::getUserStats();
}

if ($uri === '/api/history' && $method === 'GET') {
    HistoryController::getHistory();
}

if ($uri === '/api/history/continue' && $method === 'GET') {
    HistoryController::getContinueWatching();
}

if (preg_match('#^/api/progress/([^/]+)$#', $uri, $m) && $method === 'GET') {
    HistoryController::getProgress(urldecode($m[1]));
}

if (preg_match('#^/api/progress/([^/]+)$#', $uri, $m) && $method === 'POST') {
    HistoryController::saveProgress(urldecode($m[1]));
}

if ($uri === '/api/progress' && $method === 'POST') {
    HistoryController::saveProgress();
}

if (preg_match('#^/api/subtitles?/([^/]+)/([^/]+)$#', $uri, $m) && $method === 'GET') {
    PlayerController::streamSubtitle(urldecode($m[1]), urldecode($m[2]));
}

if ($uri === '/api/favorites/check' && $method === 'GET') {
    HistoryController::checkFavorite();
}

if ($uri === '/api/history/mark' && $method === 'POST') {
    HistoryController::markWatched();
}

if ($uri === '/api/ratings' && $method === 'GET') {
    HistoryController::getRatings();
}

if ($uri === '/api/ratings' && $method === 'POST') {
    HistoryController::setRating();
}

if ($uri === '/api/recommendations' && $method === 'GET') {
    HistoryController::getRecommendations();
}

if ($uri === '/api/list-status' && $method === 'GET') {
    HistoryController::getListStatuses();
}

if ($uri === '/api/list-status' && $method === 'POST') {
    HistoryController::setListStatus();
}

if ($uri === '/api/history' && $method === 'POST') {
    HistoryController::updateProgress();
}

if ($uri === '/api/history' && $method === 'DELETE') {
    HistoryController::deleteHistory();
}

if ($uri === '/api/favorites' && $method === 'GET') {
    HistoryController::getFavorites();
}

if ($uri === '/api/favorites' && $method === 'POST') {
    HistoryController::toggleFavorite();
}

if ($uri === '/api/notifications' && $method === 'GET') {
    HistoryController::getNotifications();
}

if ($uri === '/api/notifications/seen' && $method === 'POST') {
    HistoryController::markNotificationsSeen();
}

if ($uri === '/api/admin/staged' && $method === 'GET') {
    AdminController::getStaged();
}

if (preg_match('#^/api/admin/staged/([^/]+)/publish$#', $uri, $m) && $method === 'POST') {
    AdminController::publishStaged(urldecode($m[1]));
}

if ($uri === '/api/admin/publish' && $method === 'POST') {
    AdminController::publishStaged();
}

if (preg_match('#^/api/admin/staged/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
    AdminController::deleteStaged(urldecode($m[1]));
}

if ($uri === '/api/admin/stats' && $method === 'GET') {
    AdminController::getStats();
}

if ($uri === '/api/admin/active-streams' && $method === 'GET') {
    AdminController::getActiveStreams();
}

if ($uri === '/api/admin/logs' && $method === 'GET') {
    AdminController::getLogs();
}

if ($uri === '/api/admin/display/status' && $method === 'GET') {
    AdminController::getDisplayStatus();
}

if ($uri === '/api/admin/display/power' && $method === 'POST') {
    AdminController::setDisplayPower();
}

if ($uri === '/api/admin/update-show-title' && $method === 'POST') {
    AdminController::updateShowTitle();
}

if ($uri === '/api/admin/save-episode-timings' && $method === 'POST') {
    AdminController::saveEpisodeTimings();
}

if ($uri === '/api/admin/diagnostics' && $method === 'GET') {
    AdminController::getDiagnostics();
}

if ($uri === '/api/admin/detect-timings' && in_array($method, ['GET', 'POST'])) {
    AdminController::detectTimings();
}

if ($uri === '/api/admin/apply-timings' && $method === 'POST') {
    AdminController::applyTimings();
}

if ($uri === '/api/admin/preview-tmdb' && $method === 'GET') {
    AdminController::previewTmdb();
}

if (($uri === '/api/admin/import-show' || $uri === '/api/admin/create-show-tmdb') && $method === 'POST') {
    AdminController::importShow();
}

if (($uri === '/api/admin/scrape-show-cover' || $uri === '/api/admin/scrape-cover') && $method === 'POST') {
    AdminController::scrapeShowCover();
}

if ($uri === '/api/import' && $method === 'POST') {
    AdminController::handleImportUpload();
}

if ($uri === '/api/admin/upload-logo' && $method === 'POST') {
    AdminController::uploadLogo();
}

if ($uri === '/api/admin/reset-logo' && $method === 'POST') {
    AdminController::resetLogo();
}

if ($uri === '/api/admin/upload-show-media' && $method === 'POST') {
    AdminController::uploadShowMedia();
}

if ($uri === '/api/admin/upload-backdrop-loop' && $method === 'POST') {
    AdminController::uploadShowLoop();
}

if ($uri === '/api/admin/delete-backdrop-loop' && $method === 'POST') {
    AdminController::deleteShowLoop();
}

if ($uri === '/api/admin/upload-episode-thumb' && $method === 'POST') {
    AdminController::uploadEpisodeThumb();
}

if (($uri === '/api/admin/toggle-show-status' || $uri === '/api/shows/toggle-status') && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    ShowController::toggleStatus();
}

if ($uri === '/api/admin/sync-statuses' && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    AdminController::syncAllStatuses();
}

if ($uri === '/api/admin/episodes/update' && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    AdminController::updateEpisodeMetadata();
}

if (preg_match('#^/api/admin/shows/([^/]+)/sync-episodes-tmdb$#', $uri, $m) && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    AdminController::syncShowEpisodesTmdb(urldecode($m[1]));
}

if (preg_match('#^/api/admin/shows/([^/]+)/sync-seasons$#', $uri, $m) && $method === 'POST') {
    AdminController::syncShowSeasons(urldecode($m[1]));
}

if ($uri === '/api/comments' && $method === 'GET') {
    ShowController::getComments();
}

if (preg_match('#^/api/comments/([A-Za-z0-9_]+)$#', $uri, $m) && $method === 'DELETE') {
    ShowController::deleteComment($m[1]);
}

if ($uri === '/api/comments' && $method === 'POST') {
    ShowController::addComment();
}

if (($uri === '/api/admin/tmdb/search' || $uri === '/api/search-tmdb' || $uri === '/api/admin/search-tmdb-candidates' || $uri === '/api/admin/search-tmdb') && $method === 'GET') {
    ShowController::searchTmdb();
}

if ($uri === '/api/placeholder-poster' && $method === 'GET') {
    $title = htmlspecialchars($_GET['title'] ?? 'KuraStream', ENT_QUOTES, 'UTF-8');
    @header('Content-Type: image/svg+xml; charset=utf-8');
    echo <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111824"/>
      <stop offset="100%" stop-color="#080A10"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="45%" r="40%">
      <stop offset="0%" stop-color="#818CF8" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#818CF8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="300" height="450" fill="url(#g)"/>
  <rect width="300" height="450" fill="url(#glow)"/>
  <rect x="20" y="20" width="260" height="410" rx="12" fill="none" stroke="#263447" stroke-width="1.5" stroke-opacity="0.6"/>
  <circle cx="150" cy="195" r="44" fill="#172131" stroke="#34465E" stroke-width="1.5"/>
  <polygon points="144,180 166,195 144,210" fill="#818CF8"/>
  <text x="150" y="275" font-family="'Outfit', system-ui, sans-serif" font-size="15" font-weight="700" fill="#F5F7FB" text-anchor="middle">{$title}</text>
  <text x="150" y="298" font-family="'Inter', system-ui, sans-serif" font-size="11" font-weight="500" fill="#7D899C" letter-spacing="1" text-anchor="middle">KURASTREAM</text>
</svg>
SVG;
    exit();
}


// Watch Party Endpoints
if ($uri === '/api/party/create' && $method === 'POST') {
    PartyController::createRoom();
}

if ($uri === '/api/party/join' && $method === 'POST') {
    PartyController::joinRoom();
}

if ($uri === '/api/party/leave' && $method === 'POST') {
    PartyController::leaveRoom();
}

if ($uri === '/api/party/sync' && $method === 'POST') {
    PartyController::syncPlayback();
}

if ($uri === '/api/party/message' && $method === 'POST') {
    PartyController::sendMessage();
}

if ($uri === '/api/party/settings' && $method === 'POST') {
    PartyController::updateSettings();
}

if ($uri === '/api/party/public-rooms' && $method === 'GET') {
    PartyController::getPublicRooms();
}

if ($uri === '/api/party/poll' && in_array($method, ['GET', 'POST'])) {
    PartyController::pollEvents();
}

if ($uri === '/api/party/stream' && $method === 'GET') {
    PartyController::streamEvents();
}

if ($uri === '/api/party/refresh-ticket' && $method === 'POST') {
    PartyController::refreshStreamTicket();
}

if ($uri === '/api/party/sse-ticket' && $method === 'POST') {
    PartyController::getSseTicket();
}

// Rescan / Repair trigger
if (($uri === '/api/admin/scan' || $uri === '/api/admin/repair-library') && $method === 'POST') {
    $admin = AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/JobQueue.php';
    if (JobQueue::shouldQueue()) {
        // Scanning probes every new file with ffprobe: too slow for a web request, so the worker does it.
        $job = JobQueue::enqueue('library_scan', [], (string)($admin['username'] ?? ''));
        jsonResponse(['success' => true, 'queued' => true, 'job_id' => $job['id'], 'already_queued' => $job['existing']], 202);
    }
    $res = LibraryScanner::runScan();
    jsonResponse($res);
}

// Live health of the machine for the admin panel (worker, jobs, backups, disks, ffmpeg, Watch Party viewers, load)
if ($uri === '/api/admin/system' && $method === 'GET') {
    AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/JobQueue.php';
    require_once __DIR__ . '/services/BackupService.php';
    jsonResponse([
        'success' => true,
        'system' => AdminController::systemHealth(),
        'transcode' => ['active' => TranscodeLimiter::getActiveWorkerCount(), 'max' => TranscodeLimiter::maxWorkers()],
        'jobs' => JobQueue::recent(8),
        'backups' => array_slice(BackupService::list(), 0, 10),
    ]);
}

// Background jobs (worker.php): status for the admin panel, and database backups
if ($uri === '/api/admin/jobs' && $method === 'GET') {
    AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/JobQueue.php';
    jsonResponse(['success' => true, 'worker_alive' => JobQueue::workerAlive(), 'jobs' => JobQueue::recent((int)($_GET['limit'] ?? 30))]);
}

if (preg_match('#^/api/admin/jobs/(\d+)$#', $uri, $m) && $method === 'GET') {
    AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/JobQueue.php';
    $job = JobQueue::get((int)$m[1]);
    if (!$job) jsonError('Trabajo no encontrado', 404);
    jsonResponse(['success' => true, 'job' => $job]);
}

if ($uri === '/api/admin/backups' && $method === 'GET') {
    AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/BackupService.php';
    jsonResponse(['success' => true, 'available' => BackupService::isAvailable(), 'backups' => BackupService::list()]);
}

if ($uri === '/api/admin/backups' && $method === 'POST') {
    $admin = AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/JobQueue.php';
    require_once __DIR__ . '/services/BackupService.php';
    if (!BackupService::isAvailable()) {
        jsonError('mysqldump no está instalado en el servidor', 501);
    }
    if (JobQueue::shouldQueue()) {
        $job = JobQueue::enqueue('backup', [], (string)($admin['username'] ?? ''));
        jsonResponse(['success' => true, 'queued' => true, 'job_id' => $job['id']], 202);
    }
    @set_time_limit(300);
    try {
        jsonResponse(['success' => true] + BackupService::run());
    } catch (Throwable $e) {
        error_log('[backup] ' . $e->getMessage());
        jsonError('No se pudo crear el respaldo: ' . $e->getMessage(), 500);
    }
}

// Account administration
if ($uri === '/api/admin/users' && $method === 'GET') {
    AdminUsersController::listUsers();
}

if (preg_match('#^/api/admin/users/([^/]+)/(disable|role|reset-password|logout-all)$#', $uri, $m) && $method === 'POST') {
    $target = urldecode($m[1]);
    switch ($m[2]) {
        case 'disable': AdminUsersController::setDisabled($target); break;
        case 'role': AdminUsersController::setRole($target); break;
        case 'reset-password': AdminUsersController::resetPassword($target); break;
        case 'logout-all': AdminUsersController::logoutAll($target); break;
    }
}

if (preg_match('#^/api/admin/users/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
    AdminUsersController::deleteUser(urldecode($m[1]));
}

if (preg_match('#^/api/admin/backups/([A-Za-z0-9._-]+)$#', $uri, $m) && $method === 'GET') {
    AuthMiddleware::requireAdmin();
    require_once __DIR__ . '/services/BackupService.php';
    $path = BackupService::path($m[1]);
    if ($path === null) jsonError('Respaldo no encontrado', 404);
    header('Content-Type: application/gzip');
    header('Content-Disposition: attachment; filename="' . basename($path) . '"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: no-store');
    readfile($path);
    exit;
}

// 404 fallback
if (str_starts_with($uri, '/api/')) {
    @http_response_code(404);
    @header('Content-Type: application/json; charset=utf-8');
    $payload = ['success' => false, 'error' => 'Endpoint no encontrado'];
    echo json_encode($payload);
    if (defined('TESTING_MODE')) throw new ExitException(json_encode($payload), 404, $payload);
    exit();
}
jsonError("Endpoint not found: {$method} {$uri}", 404);
