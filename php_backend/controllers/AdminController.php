<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../services/LibraryScanner.php';
require_once __DIR__ . '/../services/FfmpegScanner.php';
require_once __DIR__ . '/../services/TmdbScraper.php';
require_once __DIR__ . '/../services/LibraryPaths.php';

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
            // % and _ in the id must match literally, not as LIKE wildcards.
            $likeId = addcslashes($id, '\\%_');
            $stmt->execute(['id' => $id, 'id_like' => "%{$likeId}%"]);
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
            'max_workers' => TranscodeLimiter::maxWorkers(),
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

        DbHelper::saveEpisodeTimestamps($episodeId, DbHelper::manualTimings($data));
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
        if (!LibraryPaths::isSafeSegment($sanitizedDir)) {
            jsonError('Título inválido para crear la carpeta del show', 400);
        }
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
        if (!LibraryPaths::isSafeSegment($sanitizedDir)) {
            jsonError('Título inválido para crear la carpeta del show', 400);
        }
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
            // Import sources may live in the library, downloads/ or staging/. The system temp directory is
            // deliberately excluded: it is world-writable and would let any file there be copied into /library.
            // An empty list must deny (isPathWithinAllowedRoots() falls back to its defaults, temp included).
            $importRoots = array_values(array_filter([
                realpath(LIBRARY_DIR),
                realpath(ROOT_DIR . '/downloads'),
                realpath(ROOT_DIR . '/staging'),
            ]));
            if (empty($importRoots) || !self::isPathWithinAllowedRoots($sourcePath, $importRoots)) {
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

        // Enrich show metadata via TMDB
        $existingShow = DbHelper::findShowByFolderOrTitle($sanitizedDir, $title);
        $details = $tmdbId ? TmdbScraper::getDetails($tmdbId, $mediaType) : null;
        if (!$details) {
            $searchRes = TmdbScraper::search($title, $mediaType);
            if (!empty($searchRes)) {
                $details = TmdbScraper::getDetails((int)$searchRes[0]['id'], $mediaType);
            }
        }

        $posterPath = $existingShow['poster_path'] ?? '';
        $backdropPath = $existingShow['backdrop_path'] ?? '';
        if ($details) {
            if (empty($posterPath) && !empty($details['poster_path'])) {
                $destPoster = $showDir . '/poster.jpg';
                if (TmdbScraper::downloadFile($details['poster_path'], $destPoster)) {
                    $posterPath = "/library/{$catFolder}/{$sanitizedDir}/poster.jpg";
                }
            }
            if (empty($backdropPath) && !empty($details['backdrop_path'])) {
                $destBackdrop = $showDir . '/backdrop.jpg';
                if (TmdbScraper::downloadFile($details['backdrop_path'], $destBackdrop)) {
                    $backdropPath = "/library/{$catFolder}/{$sanitizedDir}/backdrop.jpg";
                }
            }
        }

        DbHelper::saveShow([
            'id' => $sanitizedDir,
            'title' => $title,
            'synopsis' => $details['synopsis'] ?? ($existingShow['synopsis'] ?? ''),
            'rating' => $details['rating'] ?? ($existingShow['rating'] ?? 0.0),
            'year' => $details['year'] ?? ($existingShow['year'] ?? (int)date('Y')),
            'studio' => $details['studio'] ?? ($existingShow['studio'] ?? ''),
            'director' => $details['director'] ?? ($existingShow['director'] ?? ''),
            'writer' => $details['writer'] ?? ($existingShow['writer'] ?? ''),
            'cast_members' => $details['cast_members'] ?? ($existingShow['cast_members'] ?? []),
            'poster_path' => $posterPath,
            'backdrop_path' => $backdropPath,
            'media_type' => $mediaType,
            'genres' => $details['genres'] ?? ($existingShow['genres'] ?? ''),
            'trailer_key' => $details['trailer_key'] ?? ($existingShow['trailer_key'] ?? null),
            'age_rating' => $details['age_rating'] ?? ($existingShow['age_rating'] ?? 'TV-14'),
            'status' => $details['status'] ?? ($existingShow['status'] ?? 'finished'),
            'tmdb_id' => $details['id'] ?? ($tmdbId ?: ($existingShow['tmdb_id'] ?? null))
        ]);


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
        if (!LibraryPaths::isSafeSegment($realId)) {
            jsonError('Identificador de show inválido', 400);
        }
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
        if (!LibraryPaths::isSafeSegment($realId)) {
            jsonError('Identificador de show inválido', 400);
        }
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
            $wasRegistered = in_array($loopUrl, $loops, true);
            $loops = array_values(array_filter($loops, fn($u) => $u !== $loopUrl));
            $show['backdrop_loops'] = $loops;
            DbHelper::saveShow($show);

            // Only delete a file this show actually registered, and only inside the library.
            // Loop URLs are "/library/<rel>" (see uploadShowLoop) and must map onto LIBRARY_DIR,
            // which may live outside ROOT_DIR when MEDIA_LIBRARY_PATH is configured.
            $localFile = $wasRegistered ? self::resolveLibraryUrlToFile($loopUrl) : null;
            if ($localFile !== null) @unlink($localFile);
        }

        jsonResponse(['success' => true]);
    }

    /**
     * Maps a public "/library/..." URL to a real file inside LIBRARY_DIR, or null when the
     * path escapes the library (../, symlinks) or is not a regular file.
     */
    public static function resolveLibraryUrlToFile(string $url): ?string {
        $prefix = '/library/';
        if (!str_starts_with($url, $prefix)) return null;
        $libReal = realpath(LIBRARY_DIR);
        $candidate = realpath(LIBRARY_DIR . '/' . substr($url, strlen($prefix)));
        if ($libReal === false || $candidate === false || !is_file($candidate)) return null;
        $libRoot = rtrim($libReal, '/\\') . DIRECTORY_SEPARATOR;
        return str_starts_with($candidate, $libRoot) ? $candidate : null;
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
        if (!LibraryPaths::isSafeSegment($ep['show_id'])) {
            jsonError('Identificador de show inválido', 400);
        }
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
        if (!LibraryPaths::isSafeSegment($realShowId)) {
            jsonError('showId inválido o requerido', 400);
        }

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

    /** Counts running processes whose command name is $name (Linux /proc; 0 where it is not available). */
    private static function countProcesses(string $name): int {
        if (!is_dir('/proc')) return 0;
        $count = 0;
        foreach (@scandir('/proc') ?: [] as $entry) {
            if (!ctype_digit($entry)) continue;
            $comm = @file_get_contents("/proc/$entry/comm");
            if ($comm !== false && trim($comm) === $name) $count++;
        }
        return $count;
    }

    /**
     * What the operator wants to know when "it feels slow": is the worker alive, how full are the disks, how many
     * ffmpeg processes and Watch Party viewers are there, when was the last backup, how busy is the machine.
     */
    public static function systemHealth(): array {
        require_once __DIR__ . '/../services/JobQueue.php';
        require_once __DIR__ . '/../services/BackupService.php';
        $disk = function (string $path): ?array {
            $dir = is_dir($path) ? $path : dirname($path);
            $free = @disk_free_space($dir);
            $total = @disk_total_space($dir);
            return ($free === false || $total === false || $total <= 0) ? null
                : ['free_bytes' => (int)$free, 'total_bytes' => (int)$total, 'used_percent' => (int)round(100 * (1 - $free / $total))];
        };

        $jobs = ['queued' => 0, 'running' => 0, 'failed_24h' => 0];
        $worker = ['alive' => false, 'last_seen' => null];
        $partyViewers = 0;
        try {
            $db = Database::getConnection();
            foreach ($db->query("SELECT status, COUNT(*) c FROM jobs WHERE status IN ('queued', 'running') GROUP BY status")->fetchAll() as $row) {
                $jobs[$row['status']] = (int)$row['c'];
            }
            $stmt = $db->prepare("SELECT COUNT(*) FROM jobs WHERE status = 'failed' AND finished_at >= :t");
            $stmt->execute(['t' => time() - 86400]);
            $jobs['failed_24h'] = (int)$stmt->fetchColumn();
            $worker['alive'] = JobQueue::workerAlive();
            $last = $db->query("SELECT MAX(last_seen) FROM worker_status")->fetchColumn();
            $worker['last_seen'] = $last ? gmdate('Y-m-d\TH:i:s\Z', (int)$last) : null;
            $partyViewers = (int)$db->query("SELECT COUNT(*) FROM party_members WHERE last_ping >= DATE_SUB(NOW(), INTERVAL 60 SECOND)")->fetchColumn();
        } catch (Throwable $e) {
            // the jobs/party tables may not exist on a half-migrated database: report what we can
        }

        $backups = BackupService::list();
        $load = function_exists('sys_getloadavg') ? @sys_getloadavg() : false;
        return [
            'worker' => $worker,
            'jobs' => $jobs + ['mode' => strtolower(trim((string)getenv('JOBS_MODE'))) ?: 'auto'],
            'backups' => [
                'available' => BackupService::isAvailable(),
                'count' => count($backups),
                'last_file' => $backups[0]['file'] ?? null,
                'last_at' => isset($backups[0]) ? gmdate('Y-m-d\TH:i:s\Z', $backups[0]['modified']) : null,
            ],
            'disk' => ['library' => $disk(LIBRARY_DIR), 'backups' => $disk(BackupService::directory())],
            'processes' => [
                'ffmpeg' => self::countProcesses('ffmpeg'),
                'php_fpm' => self::countProcesses('php-fpm') + self::countProcesses('php-fpm8.4') + self::countProcesses('php-fpm8.3') + self::countProcesses('php-fpm8.2'),
            ],
            'party_viewers' => $partyViewers,
            'load_average' => is_array($load) ? array_map(fn($v) => round($v, 2), $load) : null,
            'cpu_cores' => is_readable('/proc/cpuinfo') ? preg_match_all('/^processor\s*:/m', (string)@file_get_contents('/proc/cpuinfo')) : null,
            'direct_play_offload' => PlayerController::useAccelRedirect(),
            'server_software' => preg_replace('#/.*$#', '', (string)($_SERVER['SERVER_SOFTWARE'] ?? '')) ?: 'php',
            'migrations_ok' => Database::migrationProblem() === null,
        ];
    }

    public static function getDiagnostics(): void {
        AuthMiddleware::requireAdmin();

        $dbStatus = 'disconnected';
        $dbError = null;
        try {
            $db = Database::getConnection();
            $db->query('SELECT 1');
            $dbStatus = 'connected';
        } catch (Throwable $e) {
            $dbError = 'Database unavailable';
        }

        $libDir = defined('LIBRARY_DIR') ? LIBRARY_DIR : (ROOT_DIR . '/library');
        $storage = [
            'path' => $libDir,
            'exists' => is_dir($libDir),
            'readable' => is_readable($libDir),
            'writable' => is_writable($libDir),
            'free_bytes' => @disk_free_space($libDir) ?: 0,
            'total_bytes' => @disk_total_space($libDir) ?: 0
        ];

        $ffmpegPath = FfmpegScanner::getFfmpegPath();
        $ffprobePath = FfmpegScanner::getFfprobePath();

        $ffmpegVersion = 'unknown';
        $ffmpegOk = false;
        if ($ffmpegPath) {
            $out = @shell_exec(escapeshellcmd($ffmpegPath) . ' -version 2>&1');
            if ($out && preg_match('/ffmpeg version ([^\s]+)/i', $out, $m)) {
                $ffmpegVersion = $m[1];
                $ffmpegOk = true;
            }
        }

        $ffprobeVersion = 'unknown';
        $ffprobeOk = false;
        if ($ffprobePath) {
            $out = @shell_exec(escapeshellcmd($ffprobePath) . ' -version 2>&1');
            if ($out && preg_match('/ffprobe version ([^\s]+)/i', $out, $m)) {
                $ffprobeVersion = $m[1];
                $ffprobeOk = true;
            }
        }

        $tmdbHealth = TmdbScraper::checkHealth();

        // Subtitle assets
        $octopusJs = ROOT_DIR . '/frontend/assets/subtitles-octopus/subtitles-octopus.js';
        $fontsDir = ROOT_DIR . '/library/fonts';
        $fontsCount = is_dir($fontsDir) ? count(glob($fontsDir . '/*.*') ?: []) : 0;

        require_once __DIR__ . '/PlayerController.php';
        $activeWorkers = TranscodeLimiter::getActiveWorkerCount();

        $subsCacheDir = SubtitleCache::dir();
        if (!is_dir($subsCacheDir)) {
            @mkdir($subsCacheDir, 0777, true);
        }
        $subsCacheWritable = is_dir($subsCacheDir) && is_writable($subsCacheDir);

        $diagnostics = [
            'database' => [
                'status' => $dbStatus,
                'connected' => ($dbStatus === 'connected'),
                'label' => ($dbStatus === 'connected') ? 'OK' : 'Error',
                'error' => $dbError
            ],
            'storage' => array_merge($storage, [
                'label' => ($storage['exists'] && $storage['readable']) ? 'OK' : 'Error',
                'writable_label' => $storage['writable'] ? 'Yes' : 'No'
            ]),
            'ffmpeg' => [
                'installed' => $ffmpegOk,
                'path' => $ffmpegPath,
                'version' => $ffmpegOk ? $ffmpegVersion : 'missing',
                'label' => $ffmpegOk ? $ffmpegVersion : 'missing',
                'ffmpeg_version' => $ffmpegVersion,
                'ffprobe_version' => $ffprobeVersion
            ],
            'ffprobe' => [
                'installed' => $ffprobeOk,
                'path' => $ffprobePath,
                'version' => $ffprobeOk ? $ffprobeVersion : 'missing',
                'label' => $ffprobeOk ? $ffprobeVersion : 'missing',
                'ffprobe_version' => $ffprobeVersion
            ],
            'tmdb' => array_merge($tmdbHealth, [
                'configured_label' => (!empty($tmdbHealth['configured'])) ? 'Yes' : 'No',
                'auth_label' => (($tmdbHealth['auth'] ?? '') === 'OK' && ($tmdbHealth['reachable'] ?? '') === 'OK') ? 'OK' : 'Error'
            ]),
            'php' => [
                'version' => PHP_VERSION,
                'upload_max_filesize' => ini_get('upload_max_filesize') ?: '2M',
                'post_max_size' => ini_get('post_max_size') ?: '8M',
                'memory_limit' => ini_get('memory_limit') ?: '128M',
                'max_execution_time' => (int)ini_get('max_execution_time')
            ],
            'subtitle_assets' => [
                'octopus_available' => file_exists($octopusJs),
                'label' => file_exists($octopusJs) ? 'OK' : 'Error',
                'fonts_dir_exists' => is_dir($fontsDir),
                'fonts_count' => $fontsCount,
                'cache_writable' => $subsCacheWritable,
                'cache_writable_label' => $subsCacheWritable ? 'Yes' : 'No'
            ],
            'transcode' => [
                'active_workers' => $activeWorkers,
                'max_workers' => TranscodeLimiter::maxWorkers(),
                'label' => "{$activeWorkers} / " . TranscodeLimiter::maxWorkers()
            ],
            'system' => self::systemHealth()
        ];

        jsonResponse(array_merge([
            'success' => true,
            'diagnostics' => $diagnostics
        ], $diagnostics));
    }

    public static function searchTmdb(): void {
        AuthMiddleware::requireAdmin();
        $query = trim($_GET['query'] ?? ($_GET['q'] ?? ''));
        $type = $_GET['type'] ?? 'anime';

        if (empty($query)) {
            jsonResponse([]);
            return;
        }

        $results = TmdbScraper::search($query, $type);
        jsonResponse($results);
    }

    /** Re-fetches a show's per-season art/metadata and looks up its intros on AniSkip. */
    public static function syncShowSeasons(string $showId): void {
        $admin = AuthMiddleware::requireAdmin();
        require_once __DIR__ . '/../services/IntroSync.php';
        $data = json_decode(file_get_contents('php://input'), true) ?: [];
        $force = !empty($data['force']) || !empty($_GET['force']);
        require_once __DIR__ . '/../services/JobQueue.php';
        if (JobQueue::shouldQueue()) {
            if (!DbHelper::getShow($showId)) {
                jsonError('Show no encontrado', 404);
            }
            $job = JobQueue::enqueue('season_sync', ['show_id' => $showId, 'force' => $force], (string)($admin['username'] ?? ''));
            jsonResponse(['success' => true, 'queued' => true, 'job_id' => $job['id']], 202);
        }
        @set_time_limit(300);
        $seasons = SeasonSync::syncShow($showId, $force);
        if (!empty($seasons['error'])) {
            jsonError('Show no encontrado', 404);
        }
        $intros = IntroSync::syncShow($showId, $force);
        jsonResponse(['success' => true, 'seasons' => $seasons, 'intros' => $intros]);
    }

    public static function detectTimings(?string $epId = null): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $episodeId = $epId ?: ($data['episode_id'] ?? ($_GET['episode_id'] ?? ($data['episodeId'] ?? ($_GET['episodeId'] ?? ''))));
        if (empty($episodeId)) {
            jsonError('episode_id requerido', 400);
        }

        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep) {
            jsonError('Episodio no encontrado', 404);
        }

        $chapters = !empty($ep['chapters']) ? $ep['chapters'] : [];
        if (empty($chapters) && !empty($ep['filepath']) && file_exists($ep['filepath'])) {
            $probe = FfmpegScanner::probeVideo($ep['filepath']);
            if (!empty($probe['chapters'])) {
                $chapters = $probe['chapters'];
                DbHelper::saveEpisodeTimestamps($episodeId, ['chapters' => $chapters]);
            }
        }

        // Level 1: MKV Chapters regex
        $detectedIntro = null;
        $detectedOutro = null;
        foreach ($chapters as $ch) {
            $t = trim($ch['title'] ?? ($ch['tags']['title'] ?? ''));
            $st = (float)($ch['start_time'] ?? ($ch['start'] ?? 0));
            $et = (float)($ch['end_time'] ?? ($ch['end'] ?? 0));

            if (preg_match('/^(op|opening|intro|theme|opening\s*theme)$/i', $t) ||
                preg_match('/\b(opening|intro)\b/i', $t) ||
                (preg_match('/\bop\b/i', $t) && !preg_match('/\b(episode|option)\b/i', $t))) {
                $detectedIntro = [
                    'start' => (int)round($st),
                    'end' => (int)round($et)
                ];
            }

            if (preg_match('/^(ed|ending|outro|credits|ending\s*theme)$/i', $t) ||
                preg_match('/\b(ending|outro|credits)\b/i', $t) ||
                (preg_match('/\bed\b/i', $t) && !preg_match('/\b(edition|editor)\b/i', $t))) {
                $detectedOutro = [
                    'start' => (int)round($st),
                    'end' => (int)round($et)
                ];
            }
        }

        if ($detectedIntro !== null || $detectedOutro !== null) {
            $introStart = $detectedIntro['start'] ?? null;
            $introEnd = $detectedIntro['end'] ?? null;
            $outroStart = $detectedOutro['start'] ?? null;
            jsonResponse([
                'success' => true,
                'method' => 'chapters',
                'confidence' => 0.95,
                'intro_start' => $introStart,
                'intro_end' => $introEnd,
                'outro_start' => $outroStart,
                'outro_end' => $detectedOutro['end'] ?? null,
                'proposed_intro_start' => $introStart,
                'proposed_intro_end' => $introEnd,
                'proposed_outro_start' => $outroStart,
                'matched_episodes' => [$episodeId],
                'episode_id' => $episodeId
            ]);
            return;
        }

        // Level 1b: AniSkip community timings for this episode's MyAnimeList entry
        require_once __DIR__ . '/../services/SeasonSync.php';
        $seasonRow = !empty($ep['show_id']) ? DbHelper::getShowSeason($ep['show_id'], (int)$ep['season_number']) : null;
        $target = $seasonRow ? SeasonSync::malEpisode(json_decode($seasonRow['mal_map'] ?? '[]', true) ?: [], (int)$ep['episode_number']) : null;
        if ($target !== null && (float)($ep['duration'] ?? 0) > 0) {
            $skip = AnimeSources::skipTimes($target['mal_id'], $target['episode'], (float)$ep['duration']);
            if (!empty($skip['op'])) {
                $introStart = (int)round($skip['op'][0]);
                $introEnd = (int)round($skip['op'][1]);
                $outroStart = !empty($skip['ed']) ? (int)floor($skip['ed'][0]) : null;
                jsonResponse([
                    'success' => true,
                    'method' => 'aniskip',
                    'confidence' => 0.9,
                    'intro_start' => $introStart,
                    'intro_end' => $introEnd,
                    'outro_start' => $outroStart,
                    'proposed_intro_start' => $introStart,
                    'proposed_intro_end' => $introEnd,
                    'proposed_outro_start' => $outroStart,
                    'matched_episodes' => [$episodeId],
                    'mal_id' => $target['mal_id'],
                    'mal_episode' => $target['episode'],
                    'episode_id' => $episodeId
                ]);
                return;
            }
        }

        // Level 2: Sibling episode / Season repetition
        $siblings = !empty($ep['show_id']) ? DbHelper::getEpisodesForShow($ep['show_id']) : [];
        $siblingWithTimings = null;
        $siblingWithFile = null;

        foreach ($siblings as $sib) {
            if ($sib['id'] !== $ep['id'] && (int)$sib['season_number'] === (int)$ep['season_number']) {
                if (!empty($sib['intro_start']) && !empty($sib['intro_end'])) {
                    $siblingWithTimings = $sib;
                    break;
                }
                if ($siblingWithFile === null && !empty($sib['filepath']) && file_exists($sib['filepath'])) {
                    $siblingWithFile = $sib;
                }
            }
        }

        if ($siblingWithTimings !== null) {
            $introStart = (int)$siblingWithTimings['intro_start'];
            $introEnd = (int)$siblingWithTimings['intro_end'];
            $outroStart = !empty($siblingWithTimings['outro_start']) ? (int)$siblingWithTimings['outro_start'] : null;
            jsonResponse([
                'success' => true,
                'method' => 'season_sibling',
                'confidence' => 0.85,
                'intro_start' => $introStart,
                'intro_end' => $introEnd,
                'outro_start' => $outroStart,
                'proposed_intro_start' => $introStart,
                'proposed_intro_end' => $introEnd,
                'proposed_outro_start' => $outroStart,
                'matched_episodes' => [$siblingWithTimings['id'], $episodeId],
                'episode_id' => $episodeId
            ]);
            return;
        }

        // Level 2 (B): Audio Correlation across sibling episodes
        $ffmpeg = FfmpegScanner::getFfmpegPath();
        if ($ffmpeg && $siblingWithFile && !empty($ep['filepath']) && file_exists($ep['filepath'])) {
            $corr = self::correlateAudioOpening($ffmpeg, $ep['filepath'], $siblingWithFile['filepath']);
            if ($corr !== null) {
                jsonResponse([
                    'success' => true,
                    'method' => 'audio_correlation',
                    'confidence' => $corr['confidence'],
                    'intro_start' => $corr['intro_start'],
                    'intro_end' => $corr['intro_end'],
                    'outro_start' => $corr['outro_start'] ?? null,
                    'proposed_intro_start' => $corr['intro_start'],
                    'proposed_intro_end' => $corr['intro_end'],
                    'proposed_outro_start' => $corr['outro_start'] ?? null,
                    'matched_episodes' => [$siblingWithFile['id'], $episodeId],
                    'episode_id' => $episodeId
                ]);
                return;
            }
        }

        // No timings detected
        jsonResponse([
            'success' => true,
            'method' => 'none',
            'confidence' => 0.0,
            'intro_start' => null,
            'intro_end' => null,
            'outro_start' => null,
            'proposed_intro_start' => null,
            'proposed_intro_end' => null,
            'proposed_outro_start' => null,
            'matched_episodes' => [],
            'episode_id' => $episodeId
        ]);
    }

    public static function applyTimings(?array $payload = null): void {
        AuthMiddleware::requireAdmin();
        $raw = file_get_contents('php://input');
        $data = $payload ?: (json_decode($raw, true) ?: []);

        $episodeId = $data['episode_id'] ?? ($data['episodeId'] ?? '');
        $showId = $data['show_id'] ?? ($data['showId'] ?? '');
        $season = isset($data['season']) ? (int)$data['season'] : (isset($data['season_number']) ? (int)$data['season_number'] : null);
        $applyToSeason = !empty($data['apply_to_season']) || !empty($data['applyToSeason']);

        $introStart = isset($data['intro_start']) && $data['intro_start'] !== null ? (int)$data['intro_start'] : null;
        $introEnd = isset($data['intro_end']) && $data['intro_end'] !== null ? (int)$data['intro_end'] : null;
        $outroStart = isset($data['outro_start']) && $data['outro_start'] !== null ? (int)$data['outro_start'] : null;

        $appliedCount = 0;

        if ($applyToSeason && !empty($showId) && $season !== null) {
            $episodes = DbHelper::getEpisodesForShow($showId);
            foreach ($episodes as $ep) {
                if ((int)$ep['season_number'] === $season) {
                    DbHelper::saveEpisodeTimestamps($ep['id'], [
                        'intro_start' => $introStart,
                        'intro_end' => $introEnd,
                        'outro_start' => $outroStart,
                        'intro_source' => 'manual',
                        'outro_source' => 'manual'
                    ]);
                    $appliedCount++;
                }
            }
        } else if (!empty($episodeId)) {
            $ep = DbHelper::getEpisode($episodeId);
            if (!$ep) {
                jsonError('Episodio no encontrado', 404);
            }
            DbHelper::saveEpisodeTimestamps($episodeId, [
                'intro_start' => $introStart,
                'intro_end' => $introEnd,
                'outro_start' => $outroStart,
                'intro_source' => 'manual',
                'outro_source' => 'manual'
            ]);
            $appliedCount = 1;

            if ($applyToSeason && !empty($ep['show_id'])) {
                $episodes = DbHelper::getEpisodesForShow($ep['show_id']);
                foreach ($episodes as $sibling) {
                    if ((int)$sibling['season_number'] === (int)$ep['season_number'] && $sibling['id'] !== $episodeId) {
                        DbHelper::saveEpisodeTimestamps($sibling['id'], [
                            'intro_start' => $introStart,
                            'intro_end' => $introEnd,
                            'outro_start' => $outroStart,
                            'intro_source' => 'manual',
                            'outro_source' => 'manual'
                        ]);
                        $appliedCount++;
                    }
                }
            }
        } else {
            jsonError('episode_id o (show_id y season) requerido', 400);
        }

        jsonResponse([
            'success' => true,
            'applied_count' => $appliedCount,
            'intro_start' => $introStart,
            'intro_end' => $introEnd,
            'outro_start' => $outroStart,
            'proposed_intro_start' => $introStart,
            'proposed_intro_end' => $introEnd,
            'proposed_outro_start' => $outroStart
        ]);
    }

    private static function correlateAudioOpening(string $ffmpeg, string $file1, string $file2): ?array {
        $devNull = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
        $cmd1 = escapeshellcmd($ffmpeg) . ' -nostdin -ss 0 -t 200 -i ' . escapeshellarg($file1) . ' -vn -ac 1 -ar 100 -f f32le pipe:1 2>' . $devNull;
        $cmd2 = escapeshellcmd($ffmpeg) . ' -nostdin -ss 0 -t 200 -i ' . escapeshellarg($file2) . ' -vn -ac 1 -ar 100 -f f32le pipe:1 2>' . $devNull;

        // shell_exec has no timeout: a slow disk or a huge FLAC track used to hang the request.
        require_once __DIR__ . '/../services/FfmpegScanner.php';
        $raw1 = FfmpegScanner::executeBoundedCommand($cmd1, 60, false);
        $raw2 = $raw1 ? FfmpegScanner::executeBoundedCommand($cmd2, 60, false) : null;

        if (!$raw1 || !$raw2 || strlen($raw1) < 800 || strlen($raw2) < 800) {
            return null;
        }

        $samples1 = array_values(unpack('f*', $raw1) ?: []);
        $samples2 = array_values(unpack('f*', $raw2) ?: []);

        $len = min(count($samples1), count($samples2));
        if ($len < 200) return null;

        // Compute short-time energy (1 second = 100 samples)
        $energy1 = [];
        $energy2 = [];
        $window = 50; // 0.5s chunks
        for ($i = 0; $i < $len - $window; $i += $window) {
            $e1 = 0.0;
            $e2 = 0.0;
            for ($w = 0; $w < $window; $w++) {
                $e1 += abs($samples1[$i + $w]);
                $e2 += abs($samples2[$i + $w]);
            }
            $energy1[] = $e1;
            $energy2[] = $e2;
        }

        $eCount = count($energy1);
        if ($eCount < 4) return null;

        // Slide window of 90 seconds (180 chunks of 0.5s) or best match
        $opChunks = min(180, (int)max(2, $eCount * 0.75));

        $bestCorr = 0.0;
        $bestStartChunk = 0;

        for ($start = 0; $start <= $eCount - $opChunks; $start++) {
            $dot = 0.0;
            $norm1 = 0.0;
            $norm2 = 0.0;
            for ($c = 0; $c < $opChunks; $c++) {
                $v1 = $energy1[$start + $c];
                $v2 = $energy2[$start + $c];
                $dot += $v1 * $v2;
                $norm1 += $v1 * $v1;
                $norm2 += $v2 * $v2;
            }
            $denom = sqrt($norm1 * $norm2);
            $corr = $denom > 0 ? ($dot / $denom) : 0;
            if ($corr > $bestCorr) {
                $bestCorr = $corr;
                $bestStartChunk = $start;
            }
        }

        if ($bestCorr >= 0.70) {
            $startSec = (int)round($bestStartChunk * 0.5);
            $endSec = $startSec + (int)round($opChunks * 0.5);
            return [
                'confidence' => round($bestCorr, 2),
                'intro_start' => $startSec,
                'intro_end' => $endSec
            ];
        }

        return null;
    }
}

