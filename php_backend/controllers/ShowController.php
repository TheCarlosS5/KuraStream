<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/TmdbScraper.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../middleware/RateLimiter.php';

class ShowController {
    public static function isKidsProfileActive(): bool {
        $token = AuthMiddleware::getBearerToken();
        $payload = AuthMiddleware::verifyToken($token);
        if ($payload && !empty($payload['is_kids'])) {
            return true;
        }
        if (isset($_SERVER['HTTP_X_KIDS_MODE']) && $_SERVER['HTTP_X_KIDS_MODE'] === '1') {
            return true;
        }
        return false;
    }

    public static function isAdultOrMaturityRestricted(array $show): bool {
        if (!empty($show['is_adult'])) {
            return true;
        }
        $rating = strtoupper(trim((string)($show['rating_mpaa'] ?? ($show['age_rating'] ?? ''))));
        if (in_array($rating, ['R', 'TV-MA', '18+', 'NC-17', 'RX', 'R18'])) {
            return true;
        }
        $genres = strtolower(is_array($show['genres'] ?? null) ? implode(' ', $show['genres']) : (string)($show['genres'] ?? ''));
        if (str_contains($genres, 'ecchi') || str_contains($genres, 'hentai') || str_contains($genres, 'erotica')) {
            return true;
        }
        return false;
    }

    public static function getShows(): void {
        $type = $_GET['type'] ?? 'all';
        $statusParam = $_GET['status'] ?? 'all';
        $sortParam = $_GET['sort'] ?? 'default';

        $shows = DbHelper::getShows($type);

        if (self::isKidsProfileActive()) {
            $shows = array_values(array_filter($shows, fn($s) => !self::isAdultOrMaturityRestricted($s)));
        }

        if ($statusParam !== 'all') {
            $shows = array_values(array_filter($shows, fn($s) => ($s['status'] ?? 'finished') === $statusParam));
        }

        if ($sortParam === 'year_desc') {
            usort($shows, fn($a, $b) => ($b['year'] ?? 0) - ($a['year'] ?? 0));
        } else if ($sortParam === 'year_asc') {
            usort($shows, fn($a, $b) => ($a['year'] ?? 0) - ($b['year'] ?? 0));
        } else if ($sortParam === 'rating_desc') {
            usort($shows, fn($a, $b) => ($b['rating'] ?? 0) <=> ($a['rating'] ?? 0));
        } else if ($sortParam === 'title_asc') {
            usort($shows, fn($a, $b) => strcasecmp($a['title'], $b['title']));
        }

        jsonResponse($shows);
    }

    private static function getTmdbSearchCache(string $key): ?array {
        $cacheDir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'kura_tmdb_cache';
        $file = $cacheDir . DIRECTORY_SEPARATOR . 'search_' . md5($key) . '.json';
        if (file_exists($file)) {
            $data = json_decode(file_get_contents($file), true);
            if (is_array($data) && isset($data['exp']) && $data['exp'] > time()) {
                return $data['results'];
            }
        }
        return null;
    }

    private static function setTmdbSearchCache(string $key, array $results, int $ttl = 300): void {
        $cacheDir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'kura_tmdb_cache';
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0777, true);
        }
        $file = $cacheDir . DIRECTORY_SEPARATOR . 'search_' . md5($key) . '.json';
        @file_put_contents($file, json_encode([
            'exp' => time() + $ttl,
            'results' => $results
        ]));
    }

    public static function searchShows(): void {
        $query = trim($_GET['query'] ?? '');
        $type = $_GET['type'] ?? 'anime';

        if (empty($query)) {
            jsonError('Término de búsqueda requerido', 400);
        }

        RateLimiter::enforce('tmdb_search', 30, 60);

        $cacheKey = strtolower($type) . '_' . strtolower($query);
        $cached = self::getTmdbSearchCache($cacheKey);
        if ($cached !== null) {
            $results = $cached;
        } else {
            $results = TmdbScraper::search($query, $type);
            self::setTmdbSearchCache($cacheKey, $results, 300);
        }

        if (self::isKidsProfileActive()) {
            $results = array_values(array_filter($results, fn($s) => !self::isAdultOrMaturityRestricted($s)));
        }
        jsonResponse($results);
    }

    public static function getShowDetails(string $id): void {
        try {
            $show = DbHelper::getShow($id);
            if (!$show) {
                $show = DbHelper::findShowByFolderOrTitle($id, $id);
            }
            if (!$show) {
                jsonError('Show no encontrado', 404);
            }

            if (self::isKidsProfileActive() && self::isAdultOrMaturityRestricted($show)) {
                jsonError('Contenido restringido por el perfil infantil activo', 403);
            }

            $rawEpisodes = DbHelper::getEpisodesForShow($show['id']);
            $episodes = array_map([DbHelper::class, 'serializeEpisodeForClient'], $rawEpisodes);
            
            $seasons = [];
            foreach ($episodes as $ep) {
                $sNum = (int)($ep['season_number'] ?? 1);
                if (!isset($seasons[$sNum])) {
                    $seasons[$sNum] = [];
                }
                $seasons[$sNum][] = $ep;
            }

            $show['episodes'] = $episodes;
            $show['seasons'] = $seasons;

            $response = $show;
            $response['show'] = $show;
            $response['episodes'] = $episodes;
            $response['seasons'] = $seasons;

            jsonResponse($response);
        } catch (Throwable $e) {
            if (get_class($e) === 'ExitException' || get_class($e) === 'Exception' && $e->getMessage() === 'ExitException') {
                throw $e;
            }
            jsonError('Error interno al obtener los detalles del show', 500);
        }
    }

    public static function toggleStatus(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $showId = $data['showId'] ?? '';
        $status = $data['status'] ?? '';

        if (empty($showId) || empty($status)) {
            jsonError('showId y status requeridos', 400);
        }

        if (!in_array($status, ['airing', 'upcoming', 'finished'])) {
            if ($status === 'true' || $status === true) $status = 'airing';
            else $status = 'finished';
        }

        $success = DbHelper::updateShowStatus($showId, $status);
        if (!$success) {
            jsonError('Error al actualizar el estado del show', 500);
        }

        jsonResponse(['success' => true, 'status' => $status]);
    }

    public static function getComments(): void {
        $showId = trim((string)($_GET['show_id'] ?? ($_GET['showId'] ?? '')));
        if (empty($showId)) {
            jsonError('show_id requerido', 400);
        }

        $comments = DbHelper::getComments($showId);
        jsonResponse(['success' => true, 'comments' => $comments]);
    }

    public static function addComment(?array $inputData = null): void {
        $authProfile = AuthMiddleware::requireProfile();
        RateLimiter::enforce('comment', 5, 60); // Máx 5 comentarios por minuto
        $username = $authProfile['username'];
        $profile = trim((string)($authProfile['profile_name'] ?? ($authProfile['profile_id'] ?? '')));

        if ($inputData !== null) {
            $data = $inputData;
        } else {
            $raw = file_get_contents('php://input');
            $data = json_decode($raw, true) ?: [];
        }

        $showId = trim((string)($data['show_id'] ?? ($data['showId'] ?? '')));
        $content = trim((string)($data['content'] ?? ($data['comment'] ?? '')));
        $episodeId = trim((string)($data['episode_id'] ?? ''));

        if (empty($showId) || empty($content)) {
            jsonError('show_id y content requeridos', 400);
        }

        if (mb_strlen($content) > 1000) {
            jsonError('El comentario no puede superar 1000 caracteres', 400);
        }

        $show = DbHelper::getShow($showId);
        if (!$show) {
            jsonError('Show no encontrado', 404);
        }

        if (!empty($episodeId)) {
            $ep = DbHelper::getEpisode($episodeId);
            if (!$ep || $ep['show_id'] !== $showId) {
                jsonError('Episodio no encontrado para este show', 404);
            }
        }

        $comment = DbHelper::addComment($showId, $username, $profile, $content, $episodeId);
        jsonResponse(['success' => true, 'comment' => $comment]);
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

    public static function getRandomShow(): void {
        $isKids = self::isKidsProfileActive();
        $show = DbHelper::getRandomShow($isKids);
        jsonResponse([
            'success' => true,
            'show' => $show
        ]);
    }

    public static function deleteShow(string $id): void {
        AuthMiddleware::requireAdmin();
        $show = DbHelper::getShow($id);

        $realId = $show ? $show['id'] : $id;
        $mediaType = $show['media_type'] ?? 'anime';
        $catFolder = ($mediaType === 'movie') ? 'Movies' : 'Anime';

        // Delete only the selected show's canonical source directory. The
        // library scanner imports every folder containing video files, so this
        // must happen before the database record is removed.
        $folderPath = LIBRARY_DIR . '/' . $catFolder . '/' . $realId;
        $realLibPath = realpath(LIBRARY_DIR);
        if (is_dir($folderPath)) {
            $realFolderPath = realpath($folderPath);
            if ($realFolderPath && $realLibPath && str_starts_with($realFolderPath, $realLibPath . DIRECTORY_SEPARATOR)) {
                if (!self::deleteDirectoryRecursive($realFolderPath)) {
                    jsonError('No se pudo eliminar la carpeta de medios. Revisa los permisos e inténtalo de nuevo.', 500);
                }
            }
        }

        // Only remove the catalog entry after the media source is gone.
        DbHelper::deleteShow($realId);

        jsonResponse(['success' => true]);
    }

    private static function deleteDirectoryRecursive(string $dir): bool {
        if (!is_dir($dir)) return false;
        $files = array_diff(scandir($dir), ['.', '..']);
        foreach ($files as $file) {
            $path = $dir . '/' . $file;
            if (is_dir($path)) {
                self::deleteDirectoryRecursive($path);
            } else {
                @unlink($path);
            }
        }
        return @rmdir($dir);
    }
}

