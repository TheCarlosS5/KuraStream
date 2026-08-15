<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/controllers/AuthController.php';
require_once __DIR__ . '/controllers/ShowController.php';
require_once __DIR__ . '/controllers/PlayerController.php';
require_once __DIR__ . '/controllers/CalendarController.php';
require_once __DIR__ . '/controllers/HistoryController.php';
require_once __DIR__ . '/controllers/AdminController.php';

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Serve static frontend files and library media directly
$frontendDir = ROOT_DIR . '/frontend';
$libraryDir = ROOT_DIR . '/library';

if ($uri === '/' || $uri === '/index.html') {
    header('Content-Type: text/html; charset=utf-8');
    readfile($frontendDir . '/index.html');
    exit();
}

$decodedUri = urldecode($uri);

$staticFileFrontend = $frontendDir . $decodedUri;
if (file_exists($staticFileFrontend) && is_file($staticFileFrontend)) {
    $mime = mime_content_type($staticFileFrontend);
    if (str_ends_with($decodedUri, '.css')) $mime = 'text/css';
    if (str_ends_with($decodedUri, '.js')) $mime = 'application/javascript';
    header("Content-Type: {$mime}");
    readfile($staticFileFrontend);
    exit();
}

if (str_starts_with($decodedUri, '/library/')) {
    $rel = str_replace('/library', '', $decodedUri);
    $candidate = $libraryDir . $rel;
    
    if (!file_exists($candidate) || !is_file($candidate)) {
        $candidateSpaces = $libraryDir . str_replace('_', ' ', $rel);
        if (file_exists($candidateSpaces) && is_file($candidateSpaces)) {
            $candidate = $candidateSpaces;
        } else {
            $candidateUnderscores = $libraryDir . str_replace(' ', '_', $rel);
            if (file_exists($candidateUnderscores) && is_file($candidateUnderscores)) {
                $candidate = $candidateUnderscores;
            }
        }
    }

    if (file_exists($candidate) && is_file($candidate)) {
        $mime = mime_content_type($candidate);
        header("Content-Type: {$mime}");
        header("Cache-Control: public, max-age=3600");
        readfile($candidate);
        exit();
    }
}

// API Routes
setCorsHeaders();

if ($uri === '/api/login' && $method === 'POST') {
    AuthController::login();
}

if ($uri === '/api/register' && $method === 'POST') {
    AuthController::register();
}

if ($uri === '/api/debug-log' && $method === 'POST') {
    $input = file_get_contents('php://input');
    file_put_contents(ROOT_DIR . '/browser_debug.log', "[" . date('Y-m-d H:i:s') . "] " . $input . "\n", FILE_APPEND);
    header('Content-Type: application/json');
    echo json_encode(['ok' => true]);
    exit();
}

if ($uri === '/api/profiles' && $method === 'GET') {
    AuthController::getProfiles();
}

if ($uri === '/api/profiles' && $method === 'POST') {
    AuthController::saveProfile();
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

if ($uri === '/api/calendar/schedule' && $method === 'GET') {
    CalendarController::getSchedule();
}

if (preg_match('#^/api/episodes/([^/]+)/timestamps$#', $uri, $m) && $method === 'POST') {
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

if ($uri === '/api/admin/detect-intros' && $method === 'POST') {
    AdminController::detectIntros();
}

if (($uri === '/api/admin/scrape-show-cover' || $uri === '/api/admin/scrape-cover') && $method === 'POST') {
    AdminController::scrapeShowCover();
}

if ($uri === '/api/admin/autodownload/status' && $method === 'GET') {
    AdminController::getTorrentStatus();
}

if ($uri === '/api/admin/autodownload/toggle' && $method === 'POST') {
    AdminController::toggleAutoDownload();
}

if ($uri === '/api/admin/autodownload/scan' && $method === 'POST') {
    AdminController::scanAutoDownloadNow();
}

if ($uri === '/api/admin/torrents/search' && $method === 'GET') {
    AdminController::searchTorrents();
}

if (($uri === '/api/admin/torrents/add' || $uri === '/api/admin/autodownload/add') && $method === 'POST') {
    AdminController::addTorrent();
}

if ($uri === '/api/admin/autodownload/queue/remove' && $method === 'POST') {
    AdminController::removeTorrentFromQueue();
}

if ($uri === '/api/admin/autodownload/queue/clear' && $method === 'POST') {
    AdminController::clearTorrentQueue();
}

if ($uri === '/api/admin/autodownload/queue/start' && $method === 'POST') {
    AdminController::startTorrentQueue();
}

if ($uri === '/api/admin/autodownload/cancel-active' && $method === 'POST') {
    AdminController::cancelActiveTorrent();
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

if ($uri === '/api/admin/toggle-show-status' && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    ShowController::toggleStatus();
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
      <stop offset="0%" stop-color="#181824"/>
      <stop offset="100%" stop-color="#0a0a10"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" fill="url(#g)"/>
  <circle cx="150" cy="200" r="50" fill="#a855f7" opacity="0.2"/>
  <polygon points="140,180 170,200 140,220" fill="#a855f7"/>
  <text x="150" y="280" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#e2e8f0" text-anchor="middle">{$title}</text>
  <text x="150" y="305" font-family="system-ui, sans-serif" font-size="12" fill="#94a3b8" text-anchor="middle">KuraStream</text>
</svg>
SVG;
    exit();
}

if ($uri === '/api/subtitles' && $method === 'GET') {
    jsonResponse([]);
}

if ($uri === '/api/torrents' && $method === 'GET') {
    jsonResponse([]);
}

// Rescan / Repair trigger
if (($uri === '/api/admin/scan' || $uri === '/api/admin/repair-library') && $method === 'POST') {
    AuthMiddleware::requireAdmin();
    $res = LibraryScanner::runScan();
    jsonResponse($res);
}

// 404 fallback
jsonError("Endpoint not found: {$method} {$uri}", 404);
