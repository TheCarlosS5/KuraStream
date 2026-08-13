<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class HistoryController {
    public static function getHistory(): void {
        $username = $_GET['username'] ?? 'guest';
        $profile = $_GET['profile_name'] ?? 'Principal';

        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT w.*, e.show_id, e.season_number, e.episode_number, e.thumbnail_path, s.title as show_title, s.poster_path
            FROM watch_history w
            JOIN episodes e ON w.episode_id = e.id
            JOIN shows s ON e.show_id = s.id
            WHERE w.username = :user AND w.profile_name = :prof
            ORDER BY w.updated_at DESC
        ");
        $stmt->execute(['user' => $username, 'prof' => $profile]);
        $history = $stmt->fetchAll();

        jsonResponse($history);
    }

    public static function updateProgress(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $username = $data['username'] ?? 'guest';
        $profile = $data['profile_name'] ?? 'Principal';
        $episodeId = $data['episode_id'] ?? '';
        $progress = (float)($data['progress_seconds'] ?? 0);
        $duration = (float)($data['duration'] ?? 0);

        if (empty($episodeId)) {
            jsonError('episode_id requerido', 400);
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration)
            VALUES (:user, :prof, :ep, :prog, :dur)
            ON DUPLICATE KEY UPDATE
                progress_seconds = VALUES(progress_seconds),
                duration = VALUES(duration)
        ");
        $stmt->execute([
            'user' => $username,
            'prof' => $profile,
            'ep' => $episodeId,
            'prog' => $progress,
            'dur' => $duration
        ]);

        jsonResponse(['success' => true]);
    }

    public static function getFavorites(): void {
        $username = $_GET['username'] ?? 'guest';
        $profile = $_GET['profile_name'] ?? 'Principal';

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

    public static function toggleFavorite(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $username = $data['username'] ?? 'guest';
        $profile = $data['profile_name'] ?? 'Principal';
        $showId = $data['show_id'] ?? '';

        if (empty($showId)) {
            jsonError('show_id requerido', 400);
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
        $username = $_GET['username'] ?? 'guest';
        $profile = $_GET['profile_name'] ?? 'Principal';

        $prefs = DbHelper::getUserPreferences($username, $profile);
        jsonResponse([
            'success' => true,
            'preferences' => $prefs
        ]);
    }

    public static function saveUserPreferences(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $username = $data['username'] ?? ($_GET['username'] ?? 'guest');
        $profile = $data['profile_name'] ?? ($_GET['profile_name'] ?? 'Principal');

        DbHelper::saveUserPreferences($username, $profile, $data);
        jsonResponse(['success' => true]);
    }
}
