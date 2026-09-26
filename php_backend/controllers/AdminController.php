<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../services/LibraryScanner.php';
require_once __DIR__ . '/../services/FfmpegScanner.php';
require_once __DIR__ . '/../services/TmdbScraper.php';

class AdminController {
    public static function isPathWithinAllowedRoots(string $path, array $allowedRoots = []): bool {
        $real = realpath($path);
        if (!$real) return false;

        if (empty($allowedRoots)) {
            $allowedRoots = array_filter([
                defined('LIBRARY_DIR') ? realpath(LIBRARY_DIR) : null,
                defined('ROOT_DIR') ? realpath(ROOT_DIR . '/downloads') : null,
                defined('ROOT_DIR') ? realpath(ROOT_DIR . '/staging') : null,
                realpath(sys_get_temp_dir())
            ]);
        }

        foreach ($allowedRoots as $root) {
            if (!$root) continue;
            $rootPrefix = rtrim($root, '/\\') . DIRECTORY_SEPARATOR;
            if ($real === $root || str_starts_with($real, $rootPrefix)) {
                return true;
            }
        }
        return false;
    }

    public static function validateUpload(array $file, array $allowedExts, array $allowedMimes, int $maxBytes): void {
        if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
            jsonError('Error en la transferencia del archivo subido', 400);
        }

        if ($file['size'] > $maxBytes) {
            $maxMb = round($maxBytes / (1024 * 1024));
            jsonError("El archivo excede el tamaño máximo permitido de {$maxMb}MB", 400);
        }

        $origName = $file['name'] ?? '';
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (!in_array($ext, $allowedExts, true)) {
            jsonError("Extensión de archivo no permitida (.{$ext})", 400);
        }

        $tmpPath = $file['tmp_name'] ?? '';
        if (!file_exists($tmpPath) || !is_readable($tmpPath)) {
            jsonError('Archivo temporal no disponible para inspección', 400);
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $realMime = finfo_file($finfo, $tmpPath);
        finfo_close($finfo);

        if (!in_array($realMime, $allowedMimes, true)) {
            jsonError("Tipo de contenido real inválido: {$realMime}", 400);
        }
    }

    public static function getStaged(): void {
        AuthMiddleware::requireAdmin();
        $db = Database::getConnection();

        // Pre-fetch all staged imports to eliminate N+1 queries
        $existingRows = $db->query("SELECT id, filepath, original_filename FROM staged_imports")->fetchAll();
        $stagedByPath = [];
        $stagedByName = [];
        $missingIds = [];

        foreach ($existingRows as $ex) {
            $stagedByPath[$ex['filepath']] = $ex['id'];
            $stagedByName[$ex['original_filename']] = $ex['id'];
            if (!file_exists($ex['filepath'])) {
                $missingIds[] = $ex['id'];
            }
        }

        // 1. Scan physical staging directories for unindexed video files
        $searchDirs = [
            LIBRARY_DIR . '/downloads/staged',
            LIBRARY_DIR . '/downloads',
            ROOT_DIR . '/downloads/staged',
            ROOT_DIR . '/downloads',
            ROOT_DIR . '/staging'
        ];

        foreach ($searchDirs as $dir) {
            if (!is_dir($dir)) continue;
            $files = scandir($dir);
            foreach ($files as $file) {
                if ($file === '.' || $file === '..') continue;
                $fullPath = $dir . '/' . $file;
                if (!is_file($fullPath)) continue;

                $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                if (!in_array($ext, ['mkv', 'mp4', 'avi', 'mov', 'webm', 'ts'])) continue;

                // Check existence in memory
                if (!isset($stagedByPath[$fullPath]) && !isset($stagedByName[$file])) {
                    $meta = self::parseFilenameMetadata($file);
                    $newId = 'staged_' . md5($fullPath . $file);

                    $ins = $db->prepare("
                        INSERT INTO staged_imports (id, original_filename, filepath, media_type, clean_title, season, episode, filesize, created_at)
                        VALUES (:id, :orig, :fp, :mt, :ct, :s, :e, :sz, NOW())
                    ");
                    $ins->execute([
                        'id' => $newId,
                        'orig' => $file,
                        'fp' => $fullPath,
                        'mt' => $meta['media_type'],
                        'ct' => $meta['clean_title'],
                        's' => $meta['season'],
                        'e' => $meta['episode'],
                        'sz' => filesize($fullPath)
                    ]);
                }
            }
        }

        // 2. Clean up any staged rows whose files no longer exist with a single batch DELETE
        if (!empty($missingIds)) {
            $placeholders = implode(',', array_fill(0, count($missingIds), '?'));
            $db->prepare("DELETE FROM staged_imports WHERE id IN ($placeholders)")->execute($missingIds);
        }

        // 3. Return all current staged items
        $stmt = $db->query("SELECT * FROM staged_imports ORDER BY created_at DESC");
        $rows = $stmt->fetchAll();

        // Ensure key compatibility with both old and new frontends
        $items = array_map(function($r) {
            $r['raw_title'] = $r['original_filename'];
            $r['file_path'] = $r['filepath'];
            $r['source_info'] = ($r['media_type'] === 'movie') ? 'Película en Preparación' : 'Anime en Preparación';
            return $r;
        }, $rows);

        jsonResponse($items);
    }

    public static function parseFilenameMetadata(string $filename): array {
        $info = pathinfo($filename);
        $name = $info['filename'];

        // Remove release group tags like [Group]
        $clean = preg_replace('/^\[[^\]]+\]\s*/', '', $name);
        $clean = preg_replace('/\s*\[[^\]]+\]$/', '', $clean);

        $season = 1;
        $episode = 1;
        $mediaType = 'anime';

        if (preg_match('/(?:S|Season\s*)(\d+)[._ -]*(?:E|Episode\s*|EP\s*)(\d+)/i', $clean, $m)) {
            $season = (int)$m[1];
            $episode = (int)$m[2];
            $pos = strpos($clean, $m[0]);
            $clean = substr($clean, 0, $pos);
        } else if (preg_match('/(?:E|Episode\s*|EP\s*|#\s*)(\d+)/i', $clean, $m)) {
            $episode = (int)$m[1];
            $pos = strpos($clean, $m[0]);
            $clean = substr($clean, 0, $pos);
        } else if (preg_match('/(?:Movie|Pel[ií]cula|Infinity Castle)/i', $clean)) {
            $mediaType = 'movie';
        }

        $clean = str_replace(['.', '_'], ' ', $clean);
        $clean = preg_replace('/\b(?:1080p|720p|2160p|4k|HEVC|H\.?264|AAC.*|CR|WEB-DL|REPACK|Multi-Subs|MSubs.*|V\d+)\b.*$/i', '', $clean);
        $clean = trim(preg_replace('/\s+/', ' ', $clean));

        if (stripos($clean, 'Villager of Level 999') !== false || stripos($clean, 'Lv999') !== false) {
            $clean = 'The Villager of Level 999';
        } else if (stripos($clean, 'Demon Slayer') !== false || stripos($clean, 'Kimetsu no Yaiba') !== false) {
            $clean = 'Demon Slayer Kimetsu no Yaiba Infinity Castle';
            $mediaType = 'movie';
        } else if (stripos($clean, 'Kaiju Girl') !== false) {
            $clean = 'Kaiju Girl Caramelise';
        }

        return [
            'clean_title' => $clean ?: $name,
            'season' => $season,
            'episode' => $episode,
            'media_type' => $mediaType
        ];
    }

    public static function validateStagedEpisode(string $filePath): array {
        if (!file_exists($filePath) || !is_readable($filePath)) {
            jsonError("El archivo de vídeo no existe o no es legible en el disco: {$filePath}", 422);
        }

        $size = @filesize($filePath);
        if ($size === false || $size < 1024 * 1024) { // Menor a 1MB
            jsonError("El archivo de vídeo es demasiado pequeño ({$size} bytes) y parece estar incompleto o dañado.", 422);
        }

        return ['size' => $size, 'valid' => true];
    }

    public static function publishStagedImport(?string $id = null): void {
        self::publishStaged($id);
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
            // Fallback search by original_filename or filepath or partial match
            $stmt = $db->prepare("SELECT * FROM staged_imports WHERE original_filename = :id OR filepath = :id OR id LIKE :id_like LIMIT 1");
            $stmt->execute(['id' => $id, 'id_like' => "%{$id}%"]);
            $item = $stmt->fetch();
        }

        if (!$item) {
            jsonError('Item staged no encontrado', 404);
        }

        self::validateStagedEpisode($item['filepath']);

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
            if (!self::isPathWithinAllowedRoots($item['filepath'])) {
                jsonError('Ruta de archivo staged no permitida', 403);
            }
            $src = $item['filepath'];
            $copied = @copy($src, $targetPath);
            if (!$copied || !file_exists($targetPath) || filesize($targetPath) === 0 || (filesize($src) > 0 && filesize($targetPath) !== filesize($src))) {
                if (file_exists($targetPath)) {
                    @unlink($targetPath);
                }
                jsonError('Fallo al copiar y verificar integridad del archivo en destino', 500);
            }
            @unlink($src);
        }

        $del = $db->prepare("DELETE FROM staged_imports WHERE id = :id");
        $del->execute(['id' => $item['id']]);

        LibraryScanner::runScan();

        jsonResponse(['success' => true]);
    }

    public static function deleteStaged(string $id): void {
        AuthMiddleware::requireAdmin();
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM staged_imports WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $item = $stmt->fetch();

        if ($item && !empty($item['filepath']) && file_exists($item['filepath'])) {
            if (self::isPathWithinAllowedRoots($item['filepath'])) {
                @unlink($item['filepath']);
            }
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
        require_once __DIR__ . '/PlayerController.php';
        $workerCount = TranscodeLimiter::getActiveWorkerCount();
        jsonResponse([
            'success' => true,
            'active_workers' => $workerCount,
            'max_workers' => TranscodeLimiter::$maxWorkers,
            'active_streams' => $workerCount
        ]);
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
                $rawLogs = 'Sin registros disponibles';
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
            'director' => $details['director'] ?? '',
            'writer' => $details['writer'] ?? '',
            'cast_members' => $details['cast_members'] ?? [],
            'poster_path' => $posterPath,
            'backdrop_path' => $backdropPath,
            'media_type' => $mediaType,
            'backdrop_loops' => '[]',
            'genres' => $details['genres'] ?? '',
            'trailer_key' => $details['trailer_key'] ?? null,
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
        $fileSaved = false;
        if (isset($_FILES['videoFile']) && (!empty($_FILES['videoFile']['name']) || $_FILES['videoFile']['error'] !== UPLOAD_ERR_NO_FILE)) {
            self::validateUpload($_FILES['videoFile'], ['mp4', 'mkv', 'webm'], ['video/mp4', 'video/x-matroska', 'video/webm', 'application/octet-stream'], 4294967296);
            $origName = $_FILES['videoFile']['name'];
            $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
            $filename = ($mediaType === 'movie') 
                ? "{$sanitizedDir}.{$ext}" 
                : "{$sanitizedDir} - S" . sprintf("%02d", $season) . "E" . sprintf("%02d", $episode) . ".{$ext}";

            $destPath = $targetDir . '/' . $filename;
            if (!@move_uploaded_file($_FILES['videoFile']['tmp_name'], $destPath) || !file_exists($destPath) || filesize($destPath) === 0) {
                jsonError('Error al guardar el archivo de vídeo subido en el destino', 500);
            }
            $fileSaved = true;
        } else if (!empty($_POST['sourcePath'])) {
            $sourcePath = realpath($_POST['sourcePath']) ?: $_POST['sourcePath'];
            if (!file_exists($sourcePath)) {
                jsonError('Archivo fuente no encontrado', 404);
            }
            if (!self::isPathWithinAllowedRoots($sourcePath)) {
                jsonError('Ruta de archivo fuente no permitida', 403);
            }
            $origName = basename($sourcePath);
            $ext = pathinfo($origName, PATHINFO_EXTENSION);
            $filename = ($mediaType === 'movie') 
                ? "{$sanitizedDir}.{$ext}" 
                : "{$sanitizedDir} - S" . sprintf("%02d", $season) . "E" . sprintf("%02d", $episode) . ".{$ext}";
            $destPath = $targetDir . '/' . $filename;
            if (!@copy($sourcePath, $destPath) || !file_exists($destPath) || filesize($destPath) === 0) {
                jsonError('Error al copiar el archivo fuente en el destino', 500);
            }
            $fileSaved = true;
        }

        if (!$fileSaved) {
            jsonError('No se proporcionó ningún archivo de vídeo válido', 400);
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
        if (!isset($_FILES['file'])) {
            jsonError('Archivo de imagen requerido', 400);
        }
        self::validateUpload($_FILES['file'], ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);

        $dest = LIBRARY_DIR . '/logo.png';
        if (!@move_uploaded_file($_FILES['file']['tmp_name'], $dest) || !file_exists($dest)) {
            jsonError('Error al guardar el logo', 500);
        }
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

    public static function uploadAvatar(): void {
        AuthMiddleware::requireAdmin();
        if (!isset($_FILES['avatar']) && !isset($_FILES['file'])) {
            jsonError('Archivo de avatar requerido', 400);
        }
        $file = $_FILES['avatar'] ?? $_FILES['file'];
        self::validateUpload($file, ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);

        $avatarsDir = LIBRARY_DIR . '/avatars';
        if (!is_dir($avatarsDir)) {
            @mkdir($avatarsDir, 0755, true);
        }

        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        $filename = 'avatar_' . uniqid() . '.' . $ext;
        $destPath = $avatarsDir . '/' . $filename;
        if (!@move_uploaded_file($file['tmp_name'], $destPath) || !file_exists($destPath)) {
            jsonError('Error al guardar el avatar', 500);
        }

        jsonResponse(['success' => true, 'url' => "/library/avatars/{$filename}"]);
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

        if (isset($_FILES['poster'])) {
            self::validateUpload($_FILES['poster'], ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
            $dest = $showDir . '/poster.jpg';
            if (!@move_uploaded_file($_FILES['poster']['tmp_name'], $dest) || !file_exists($dest)) {
                jsonError('Error al guardar el póster', 500);
            }
            $show['poster_path'] = "/library/{$catFolder}/{$realId}/poster.jpg";
            DbHelper::saveShow($show);
        } else if (isset($_FILES['backdrop'])) {
            self::validateUpload($_FILES['backdrop'], ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
            $dest = $showDir . '/backdrop.jpg';
            if (!@move_uploaded_file($_FILES['backdrop']['tmp_name'], $dest) || !file_exists($dest)) {
                jsonError('Error al guardar el backdrop', 500);
            }
            $show['backdrop_path'] = "/library/{$catFolder}/{$realId}/backdrop.jpg";
            DbHelper::saveShow($show);
        } else if (isset($_FILES['avatar'])) {
            self::validateUpload($_FILES['avatar'], ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
            $avatarsDir = LIBRARY_DIR . '/avatars';
            if (!is_dir($avatarsDir)) @mkdir($avatarsDir, 0755, true);
            $ext = strtolower(pathinfo($_FILES['avatar']['name'], PATHINFO_EXTENSION));
            $filename = 'avatar_' . uniqid() . '.' . $ext;
            $destPath = $avatarsDir . '/' . $filename;
            if (!@move_uploaded_file($_FILES['avatar']['tmp_name'], $destPath) || !file_exists($destPath)) {
                jsonError('Error al guardar el avatar', 500);
            }
            jsonResponse(['success' => true, 'url' => "/library/avatars/{$filename}"]);
        }

        jsonResponse(['success' => true]);
    }

    public static function uploadShowLoop(): void {
        AuthMiddleware::requireAdmin();
        $showId = $_POST['showId'] ?? ($_POST['show_id'] ?? '');
        if (empty($showId) || !isset($_FILES['video'])) {
            jsonError('showId y video requerido', 400);
        }

        self::validateUpload($_FILES['video'], ['mp4', 'mkv', 'webm'], ['video/mp4', 'video/x-matroska', 'video/webm', 'application/octet-stream'], 4294967296);

        $show = DbHelper::getShow($showId) ?: DbHelper::findShowByFolderOrTitle($showId, $showId);
        $realId = $show ? $show['id'] : $showId;
        $catFolder = ($show['media_type'] ?? 'anime') === 'movie' ? 'Movies' : 'Anime';
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $realId;
        if (!is_dir($showDir)) @mkdir($showDir, 0755, true);

        $ext = strtolower(pathinfo($_FILES['video']['name'], PATHINFO_EXTENSION)) ?: 'mp4';
        $loopFilename = 'loop_' . uniqid() . '.' . $ext;
        $destPath = $showDir . '/' . $loopFilename;
        if (!@move_uploaded_file($_FILES['video']['tmp_name'], $destPath) || !file_exists($destPath) || filesize($destPath) === 0) {
            jsonError('Error al guardar el vídeo de fondo', 500);
        }

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
        if (empty($episodeId) || !isset($_FILES['image'])) {
            jsonError('episodeId e image requeridos', 400);
        }

        self::validateUpload($_FILES['image'], ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);

        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep) jsonError('Episodio no encontrado', 404);

        $show = DbHelper::getShow($ep['show_id']);
        $catFolder = ($show['media_type'] ?? 'anime') === 'movie' ? 'Movies' : 'Anime';
        $showDir = LIBRARY_DIR . '/' . $catFolder . '/' . $ep['show_id'];
        $thumbName = "ep_{$ep['season_number']}_{$ep['episode_number']}_thumb.jpg";
        $dest = $showDir . '/' . $thumbName;

        if (!@move_uploaded_file($_FILES['image']['tmp_name'], $dest) || !file_exists($dest)) {
            jsonError('Error al guardar la miniatura del episodio', 500);
        }

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
            'director' => !empty($details['director']) ? $details['director'] : ($show['director'] ?? ''),
            'writer' => !empty($details['writer']) ? $details['writer'] : ($show['writer'] ?? ''),
            'cast_members' => !empty($details['cast_members']) ? $details['cast_members'] : ($show['cast_members'] ?? []),
            'poster_path' => $localPosterUrl,
            'backdrop_path' => $localBackdropUrl,
            'media_type' => $mediaType,
            'backdrop_loops' => $show['backdrop_loops'] ?? '[]',
            'genres' => !empty($details['genres']) ? $details['genres'] : ($show['genres'] ?? ''),
            'trailer_key' => $details['trailer_key'] ?? ($show['trailer_key'] ?? null),
            'age_rating' => $show['age_rating'] ?? 'TV-14',
            'status' => !empty($details['status']) ? $details['status'] : ($show['status'] ?? 'finished')
        ];

        DbHelper::saveShow($updatedData);

        // Also enrich existing episodes with TMDB titles and synopses
        if ($mediaType !== 'movie') {
            $episodes = DbHelper::getEpisodesForShow($realShowId);
            $seasonsMap = [];
            foreach ($episodes as $ep) {
                $s = (int)($ep['season_number'] ?? 1);
                if (!isset($seasonsMap[$s])) {
                    try {
                        $seasonsMap[$s] = TmdbScraper::getSeasonEpisodes($tmdbId, $s);
                    } catch (Throwable $e) {
                        $seasonsMap[$s] = [];
                    }
                }
                $epNum = (int)($ep['episode_number'] ?? 1);
                $epMeta = $seasonsMap[$s][$epNum] ?? null;
                if ($epMeta) {
                    if (!empty($epMeta['title'])) $ep['title'] = $epMeta['title'];
                    if (!empty($epMeta['synopsis'])) $ep['synopsis'] = $epMeta['synopsis'];
                    if (empty($ep['thumbnail_path']) && !empty($epMeta['still_path'])) {
                        $ep['thumbnail_path'] = $epMeta['still_path'];
                    }
                    DbHelper::saveEpisode($ep);
                }
            }
        }

        jsonResponse([
            'success' => true,
            'show' => $updatedData,
            'poster_path' => $localPosterUrl,
            'backdrop_path' => $localBackdropUrl
        ]);
    }

    public static function syncAllStatuses(): void {
        AuthMiddleware::requireAdmin();
        $shows = DbHelper::getShows('all');
        $updated = [];

        foreach ($shows as $show) {
            $id = $show['id'];
            $title = $show['title'];
            $mediaType = $show['media_type'] ?? 'anime';

            $searchQuery = str_replace('_', ' ', $title);
            if (strcasecmp($id, 'Ranma1_2') === 0 || strcasecmp($title, 'Ranma1 2') === 0) {
                $searchQuery = 'Ranma 1/2';
            } else if (strcasecmp($id, 'Oshi_no_Ko') === 0 || strcasecmp($title, 'Oshi no Ko') === 0) {
                $searchQuery = 'Oshi no Ko';
            }

            try {
                $res = TmdbScraper::search($searchQuery, $mediaType);
                if (!empty($res[0]['id'])) {
                    $det = TmdbScraper::getDetails((int)$res[0]['id'], $mediaType);
                    if ($det && !empty($det['status'])) {
                        DbHelper::updateShowStatus($id, $det['status']);
                        $updated[] = [
                            'id' => $id,
                            'title' => $title,
                            'status' => $det['status']
                        ];
                    }
                }
            } catch (Throwable $e) {
                // Ignore individual show errors
            }
        }

        jsonResponse([
            'success' => true,
            'count' => count($updated),
            'shows' => $updated
        ]);
    }



    public static function updateEpisodeMetadata(): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $epId = trim($data['episode_id'] ?? '');
        $title = trim($data['title'] ?? '');
        $synopsis = isset($data['synopsis']) ? trim($data['synopsis']) : null;

        if (empty($epId) || empty($title)) {
            jsonError('episode_id y title requeridos', 400);
        }

        $ok = DbHelper::updateEpisodeDetails($epId, $title, $synopsis);
        if ($ok) {
            jsonResponse(['success' => true, 'message' => 'Episodio actualizado correctamente']);
        } else {
            jsonError('Error al actualizar episodio', 500);
        }
    }

    public static function syncShowEpisodesTmdb(string $showId): void {
        AuthMiddleware::requireAdmin();
        $show = DbHelper::getShow($showId);
        if (!$show) {
            $show = DbHelper::findShowByFolderOrTitle($showId, $showId);
        }
        if (!$show) {
            jsonError('Anime o serie no encontrada', 404);
        }

        $mediaType = $show['media_type'] ?? 'anime';
        $tmdbResults = TmdbScraper::search($show['title'], $mediaType);
        if (empty($tmdbResults)) {
            jsonError('No se encontró información en TMDB para este anime', 404);
        }

        $tmdbId = (int)$tmdbResults[0]['id'];
        $episodes = DbHelper::getEpisodesForShow($show['id']);
        $updatedCount = 0;

        $seasonEpsCache = [];
        foreach ($episodes as $ep) {
            $s = (int)$ep['season_number'];
            if (!isset($seasonEpsCache[$s])) {
                try {
                    $seasonEpsCache[$s] = TmdbScraper::getSeasonEpisodes($tmdbId, $s);
                } catch (Throwable $e) {
                    $seasonEpsCache[$s] = [];
                }
            }

            $eNum = (int)$ep['episode_number'];
            if (!empty($seasonEpsCache[$s][$eNum])) {
                $meta = $seasonEpsCache[$s][$eNum];
                $newTitle = !empty($meta['title']) ? $meta['title'] : $ep['title'];
                $newSyn = !empty($meta['synopsis']) ? $meta['synopsis'] : $ep['synopsis'];
                
                DbHelper::updateEpisodeDetails($ep['id'], $newTitle, $newSyn);
                $updatedCount++;
            }
        }

        jsonResponse([
            'success' => true,
            'updated' => $updatedCount,
            'total' => count($episodes),
            'tmdb_title' => $tmdbResults[0]['title'] ?? $show['title']
        ]);
    }
}
