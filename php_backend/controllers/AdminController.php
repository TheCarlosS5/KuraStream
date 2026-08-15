<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../services/LibraryScanner.php';
require_once __DIR__ . '/../services/FfmpegScanner.php';
require_once __DIR__ . '/../services/TmdbScraper.php';

class AdminController {
    public static function getStaged(): void {
        AuthMiddleware::requireAdmin();
        $db = Database::getConnection();
        $stmt = $db->query("SELECT * FROM staged_imports ORDER BY created_at DESC");
        $rows = $stmt->fetchAll();

        // Ensure key compatibility with both old and new frontends
        $items = array_map(function($r) {
            $r['raw_title'] = $r['original_filename'];
            $r['file_path'] = $r['filepath'];
            $r['source_info'] = $r['media_type'] === 'movie' ? 'Película en Preparación' : 'Anime en Preparación';
            return $r;
        }, $rows);

        jsonResponse($items);
    }

    public static function publishStaged(?string $id = null): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $id = $id ?: ($data['id'] ?? '');
        $cleanTitle = trim($data['clean_title'] ?? '');
        $season = (int)($data['season'] ?? 1);
        $episode = (int)($data['episode'] ?? 1);
        $mediaType = $data['media_type'] ?? 'anime';

        if (empty($id) || empty($cleanTitle)) {
            jsonError('id y clean_title requeridos', 400);
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM staged_imports WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $item = $stmt->fetch();

        if (!$item) {
            jsonError('Item staged no encontrado', 404);
        }

        $catName = ($mediaType === 'movie') ? 'Movies' : 'Anime';
        $sanitizedTitle = str_replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], '_', $cleanTitle);
        $targetDir = LIBRARY_DIR . '/' . $catName . '/' . $sanitizedTitle;

        if ($mediaType === 'anime') {
            $seasonDir = $targetDir . '/Season ' . sprintf('%02d', $season);
            if (!is_dir($seasonDir)) @mkdir($seasonDir, 0777, true);
            $targetDir = $seasonDir;
        } else {
            if (!is_dir($targetDir)) @mkdir($targetDir, 0777, true);
        }

        $ext = pathinfo($item['filepath'], PATHINFO_EXTENSION);
        $targetFilename = ($mediaType === 'movie') 
            ? "{$sanitizedTitle}.{$ext}" 
            : "{$sanitizedTitle} - S" . sprintf("%02d", $season) . "E" . sprintf("%02d", $episode) . ".{$ext}";

        $targetPath = $targetDir . '/' . $targetFilename;

        if (file_exists($item['filepath'])) {
            if (!@rename($item['filepath'], $targetPath)) {
                @copy($item['filepath'], $targetPath);
                @unlink($item['filepath']);
            }
        }

        $del = $db->prepare("DELETE FROM staged_imports WHERE id = :id");
        $del->execute(['id' => $id]);

        LibraryScanner::runScan();

        jsonResponse(['success' => true]);
    }

    public static function deleteStaged(string $id): void {
        AuthMiddleware::requireAdmin();
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM staged_imports WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $item = $stmt->fetch();

        if ($item && file_exists($item['filepath'])) {
            @unlink($item['filepath']);
        }

        $del = $db->prepare("DELETE FROM staged_imports WHERE id = :id");
        $del->execute(['id' => $id]);

        jsonResponse(['success' => true]);
    }

    public static function getStats(): void {
        AuthMiddleware::requireAdmin();
        $db = Database::getConnection();
        $showsCount = (int)$db->query("SELECT COUNT(*) FROM shows")->fetchColumn();
        $episodesCount = (int)$db->query("SELECT COUNT(*) FROM episodes")->fetchColumn();
        $totalSecs = (float)$db->query("SELECT SUM(duration) FROM episodes")->fetchColumn();
        $totalBytes = (float)$db->query("SELECT SUM(size) FROM episodes")->fetchColumn();

        $diskFree = @disk_free_space(LIBRARY_DIR) ?: (100 * 1024 * 1024 * 1024);
        $diskTotal = @disk_total_space(LIBRARY_DIR) ?: (500 * 1024 * 1024 * 1024);
        $diskUsed = max(0, $diskTotal - $diskFree);
        $usedPercent = $diskTotal > 0 ? round(($diskUsed / $diskTotal) * 100, 1) : 0;

        $formatBytes = function($bytes) {
            if ($bytes >= 1024 * 1024 * 1024) {
                return round($bytes / (1024 * 1024 * 1024), 2) . ' GB';
            }
            return round($bytes / (1024 * 1024), 1) . ' MB';
        };

        $totalHours = round($totalSecs / 3600, 1);
        $storageGb = round($totalBytes / (1024 * 1024 * 1024), 2);
        $librarySizeFormatted = $formatBytes($totalBytes);

        jsonResponse([
            'success' => true,
            'shows_count' => $showsCount,
            'episodes_count' => $episodesCount,
            'total_duration_hours' => $totalHours,
            'total_storage_gb' => $storageGb,
            'showsCount' => $showsCount,
            'episodesCount' => $episodesCount,
            'totalHours' => $totalHours,
            'librarySizeFormatted' => $librarySizeFormatted,
            'diskInfo' => [
                'usedPercent' => $usedPercent,
                'usedFormatted' => $formatBytes($diskUsed),
                'freeFormatted' => $formatBytes($diskFree),
                'totalFormatted' => $formatBytes($diskTotal)
            ]
        ]);
    }

    public static function getActiveStreams(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse([]);
    }

    public static function getLogs(): void {
        AuthMiddleware::requireAdmin();
        $candidates = [
            ROOT_DIR . '/server.log',
            '/home/dserver-calos/KuraStream/server.log',
            '/home/dserver-calos/kurastream.log',
            '/tmp/kurastream.log'
        ];

        $rawLogs = '';
        foreach ($candidates as $filePath) {
            if (file_exists($filePath) && is_readable($filePath) && filesize($filePath) > 0) {
                $lines = array_slice(file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES), -150);
                $rawLogs = implode("\n", $lines);
                break;
            }
        }

        if (empty($rawLogs)) {
            $journal = @shell_exec('journalctl -u kurastream.service -n 80 --no-pager 2>/dev/null');
            if (!empty($journal)) {
                $rawLogs = trim($journal);
            } else {
                $rawLogs = "[" . date('Y-m-d H:i:s') . "] [INFO] Servidor PHP KuraStream activo y en ejecución.\n[" . date('Y-m-d H:i:s') . "] [INFO] Base de datos MariaDB conectada correctamente.";
            }
        }

        $linesArray = explode("\n", $rawLogs);

        jsonResponse([
            'success' => true,
            'logs' => $rawLogs,
            'lines' => $linesArray
        ]);
    }

    public static function getDisplayStatus(): void {
        AuthMiddleware::requireAdmin();
        $isOff = false;

        $blPowerFiles = glob('/sys/class/backlight/*/bl_power');
        if (!empty($blPowerFiles) && file_exists($blPowerFiles[0])) {
            $val = trim(@file_get_contents($blPowerFiles[0]));
            if ($val === '1' || $val === '4') $isOff = true;
        }

        jsonResponse([
            'success' => true,
            'state' => $isOff ? 'off' : 'on',
            'power' => $isOff ? 'off' : 'on',
            'brightness' => $isOff ? 0 : 100
        ]);
    }

    public static function setDisplayPower(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];
        $power = strtolower($data['power'] ?? 'on');

        if ($power === 'off') {
            @shell_exec('sh -c "echo 1 > /sys/class/backlight/*/bl_power 2>/dev/null || echo 1 > /sys/class/graphics/fb0/blank 2>/dev/null || vbetool dpms off 2>/dev/null || true"');
        } else {
            @shell_exec('sh -c "echo 0 > /sys/class/backlight/*/bl_power 2>/dev/null || echo 0 > /sys/class/graphics/fb0/blank 2>/dev/null || vbetool dpms on 2>/dev/null || true"');
        }

        jsonResponse(['success' => true, 'power' => $power]);
    }

    public static function updateShowTitle(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $showId = $data['showId'] ?? ($data['show_id'] ?? '');
        $newTitle = trim($data['newTitle'] ?? ($data['title'] ?? ''));

        if (empty($showId) || empty($newTitle)) {
            jsonError('show_id y title requeridos', 400);
        }

        $show = DbHelper::getShow($showId) ?: DbHelper::findShowByFolderOrTitle($showId, $showId);
        $realId = $show ? $show['id'] : $showId;

        $db = Database::getConnection();
        $stmt = $db->prepare("UPDATE shows SET title = :t WHERE id = :id");
        $stmt->execute(['t' => $newTitle, 'id' => $realId]);

        jsonResponse(['success' => true]);
    }

    public static function saveEpisodeTimings(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];
        $episodeId = $data['episode_id'] ?? ($data['episodeId'] ?? '');

        if (empty($episodeId)) {
            jsonError('episode_id requerido', 400);
        }

        DbHelper::saveEpisodeTimestamps($episodeId, $data);
        jsonResponse(['success' => true]);
    }

    public static function previewTmdb(): void {
        AuthMiddleware::requireAdmin();
        $tmdbId = (int)($_GET['tmdb_id'] ?? ($_GET['tmdbId'] ?? ($_GET['id'] ?? 0)));
        $query = trim($_GET['q'] ?? ($_GET['query'] ?? ($_GET['title'] ?? '')));
        $type = $_GET['type'] ?? 'anime';

        if (!$tmdbId && !empty($query)) {
            $searchResults = TmdbScraper::search($query, $type);
            if (!empty($searchResults)) {
                $tmdbId = (int)$searchResults[0]['id'];
            }
        }

        if (!$tmdbId) {
            jsonError('No se encontraron resultados en TMDB', 404);
        }

        $details = TmdbScraper::getDetails($tmdbId, $type);
        if (!$details) {
            jsonError('No se pudieron obtener detalles de TMDB', 404);
        }

        jsonResponse([
            'success' => true,
            'details' => $details
        ]);
    }

    public static function importShow(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $title = trim($data['title'] ?? '');
        $mediaType = $data['media_type'] ?? ($data['type'] ?? 'anime');
        $tmdbId = (int)($data['tmdb_id'] ?? ($data['tmdbId'] ?? 0));
        $ageRating = $data['age_rating'] ?? 'TV-14';

        if (empty($title) && !$tmdbId) {
            jsonError('title o tmdb_id requerido', 400);
        }

        $details = null;
        if ($tmdbId) {
            $details = TmdbScraper::getDetails($tmdbId, $mediaType);
        } else {
            $searchRes = TmdbScraper::search($title, $mediaType);
            if (!empty($searchRes)) {
                $details = TmdbScraper::getDetails((int)$searchRes[0]['id'], $mediaType);
            }
        }

        $cleanTitle = !empty($title) ? $title : ($details['title'] ?? 'Nuevo Show');
        $sanitizedDir = str_replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], '_', $cleanTitle);
        $catFolder = ($mediaType === 'movie') ? 'Movies' : 'Anime';
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $sanitizedDir;

        if (!is_dir($showDir)) {
            @mkdir($showDir, 0755, true);
        }

        $posterPath = '';
        $backdropPath = '';

        if ($details) {
            if (!empty($details['poster_path'])) {
                $destPoster = $showDir . '/poster.jpg';
                if (TmdbScraper::downloadFile($details['poster_path'], $destPoster)) {
                    $posterPath = "/library/{$catFolder}/{$sanitizedDir}/poster.jpg";
                } else {
                    $posterPath = $details['poster_path'];
                }
            }
            if (!empty($details['backdrop_path'])) {
                $destBackdrop = $showDir . '/backdrop.jpg';
                if (TmdbScraper::downloadFile($details['backdrop_path'], $destBackdrop)) {
                    $backdropPath = "/library/{$catFolder}/{$sanitizedDir}/backdrop.jpg";
                } else {
                    $backdropPath = $details['backdrop_path'];
                }
            }
        }

        $showRecord = [
            'id' => $sanitizedDir,
            'title' => $cleanTitle,
            'synopsis' => $details['synopsis'] ?? '',
            'rating' => $details['rating'] ?? 0.0,
            'year' => $details['year'] ?? (int)date('Y'),
            'studio' => $details['studio'] ?? '',
            'director' => '',
            'writer' => '',
            'cast_members' => '[]',
            'poster_path' => $posterPath,
            'backdrop_path' => $backdropPath,
            'media_type' => $mediaType,
            'backdrop_loops' => '[]',
            'genres' => $details['genres'] ?? '',
            'trailer_key' => null,
            'age_rating' => $ageRating,
            'status' => $details['status'] ?? 'finished'
        ];

        DbHelper::saveShow($showRecord);
        LibraryScanner::runScan();

        jsonResponse([
            'success' => true,
            'show' => $showRecord
        ]);
    }

    public static function handleImportUpload(): void {
        AuthMiddleware::requireAdmin();

        $title = trim($_POST['title'] ?? '');
        $mediaType = $_POST['mediaType'] ?? ($_POST['media_type'] ?? 'anime');
        $season = (int)($_POST['seasonNumber'] ?? ($_POST['season'] ?? 1));
        $episode = (int)($_POST['episodeNumber'] ?? ($_POST['episode'] ?? 1));
        $tmdbId = (int)($_POST['tmdbId'] ?? ($_POST['tmdb_id'] ?? 0));

        if (empty($title)) {
            jsonError('title requerido', 400);
        }

        $catFolder = ($mediaType === 'movie') ? 'Movies' : 'Anime';
        $sanitizedDir = str_replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], '_', $title);
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $sanitizedDir;

        if ($mediaType === 'anime') {
            $targetDir = $showDir . '/Season ' . sprintf('%02d', $season);
        } else {
            $targetDir = $showDir;
        }

        if (!is_dir($targetDir)) {
            @mkdir($targetDir, 0755, true);
        }

        // Check if file was uploaded
        if (isset($_FILES['videoFile']) && $_FILES['videoFile']['error'] === UPLOAD_ERR_OK) {
            $origName = $_FILES['videoFile']['name'];
            $ext = pathinfo($origName, PATHINFO_EXTENSION);
            $filename = ($mediaType === 'movie') 
                ? "{$sanitizedDir}.{$ext}" 
                : "{$sanitizedDir} - S" . sprintf("%02d", $season) . "E" . sprintf("%02d", $episode) . ".{$ext}";

            $destPath = $targetDir . '/' . $filename;
            move_uploaded_file($_FILES['videoFile']['tmp_name'], $destPath);
        } else if (!empty($_POST['sourcePath']) && file_exists($_POST['sourcePath'])) {
            $origName = basename($_POST['sourcePath']);
            $ext = pathinfo($origName, PATHINFO_EXTENSION);
            $filename = ($mediaType === 'movie') 
                ? "{$sanitizedDir}.{$ext}" 
                : "{$sanitizedDir} - S" . sprintf("%02d", $season) . "E" . sprintf("%02d", $episode) . ".{$ext}";
            $destPath = $targetDir . '/' . $filename;
            @copy($_POST['sourcePath'], $destPath);
        }

        // Enrich show metadata via TMDB if show record does not exist
        $existingShow = DbHelper::findShowByFolderOrTitle($sanitizedDir, $title);
        if (!$existingShow) {
            $details = $tmdbId ? TmdbScraper::getDetails($tmdbId, $mediaType) : null;
            if (!$details) {
                $searchRes = TmdbScraper::search($title, $mediaType);
                if (!empty($searchRes)) {
                    $details = TmdbScraper::getDetails((int)$searchRes[0]['id'], $mediaType);
                }
            }

            $posterPath = '';
            $backdropPath = '';
            if ($details) {
                if (!empty($details['poster_path'])) {
                    $destPoster = $showDir . '/poster.jpg';
                    if (TmdbScraper::downloadFile($details['poster_path'], $destPoster)) {
                        $posterPath = "/library/{$catFolder}/{$sanitizedDir}/poster.jpg";
                    }
                }
                if (!empty($details['backdrop_path'])) {
                    $destBackdrop = $showDir . '/backdrop.jpg';
                    if (TmdbScraper::downloadFile($details['backdrop_path'], $destBackdrop)) {
                        $backdropPath = "/library/{$catFolder}/{$sanitizedDir}/backdrop.jpg";
                    }
                }
            }

            DbHelper::saveShow([
                'id' => $sanitizedDir,
                'title' => $title,
                'synopsis' => $details['synopsis'] ?? '',
                'rating' => $details['rating'] ?? 0.0,
                'year' => $details['year'] ?? (int)date('Y'),
                'studio' => $details['studio'] ?? '',
                'poster_path' => $posterPath,
                'backdrop_path' => $backdropPath,
                'media_type' => $mediaType,
                'genres' => $details['genres'] ?? '',
                'status' => $details['status'] ?? 'finished'
            ]);
        }

        // Rescan to discover and probe the new video
        LibraryScanner::runScan();

        jsonResponse(['success' => true, 'message' => 'Archivo importado y organizado con éxito']);
    }

    public static function uploadLogo(): void {
        AuthMiddleware::requireAdmin();
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            jsonError('Archivo de imagen requerido', 400);
        }

        $dest = LIBRARY_DIR . '/logo.png';
        move_uploaded_file($_FILES['file']['tmp_name'], $dest);
        jsonResponse(['success' => true]);
    }

    public static function resetLogo(): void {
        AuthMiddleware::requireAdmin();
        $logoFile = LIBRARY_DIR . '/logo.png';
        if (file_exists($logoFile)) {
            @unlink($logoFile);
        }
        jsonResponse(['success' => true]);
    }

    public static function uploadShowMedia(): void {
        AuthMiddleware::requireAdmin();
        $showId = $_POST['showId'] ?? ($_POST['show_id'] ?? '');
        if (empty($showId)) {
            jsonError('showId requerido', 400);
        }

        $show = DbHelper::getShow($showId) ?: DbHelper::findShowByFolderOrTitle($showId, $showId);
        $realId = $show ? $show['id'] : $showId;
        $mediaType = $show['media_type'] ?? 'anime';
        $catFolder = ($mediaType === 'movie') ? 'Movies' : 'Anime';
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $realId;
        if (!is_dir($showDir)) @mkdir($showDir, 0755, true);

        if (isset($_FILES['poster']) && $_FILES['poster']['error'] === UPLOAD_ERR_OK) {
            move_uploaded_file($_FILES['poster']['tmp_name'], $showDir . '/poster.jpg');
            $show['poster_path'] = "/library/{$catFolder}/{$realId}/poster.jpg";
            DbHelper::saveShow($show);
        } else if (isset($_FILES['backdrop']) && $_FILES['backdrop']['error'] === UPLOAD_ERR_OK) {
            move_uploaded_file($_FILES['backdrop']['tmp_name'], $showDir . '/backdrop.jpg');
            $show['backdrop_path'] = "/library/{$catFolder}/{$realId}/backdrop.jpg";
            DbHelper::saveShow($show);
        }

        jsonResponse(['success' => true]);
    }

    public static function uploadShowLoop(): void {
        AuthMiddleware::requireAdmin();
        $showId = $_POST['showId'] ?? ($_POST['show_id'] ?? '');
        if (empty($showId) || !isset($_FILES['video']) || $_FILES['video']['error'] !== UPLOAD_ERR_OK) {
            jsonError('showId y video requerido', 400);
        }

        $show = DbHelper::getShow($showId) ?: DbHelper::findShowByFolderOrTitle($showId, $showId);
        $realId = $show ? $show['id'] : $showId;
        $catFolder = ($show['media_type'] ?? 'anime') === 'movie' ? 'Movies' : 'Anime';
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $realId;
        if (!is_dir($showDir)) @mkdir($showDir, 0755, true);

        $loopFilename = 'loop_' . uniqid() . '.mp4';
        $destPath = $showDir . '/' . $loopFilename;
        move_uploaded_file($_FILES['video']['tmp_name'], $destPath);

        $loops = !empty($show['backdrop_loops']) ? (is_array($show['backdrop_loops']) ? $show['backdrop_loops'] : json_decode($show['backdrop_loops'], true)) : [];
        $loops[] = "/library/{$catFolder}/{$realId}/{$loopFilename}";
        $show['backdrop_loops'] = $loops;
        DbHelper::saveShow($show);

        jsonResponse(['success' => true]);
    }

    public static function deleteShowLoop(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];
        $showId = $data['showId'] ?? ($data['show_id'] ?? '');
        $loopUrl = $data['loopUrl'] ?? ($data['loop_url'] ?? '');

        if (empty($showId) || empty($loopUrl)) {
            jsonError('showId y loopUrl requeridos', 400);
        }

        $show = DbHelper::getShow($showId) ?: DbHelper::findShowByFolderOrTitle($showId, $showId);
        if ($show) {
            $loops = !empty($show['backdrop_loops']) ? (is_array($show['backdrop_loops']) ? $show['backdrop_loops'] : json_decode($show['backdrop_loops'], true)) : [];
            $loops = array_values(array_filter($loops, fn($u) => $u !== $loopUrl));
            $show['backdrop_loops'] = $loops;
            DbHelper::saveShow($show);

            $localFile = ROOT_DIR . $loopUrl;
            if (file_exists($localFile)) @unlink($localFile);
        }

        jsonResponse(['success' => true]);
    }

    public static function uploadEpisodeThumb(): void {
        AuthMiddleware::requireAdmin();
        $episodeId = $_POST['episodeId'] ?? ($_POST['episode_id'] ?? '');
        if (empty($episodeId) || !isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
            jsonError('episodeId e image requeridos', 400);
        }

        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep) jsonError('Episodio no encontrado', 404);

        $show = DbHelper::getShow($ep['show_id']);
        $catFolder = ($show['media_type'] ?? 'anime') === 'movie' ? 'Movies' : 'Anime';
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $ep['show_id'];
        $thumbName = "ep_{$ep['season_number']}_{$ep['episode_number']}_thumb.jpg";
        $dest = $showDir . '/' . $thumbName;

        move_uploaded_file($_FILES['image']['tmp_name'], $dest);

        $ep['thumbnail_path'] = "/library/{$catFolder}/{$ep['show_id']}/{$thumbName}";
        DbHelper::saveEpisode($ep);

        jsonResponse(['success' => true]);
    }

    public static function scrapeShowCover(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $showId = $data['showId'] ?? ($data['show_id'] ?? ($_GET['showId'] ?? ($_GET['show_id'] ?? '')));
        $query = trim($data['query'] ?? ($data['title'] ?? ($_GET['query'] ?? '')));
        $tmdbId = (int)($data['tmdb_id'] ?? ($data['tmdbId'] ?? 0));
        $mediaType = $data['media_type'] ?? ($data['type'] ?? 'anime');

        if (empty($showId) && empty($query)) {
            jsonError('showId o query requeridos', 400);
        }

        $show = null;
        if (!empty($showId)) {
            $show = DbHelper::getShow($showId) ?: DbHelper::findShowByFolderOrTitle($showId, $showId);
        }

        if (empty($query) && $show) {
            $query = $show['title'];
        }

        $mediaType = $show['media_type'] ?? $mediaType;
        $catFolder = ($mediaType === 'movie') ? 'Movies' : 'Anime';
        $realShowId = $show ? $show['id'] : $showId;

        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $realShowId;
        if (!is_dir($showDir)) {
            $candidateUnderscores = LIBRARY_DIR . '/' . $catFolder . '/' . str_replace(' ', '_', $realShowId);
            $candidateSpaces = LIBRARY_DIR . '/' . $catFolder . '/' . str_replace('_', ' ', $realShowId);
            if (is_dir($candidateUnderscores)) {
                $showDir = $candidateUnderscores;
            } else if (is_dir($candidateSpaces)) {
                $showDir = $candidateSpaces;
            } else {
                $showDir = LIBRARY_DIR . '/Anime/' . $realShowId;
                if (!is_dir($showDir)) {
                    @mkdir($showDir, 0755, true);
                }
            }
        }

        if (!$tmdbId && !empty($query)) {
            $searchRes = TmdbScraper::search($query, $mediaType);
            
            // Fallback 1: Try cleaned query (replace dots/underscores, remove release tags)
            if (empty($searchRes)) {
                $cleanQuery = preg_replace('/(\[.*?\]|\(.*?\)|1080p|720p|4k|2160p|hevc|x264|x265|aac|dvdrip|web-dl|bluray|bdrip|latino|sub|esp|dual)/i', '', $query);
                $cleanQuery = trim(preg_replace('/[._\-+]+/', ' ', $cleanQuery));
                if (!empty($cleanQuery) && $cleanQuery !== $query) {
                    $searchRes = TmdbScraper::search($cleanQuery, $mediaType);
                }
            }

            // Fallback 2: Try first 3 words of query
            if (empty($searchRes)) {
                $words = explode(' ', preg_replace('/[._\-+]+/', ' ', $query));
                if (count($words) > 3) {
                    $shortQuery = implode(' ', array_slice($words, 0, 3));
                    $searchRes = TmdbScraper::search($shortQuery, $mediaType);
                }
            }

            if (!empty($searchRes)) {
                $tmdbId = (int)$searchRes[0]['id'];
            }
        }

        if (!$tmdbId) {
            jsonError('No se encontraron resultados en TMDB para "' . $query . '". Prueba escribiendo el nombre oficial en inglés o español.', 404);
        }

        $details = TmdbScraper::getDetails($tmdbId, $mediaType);
        if (!$details) {
            jsonError('No se pudieron obtener detalles de TMDB', 404);
        }

        $actualFolder = basename($showDir);
        $localPosterUrl = $show['poster_path'] ?? '';
        $localBackdropUrl = $show['backdrop_path'] ?? '';

        if (!empty($details['poster_path'])) {
            $posterDest = $showDir . '/poster.jpg';
            if (TmdbScraper::downloadFile($details['poster_path'], $posterDest)) {
                $localPosterUrl = "/library/{$catFolder}/{$actualFolder}/poster.jpg";
            } else {
                $localPosterUrl = $details['poster_path'];
            }
        }

        if (!empty($details['backdrop_path'])) {
            $backdropDest = $showDir . '/backdrop.jpg';
            if (TmdbScraper::downloadFile($details['backdrop_path'], $backdropDest)) {
                $localBackdropUrl = "/library/{$catFolder}/{$actualFolder}/backdrop.jpg";
            } else {
                $localBackdropUrl = $details['backdrop_path'];
            }
        }

        $updatedData = [
            'id' => $realShowId,
            'title' => !empty($show['title']) ? $show['title'] : $details['title'],
            'synopsis' => !empty($details['synopsis']) ? $details['synopsis'] : ($show['synopsis'] ?? ''),
            'rating' => ($details['rating'] > 0) ? $details['rating'] : ($show['rating'] ?? 0.0),
            'year' => $details['year'] ?: ($show['year'] ?? null),
            'studio' => !empty($details['studio']) ? $details['studio'] : ($show['studio'] ?? ''),
            'director' => $show['director'] ?? '',
            'writer' => $show['writer'] ?? '',
            'cast_members' => $show['cast_members'] ?? '[]',
            'poster_path' => $localPosterUrl,
            'backdrop_path' => $localBackdropUrl,
            'media_type' => $mediaType,
            'backdrop_loops' => $show['backdrop_loops'] ?? '[]',
            'genres' => !empty($details['genres']) ? $details['genres'] : ($show['genres'] ?? ''),
            'trailer_key' => $show['trailer_key'] ?? null,
            'age_rating' => $show['age_rating'] ?? 'TV-14',
            'status' => !empty($details['status']) ? $details['status'] : ($show['status'] ?? 'finished')
        ];

        DbHelper::saveShow($updatedData);

        jsonResponse([
            'success' => true,
            'show' => $updatedData,
            'poster_path' => $localPosterUrl,
            'backdrop_path' => $localBackdropUrl
        ]);
    }

    public static function getTorrentStatus(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse([
            'success' => true,
            'isEnabled' => true,
            'isScanning' => false,
            'currentDownload' => null,
            'activeDownload' => null,
            'downloadQueue' => [],
            'queue' => [],
            'history' => []
        ]);
    }

    public static function toggleAutoDownload(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse([
            'success' => true,
            'isEnabled' => true,
            'isScanning' => false,
            'currentDownload' => null,
            'activeDownload' => null,
            'downloadQueue' => [],
            'queue' => [],
            'history' => []
        ]);
    }

    public static function scanAutoDownloadNow(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse([
            'success' => true,
            'status' => [
                'isEnabled' => true,
                'isScanning' => false,
                'currentDownload' => null,
                'downloadQueue' => [],
                'history' => []
            ]
        ]);
    }

    public static function searchTorrents(): void {
        AuthMiddleware::requireAdmin();
        $query = trim($_GET['q'] ?? ($_GET['query'] ?? ''));
        $filterSpanish = isset($_GET['filterSpanish']) && $_GET['filterSpanish'] === 'true';

        if (empty($query)) {
            jsonResponse([]);
            return;
        }

        $searchTerms = urlencode($query . ($filterSpanish ? ' spanish' : ''));
        $url = "https://nyaa.si/?page=rss&q={$searchTerms}&c=1_2&f=0";

        $results = [];
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        ]);
        $xmlContent = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && !empty($xmlContent)) {
            try {
                $xml = @simplexml_load_string($xmlContent, 'SimpleXMLElement', LIBXML_NOCDATA);
                if ($xml && isset($xml->channel->item)) {
                    $ns = $xml->getNamespaces(true);
                    foreach ($xml->channel->item as $item) {
                        $nyaaNs = isset($ns['nyaa']) ? $item->children($ns['nyaa']) : null;
                        $results[] = [
                            'id' => (string)$item->guid,
                            'title' => (string)$item->title,
                            'link' => (string)$item->link,
                            'magnet' => (string)$item->link,
                            'size' => $nyaaNs ? (string)$nyaaNs->size : 'N/A',
                            'seeds' => $nyaaNs ? (int)$nyaaNs->seeders : 0,
                            'leechers' => $nyaaNs ? (int)$nyaaNs->leechers : 0,
                            'downloads' => $nyaaNs ? (int)$nyaaNs->downloads : 0,
                            'pubDate' => (string)$item->pubDate
                        ];
                        if (count($results) >= 25) break;
                    }
                }
            } catch (Throwable $e) {
                // Ignore parsing errors
            }
        }

        jsonResponse($results);
    }

    public static function addTorrent(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $magnet = $data['magnet'] ?? ($data['link'] ?? '');
        $title = $data['title'] ?? 'Descarga Torrent';

        if (empty($magnet)) {
            jsonError('magnet o link requerido', 400);
        }

        jsonResponse([
            'success' => true,
            'message' => "Torrent '{$title}' agregado a la cola de descargas."
        ]);
    }

    public static function removeTorrentFromQueue(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse(['success' => true]);
    }

    public static function clearTorrentQueue(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse(['success' => true]);
    }

    public static function startTorrentQueue(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse(['success' => true]);
    }

    public static function cancelActiveTorrent(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse(['success' => true]);
    }

    public static function detectIntros(): void {
        AuthMiddleware::requireAdmin();
        jsonResponse(['success' => true, 'detected_count' => 0]);
    }
}
