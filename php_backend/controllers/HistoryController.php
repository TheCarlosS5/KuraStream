<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';

class HistoryController {
    private static function resolveUserAndProfile(array $body = []): array {
        $token = AuthMiddleware::getBearerToken();
        $payload = AuthMiddleware::verifyToken($token);
        
        $username = $payload['username'] ?? ($_GET['username'] ?? ($body['username'] ?? 'guest'));
        $profile = $_GET['profile_name'] ?? ($body['profile_name'] ?? 'Principal');

        $isGuest = empty($payload) && ($username === 'guest' || empty($username));

        return [$username, $profile, $isGuest];
    }

    public static function getHistory(): void {
        list($username, $profile, $isGuest) = self::resolveUserAndProfile();

        if ($isGuest) {
            jsonResponse([]);
            return;
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT w.*, 
                   e.show_id, e.season_number, e.episode_number, e.thumbnail_path, e.duration as ep_duration,
                   s.title as show_title, s.poster_path, s.backdrop_path
            FROM watch_history w
            JOIN episodes e ON w.episode_id = e.id
            JOIN shows s ON e.show_id = s.id
            WHERE w.username = :user AND w.profile_name = :prof
            ORDER BY w.updated_at DESC
        ");
        $stmt->execute(['user' => $username, 'prof' => $profile]);
        $history = $stmt->fetchAll();

        foreach ($history as &$item) {
            $item['progress_seconds'] = (float)($item['progress_seconds'] ?? 0);
            $item['duration'] = (float)(!empty($item['duration']) ? $item['duration'] : ($item['ep_duration'] ?? 0));
            $item['completed'] = (bool)($item['completed'] ?? false);
        }

        jsonResponse($history);
    }

    public static function getProgress(?string $episodeId = null): void {
        list($username, $profile, $isGuest) = self::resolveUserAndProfile();
        $epId = $episodeId ?: ($_GET['episode_id'] ?? '');

        if (empty($epId)) {
            jsonError('episode_id requerido', 400);
        }

        if ($isGuest) {
            jsonResponse(['progress' => 0, 'completed' => false, 'duration' => 0]);
            return;
        }

        $prog = DbHelper::getProgress($username, $profile, $epId);
        if (!$prog) {
            jsonResponse(['progress' => 0, 'completed' => false, 'duration' => 0]);
        } else {
            jsonResponse($prog);
        }
    }

    public static function saveProgress(?string $episodeId = null): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        list($username, $profile, $isGuest) = self::resolveUserAndProfile($data);

        $epId = $episodeId ?: ($data['episode_id'] ?? ($_GET['episode_id'] ?? ''));
        $progress = (float)($data['progress'] ?? ($data['progress_seconds'] ?? 0));
        $duration = (float)($data['duration'] ?? 0);
        $completed = isset($data['completed']) ? (bool)$data['completed'] : null;

        if (empty($epId)) {
            jsonError('episode_id requerido', 400);
        }

        if ($isGuest) {
            // Guest progress is tracked locally in browser localStorage, do not persist to server DB
            jsonResponse(['success' => true, 'guest' => true]);
            return;
        }

        DbHelper::saveProgress($username, $profile, $epId, $progress, $duration, $completed);
        jsonResponse(['success' => true]);
    }

    public static function updateProgress(): void {
        self::saveProgress();
    }

    public static function getFavorites(): void {
        list($username, $profile, $isGuest) = self::resolveUserAndProfile();

        if ($isGuest) {
            jsonResponse([]);
            return;
        }

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
        list($username, $profile, $isGuest) = self::resolveUserAndProfile();
        $showId = $_GET['showId'] ?? ($_GET['show_id'] ?? '');

        if (empty($showId) || $isGuest) {
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

        list($username, $profile, $isGuest) = self::resolveUserAndProfile($data);

        $showId = $data['show_id'] ?? ($data['showId'] ?? '');

        if (empty($showId)) {
            jsonError('show_id requerido', 400);
        }

        if ($isGuest) {
            jsonResponse(['favorited' => false, 'guest' => true]);
            return;
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

        list($username, $profile) = self::resolveUserAndProfile($data);

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

        list($username, $profile) = self::resolveUserAndProfile($data);

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

        $notifications = DbHelper::getNotifications($username, $profile);
        jsonResponse([
            'success' => true,
            'notifications' => $notifications
        ]);
    }
}

