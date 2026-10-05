<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/PlayerController.php';

class HistoryController {
    private static function resolveUserAndProfile(): array {
        $profilePayload = AuthMiddleware::requireProfile();
        $username = $profilePayload['username'];
        $profileName = $profilePayload['profile_name'] ?? ($profilePayload['profile_id'] ?? '');
        return [$username, trim((string)$profileName)];
    }

    public static function getHistory(): void {
        list($username, $profile) = self::resolveUserAndProfile();

        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT w.*, 
                   e.show_id, e.season_number, e.episode_number, e.thumbnail_path, e.duration as ep_duration,
                   s.title as show_title, s.poster_path, s.backdrop_path
            FROM watch_history w
            LEFT JOIN episodes e ON w.episode_id = e.id
            LEFT JOIN shows s ON e.show_id = s.id
            WHERE w.username = :user AND w.profile_name = :prof
            ORDER BY w.updated_at DESC
        ");
        $stmt->execute(['user' => $username, 'prof' => $profile]);
        $history = $stmt->fetchAll();

        foreach ($history as &$item) {
            $item['progress_seconds'] = (float)($item['progress_seconds'] ?? 0);
            $item['duration'] = (float)(!empty($item['duration']) ? $item['duration'] : ($item['ep_duration'] ?? 0));
            $item['completed'] = (bool)($item['completed'] ?? false);
            // PDO returns strings; typed clients (Android) expect numbers.
            if (isset($item['season_number'])) $item['season_number'] = (int)$item['season_number'];
            if (isset($item['episode_number'])) $item['episode_number'] = (int)$item['episode_number'];
        }

        jsonResponse($history);
    }

    /**
     * "Continuar viendo": one entry per show, built from the episode watched most recently.
     * - Still mid-episode: that episode with its progress.
     * - Finished it: the next episode (regular seasons in order; specials only follow specials), or
     *   nothing at all when it was the last one, so a series watched to the end leaves the row.
     * Picking "the newest unfinished episode" instead resurfaced an old half-watched episode (e.g. 9)
     * after the whole series had been watched.
     */
    public static function getContinueWatching(): void {
        list($username, $profile) = self::resolveUserAndProfile();
        $limit = max(1, min(50, (int)($_GET['limit'] ?? 20)));

        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT w.episode_id, w.progress_seconds, w.duration, w.completed, w.updated_at,
                   e.show_id, e.season_number, e.episode_number, e.title AS episode_title,
                   e.thumbnail_path, e.duration AS ep_duration, e.outro_start,
                   s.title AS show_title, s.poster_path, s.backdrop_path, s.media_type
            FROM watch_history w
            JOIN episodes e ON w.episode_id = e.id
            JOIN shows s ON e.show_id = s.id
            WHERE w.username = :user AND w.profile_name = :prof
        ");
        $stmt->execute(['user' => $username, 'prof' => $profile]);
        $rows = $stmt->fetchAll();

        $items = self::buildContinueWatching($rows, function (array $showIds) use ($db) {
            $placeholders = implode(',', array_fill(0, count($showIds), '?'));
            $q = $db->prepare("
                SELECT id, show_id, season_number, episode_number, title, thumbnail_path, duration
                FROM episodes WHERE show_id IN ($placeholders)
            ");
            $q->execute(array_values($showIds));
            return $q->fetchAll();
        }, $limit);
        jsonResponse(self::withSeasonArt($items));
    }

    /**
     * A show's own poster is the art of its latest season; an item from season 1 shows season 1's
     * art instead. The show-wide images stay available as show_poster_path / show_backdrop_path.
     */
    public static function withSeasonArt(array $items): array {
        $cache = [];
        foreach ($items as &$item) {
            $showId = (string)($item['show_id'] ?? '');
            if ($showId === '' || !isset($item['season_number'])) continue;
            if (!array_key_exists($showId, $cache)) {
                $cache[$showId] = [];
                foreach (DbHelper::getShowSeasons($showId) as $row) $cache[$showId][(int)$row['season_number']] = $row;
            }
            $season = $cache[$showId][(int)$item['season_number']] ?? null;
            $item['show_poster_path'] = $item['poster_path'] ?? '';
            $item['show_backdrop_path'] = $item['backdrop_path'] ?? '';
            if ($season && !empty($season['poster_path'])) $item['poster_path'] = $season['poster_path'];
            if ($season && !empty($season['backdrop_path'])) $item['backdrop_path'] = $season['backdrop_path'];
        }
        unset($item);
        return $items;
    }

    /** True when the viewer reached the credits (or 90 %) of the episode. */
    public static function isFinishedWatching(array $row): bool {
        if (!empty($row['completed']) && $row['completed'] !== '0') return true;
        $duration = (float)(!empty($row['duration']) ? $row['duration'] : ($row['ep_duration'] ?? 0));
        $progress = (float)($row['progress_seconds'] ?? 0);
        if ($duration <= 0) return false;
        if ($progress >= $duration * 0.9) return true;
        $outro = isset($row['outro_start']) && $row['outro_start'] !== null ? (float)$row['outro_start'] : 0.0;
        return $outro > $duration * 0.5 && $outro < $duration && $progress >= $outro - 5;
    }

    /** Regular seasons in order, specials (season 0) after them — same order as the apps. */
    public static function orderEpisodes(array $episodes): array {
        usort($episodes, function ($a, $b) {
            $sa = (int)$a['season_number'];
            $sb = (int)$b['season_number'];
            return [$sa <= 0 ? 1 : 0, $sa, (int)$a['episode_number']] <=> [$sb <= 0 ? 1 : 0, $sb, (int)$b['episode_number']];
        });
        return $episodes;
    }

    /**
     * Pure part of getContinueWatching (unit-tested): $rows are history rows joined with their
     * episode/show, $loadEpisodes(showIds) returns the episodes of those shows.
     */
    public static function buildContinueWatching(array $rows, callable $loadEpisodes, int $limit = 20): array {
        // Newest first; on a same-second tie the later episode wins (auto-advance saves both).
        usort($rows, function ($a, $b) {
            $byTime = strcmp((string)($b['updated_at'] ?? ''), (string)($a['updated_at'] ?? ''));
            if ($byTime !== 0) return $byTime;
            return [(int)($b['season_number'] ?? 0), (int)($b['episode_number'] ?? 0)]
                <=> [(int)($a['season_number'] ?? 0), (int)($a['episode_number'] ?? 0)];
        });

        $latestByShow = [];
        $historyByEpisode = [];
        foreach ($rows as $row) {
            $historyByEpisode[(string)$row['episode_id']] = $row;
            $showId = (string)($row['show_id'] ?? '');
            if ($showId !== '' && !isset($latestByShow[$showId])) $latestByShow[$showId] = $row;
        }

        $finishedShows = [];
        foreach ($latestByShow as $showId => $row) {
            if (self::isFinishedWatching($row)) $finishedShows[] = (string)$showId;
        }
        $episodesByShow = [];
        if (!empty($finishedShows)) {
            foreach ($loadEpisodes($finishedShows) as $ep) {
                $episodesByShow[(string)$ep['show_id']][] = $ep;
            }
        }

        $result = [];
        foreach ($latestByShow as $showId => $row) {
            $showId = (string)$showId;
            $item = [
                'show_id' => $showId,
                'show_title' => $row['show_title'] ?? '',
                'poster_path' => $row['poster_path'] ?? '',
                'backdrop_path' => $row['backdrop_path'] ?? '',
                'media_type' => $row['media_type'] ?? 'anime',
                'updated_at' => $row['updated_at'] ?? null,
            ];

            if (!self::isFinishedWatching($row)) {
                $result[] = $item + [
                    'episode_id' => (string)$row['episode_id'],
                    'season_number' => (int)$row['season_number'],
                    'episode_number' => (int)$row['episode_number'],
                    'episode_title' => $row['episode_title'] ?? '',
                    'thumbnail_path' => $row['thumbnail_path'] ?? '',
                    'progress_seconds' => (float)$row['progress_seconds'],
                    'duration' => (float)(!empty($row['duration']) ? $row['duration'] : ($row['ep_duration'] ?? 0)),
                    'completed' => false,
                    'up_next' => false,
                ];
            } else {
                $ordered = self::orderEpisodes($episodesByShow[$showId] ?? []);
                $next = null;
                foreach ($ordered as $i => $ep) {
                    if ((string)$ep['id'] !== (string)$row['episode_id']) continue;
                    $candidate = $ordered[$i + 1] ?? null;
                    // Finishing the last regular episode ends the series; specials are opt-in.
                    if ($candidate && ((int)$candidate['season_number'] <= 0) === ((int)$ep['season_number'] <= 0)) {
                        $next = $candidate;
                    }
                    break;
                }
                if (!$next) continue;

                $nextHistory = $historyByEpisode[(string)$next['id']] ?? null;
                $resume = ($nextHistory && !self::isFinishedWatching($nextHistory)) ? (float)$nextHistory['progress_seconds'] : 0.0;
                $result[] = $item + [
                    'episode_id' => (string)$next['id'],
                    'season_number' => (int)$next['season_number'],
                    'episode_number' => (int)$next['episode_number'],
                    'episode_title' => $next['title'] ?? '',
                    'thumbnail_path' => $next['thumbnail_path'] ?? '',
                    'progress_seconds' => $resume,
                    'duration' => (float)($next['duration'] ?? 0),
                    'completed' => false,
                    'up_next' => true,
                ];
            }
            if (count($result) >= $limit) break;
        }
        return $result;
    }

    public static function getProgress(?string $episodeId = null): void {
        $token = AuthMiddleware::getBearerToken();
        if ($token) {
            $tokenData = AuthMiddleware::verifyToken($token);
            if (($tokenData['role'] ?? '') === 'admin' && empty($tokenData['profile_name']) && empty($tokenData['profile_id'])) {
                jsonResponse(['progress' => 0, 'completed' => false, 'duration' => 0, 'admin_preview' => true]);
                return;
            }
        }
        list($username, $profile) = self::resolveUserAndProfile();
        $epId = $episodeId ?: ($_GET['episode_id'] ?? '');

        if (empty($epId)) {
            jsonError('episode_id requerido', 400);
        }

        $prog = DbHelper::getProgress($username, $profile, $epId);
        if (!$prog) {
            jsonResponse(['progress' => 0, 'completed' => false, 'duration' => 0]);
        } else {
            jsonResponse($prog);
        }
    }

    public static function saveProgress(?string $episodeId = null): void {
        $token = AuthMiddleware::getBearerToken();
        if ($token) {
            $tokenData = AuthMiddleware::verifyToken($token);
            if (($tokenData['role'] ?? '') === 'admin' && empty($tokenData['profile_name']) && empty($tokenData['profile_id'])) {
                jsonResponse(['success' => true, 'admin_preview' => true]);
                return;
            }
        }
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        list($username, $profile) = self::resolveUserAndProfile();

        $epId = $episodeId ?: ($data['episode_id'] ?? ($_GET['episode_id'] ?? ''));
        if (empty($epId) || !is_string($epId)) {
            jsonError('episode_id requerido', 400);
        }

        $canonicalEp = DbHelper::getEpisode($epId);
        if (!$canonicalEp) {
            jsonError('Episodio no encontrado', 404);
        }

        if (!empty($canonicalEp['show_id'])) {
            // Lives in PlayerController; calling it on ShowController was a fatal error that made every
            // progress save fail (history stayed at 0 s and resume never worked).
            PlayerController::checkKidsModeAccess($canonicalEp['show_id']);
        }

        $rawProgress = $data['progress'] ?? ($data['progress_seconds'] ?? null);
        if ($rawProgress === null || !is_numeric($rawProgress)) {
            jsonError('Progreso inválido', 400);
        }
        $progress = (float)$rawProgress;

        $rawDuration = $data['duration'] ?? null;
        $duration = 0.0;
        if ($rawDuration !== null) {
            if (!is_numeric($rawDuration)) {
                jsonError('Duración inválida', 400);
            }
            $duration = (float)$rawDuration;
        }

        if (!is_finite($progress) || $progress < 0) {
            jsonError('El progreso debe ser un número positivo finito', 400);
        }
        if (!is_finite($duration) || $duration < 0) {
            jsonError('La duración debe ser un número positivo finito', 400);
        }

        $serverDuration = !empty($canonicalEp['duration']) ? (float)$canonicalEp['duration'] : $duration;
        if ($serverDuration > 0) {
            $progress = min($progress, $serverDuration);
            $effectiveDuration = $serverDuration;
        } else {
            $progress = min($progress, 86400.0);
            $effectiveDuration = 0.0;
        }

        // Reaching the credits (a valid outro mark) or 90 % counts as watched.
        $completed = $effectiveDuration > 0 && self::isFinishedWatching([
            'progress_seconds' => $progress,
            'duration' => $effectiveDuration,
            'outro_start' => $canonicalEp['outro_start'] ?? null,
        ]);

        DbHelper::saveProgress($username, $profile, $epId, $progress, $effectiveDuration, $completed);
        jsonResponse(['success' => true]);
    }

    public static function updateProgress(): void {
        self::saveProgress();
    }

    public static function getFavorites(): void {
        list($username, $profile) = self::resolveUserAndProfile();

        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT s.* FROM favorites f
            JOIN shows s ON f.show_id = s.id
            WHERE f.username = :user AND f.profile_name = :prof
            ORDER BY f.created_at DESC
        ");
        $stmt->execute(['user' => $username, 'prof' => $profile]);
        $favorites = $stmt->fetchAll();

        jsonResponse($favorites);
    }

    public static function checkFavorite(): void {
        list($username, $profile) = self::resolveUserAndProfile();
        $showId = $_GET['showId'] ?? ($_GET['show_id'] ?? '');

        if (empty($showId)) {
            jsonResponse(['favorited' => false]);
            return;
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM favorites WHERE username = :user AND profile_name = :prof AND show_id = :show");
        $stmt->execute(['user' => $username, 'prof' => $profile, 'show' => $showId]);
        $existing = $stmt->fetch();

        jsonResponse(['favorited' => !empty($existing)]);
    }

    public static function toggleFavorite(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        list($username, $profile) = self::resolveUserAndProfile();

        $showId = $data['show_id'] ?? ($data['showId'] ?? '');

        if (empty($showId)) {
            jsonError('show_id requerido', 400);
        }

        $show = DbHelper::getShow($showId);
        if (!$show) {
            jsonError('Show no encontrado', 404);
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM favorites WHERE username = :user AND profile_name = :prof AND show_id = :show");
        $stmt->execute(['user' => $username, 'prof' => $profile, 'show' => $showId]);
        $existing = $stmt->fetch();

        if ($existing) {
            $del = $db->prepare("DELETE FROM favorites WHERE username = :user AND profile_name = :prof AND show_id = :show");
            $del->execute(['user' => $username, 'prof' => $profile, 'show' => $showId]);
            jsonResponse(['favorited' => false]);
        } else {
            $ins = $db->prepare("INSERT INTO favorites (username, profile_name, show_id) VALUES (:user, :prof, :show)");
            $ins->execute(['user' => $username, 'prof' => $profile, 'show' => $showId]);
            jsonResponse(['favorited' => true]);
        }
    }

    public static function getUserPreferences(): void {
        list($username, $profile) = self::resolveUserAndProfile();

        $prefs = DbHelper::getUserPreferences($username, $profile);
        jsonResponse([
            'success' => true,
            'preferences' => $prefs
        ]);
    }

    public static function saveUserPreferences(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        list($username, $profile) = self::resolveUserAndProfile();

        DbHelper::saveUserPreferences($username, $profile, $data);
        jsonResponse(['success' => true]);
    }

    public static function getUserStats(): void {
        list($username, $profile) = self::resolveUserAndProfile();

        $stats = DbHelper::getUserStats($username, $profile);
        jsonResponse([
            'success' => true,
            'stats' => $stats
        ]);
    }

    public static function deleteHistory(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        list($username, $profile) = self::resolveUserAndProfile();

        $episodeId = $_GET['episode_id'] ?? ($data['episode_id'] ?? null);
        $clear = $_GET['clear'] ?? ($data['clear'] ?? null);

        if ($clear === 'all') {
            DbHelper::clearUserHistory($username, $profile);
            jsonResponse(['success' => true]);
        } else if (!empty($episodeId)) {
            DbHelper::deleteHistoryItem($username, $profile, $episodeId);
            jsonResponse(['success' => true]);
        } else {
            jsonError('episode_id o clear=all requerido', 400);
        }
    }

    public static function getNotifications(): void {
        list($username, $profile) = self::resolveUserAndProfile();

        $result = DbHelper::getNotifications($username, $profile);
        jsonResponse([
            'success' => true,
            'notifications' => $result['notifications'],
            'unread_count' => $result['unread_count'],
            'last_seen_at' => $result['last_seen_at']
        ]);
    }

    public static function markNotificationsSeen(): void {
        list($username, $profile) = self::resolveUserAndProfile();
        try {
            DbHelper::markNotificationsSeen($username, $profile);
            jsonResponse(['success' => true]);
        } catch (Throwable $e) {
            error_log('markNotificationsSeen failed: ' . $e->getMessage());
            jsonError('Error persistiendo estado de notificaciones', 500);
        }
    }
}

