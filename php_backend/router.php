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

$staticFileFrontend = $frontendDir . $uri;
if (file_exists($staticFileFrontend) && is_file($staticFileFrontend)) {
    $mime = mime_content_type($staticFileFrontend);
    if (str_ends_with($uri, '.css')) $mime = 'text/css';
    if (str_ends_with($uri, '.js')) $mime = 'application/javascript';
    header("Content-Type: {$mime}");
    readfile($staticFileFrontend);
    exit();
}

$staticFileLibrary = $libraryDir . str_replace('/library', '', $uri);
if (str_starts_with($uri, '/library/') && file_exists($staticFileLibrary) && is_file($staticFileLibrary)) {
    $mime = mime_content_type($staticFileLibrary);
    header("Content-Type: {$mime}");
    readfile($staticFileLibrary);
    exit();
}

// API Routes
setCorsHeaders();

if ($uri === '/api/login' && $method === 'POST') {
    AuthController::login();
}

if ($uri === '/api/shows' && $method === 'GET') {
    ShowController::getShows();
}

if ($uri === '/api/shows/search' && $method === 'GET') {
    ShowController::searchShows();
}

if (preg_match('#^/api/shows/([^/]+)$#', $uri, $m) && $method === 'GET') {
    ShowController::getShowDetails($m[1]);
}

if ($uri === '/api/calendar/schedule' && $method === 'GET') {
    CalendarController::getSchedule();
}

if (preg_match('#^/api/episodes/([^/]+)/timestamps$#', $uri, $m) && $method === 'POST') {
    PlayerController::saveTimestamps($m[1]);
}

if (preg_match('#^/api/episodes/([^/]+)$#', $uri, $m) && $method === 'GET') {
    PlayerController::getEpisodeDetails($m[1]);
}

if ($uri === '/api/stream' && $method === 'GET') {
    PlayerController::streamVideo();
}

if ($uri === '/api/user/preferences' && $method === 'GET') {
    HistoryController::getUserPreferences();
}

if ($uri === '/api/user/preferences' && $method === 'POST') {
    HistoryController::saveUserPreferences();
}

if ($uri === '/api/history' && $method === 'GET') {
    HistoryController::getHistory();
}

if ($uri === '/api/history' && $method === 'POST') {
    HistoryController::updateProgress();
}

if ($uri === '/api/favorites' && $method === 'GET') {
    HistoryController::getFavorites();
}

if ($uri === '/api/favorites' && $method === 'POST') {
    HistoryController::toggleFavorite();
}

if ($uri === '/api/admin/staged' && $method === 'GET') {
    AdminController::getStaged();
}

if ($uri === '/api/admin/publish' && $method === 'POST') {
    AdminController::publishStaged();
}

if (preg_match('#^/api/admin/staged/([^/]+)$#', $uri, $m) && $method === 'DELETE') {
    AdminController::deleteStaged($m[1]);
}

if ($uri === '/api/admin/stats' && $method === 'GET') {
    AdminController::getStats();
}

if ($uri === '/api/admin/toggle-show-status' && $method === 'POST') {
    ShowController::toggleStatus();
}

// Rescan trigger
if ($uri === '/api/admin/scan' && $method === 'POST') {
    $res = LibraryScanner::runScan();
    jsonResponse($res);
}

// 404 fallback
jsonError("Endpoint not found: {$method} {$uri}", 404);
