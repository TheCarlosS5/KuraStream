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
require_once __DIR__ . '/controllers/PartyController.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
setSecurityHeaders();

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

if ($uri === '/' || $uri === '/index.html') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    readfile($frontendDir . '/index.html');
    exit();
}

$decodedUri = urldecode($uri);

serveStaticFile($frontendDir, $decodedUri);

if (str_starts_with($decodedUri, '/library/')) {
    $rel = substr($decodedUri, strlen('/library/'));
    $ext = strtolower(pathinfo(parse_url($rel, PHP_URL_PATH) ?: $rel, PATHINFO_EXTENSION));
    $videoExts = ['mkv', 'mp4', 'webm', 'ts', 'avi', 'mov', 'm4v'];
    if (in_array($ext, $videoExts, true)) {
        jsonError('Direct video download forbidden. Use /api/stream/{id}', 403);
    }
    serveStaticFile($libraryDir, $rel, 'public, max-age=3600');
    serveStaticFile($libraryDir, str_replace('_', ' ', $rel), 'public, max-age=3600');
    serveStaticFile($libraryDir, str_replace(' ', '_', $rel), 'public, max-age=3600');
}

// API Routes
setCorsHeaders();

if ($uri === '/api/login' && $method === 'POST') {
    RateLimiter::enforce('auth', 10, 300);
    AuthController::login();
}

if ($uri === '/api/register' && $method === 'POST') {
    RateLimiter::enforce('auth', 10, 300);
    AuthController::register();
}

if ($uri === '/api/logout' && $method === 'POST') {
    AuthController::logout();
}

if ($uri === '/api/health' && $method === 'GET') {
    $response = [
        'success' => true,
        'status' => 'healthy',
        'database' => 'connected',
        'storage' => is_readable(LIBRARY_DIR) ? 'readable' : 'unreadable',
        'php_version' => PHP_VERSION,
        'timestamp' => date('c')
    ];

    try {
        $db = Database::getConnection();
        $db->query('SELECT 1');
    } catch (Throwable $e) {
        @http_response_code(503);
        $response['success'] = false;
        $response['status'] = 'degraded';
        $response['database'] = 'disconnected';
        echo json_encode($response);
        if (defined('TESTING_MODE')) throw new ExitException(json_encode($response), 503, $response);
        exit();
    }
    
    jsonResponse($response);
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

if (preg_match('#^/api/episodes/([^/]+)$#', $uri, $m) && $method === 'GET') {
    PlayerController::getEpisodeDetails(urldecode($m[1]));
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

if ($uri === '/api/user/stats' && $method === 'GET') {
    HistoryController::getUserStats();
}

if ($uri === '/api/history' && $method === 'GET') {
    HistoryController::getHistory();
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

if ($uri === '/api/comments' && $method === 'GET') {
    ShowController::getComments();
}

if ($uri === '/api/comments' && $method === 'POST') {
    ShowController::addComment();
}

if (($uri === '/api/admin/tmdb/search' || $uri === '/api/search-tmdb' || $uri === '/api/admin/search-tmdb-candidates') && $method === 'GET') {
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
    AuthMiddleware::requireAdmin();
    $res = LibraryScanner::runScan();
    jsonResponse($res);
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
