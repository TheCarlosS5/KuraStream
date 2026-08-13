<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../services/LibraryScanner.php';

class AdminController {
    public static function getStaged(): void {
        AuthMiddleware::requireAdmin();
        $db = Database::getConnection();
        $stmt = $db->query("SELECT * FROM staged_imports ORDER BY created_at DESC");
        jsonResponse($stmt->fetchAll());
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

        // Target folder
        $catName = ($mediaType === 'movie') ? 'Movies' : 'Anime';
        $sanitizedTitle = str_replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], '_', $cleanTitle);
        $targetDir = LIBRARY_DIR . '/' . $catName . '/' . $sanitizedTitle;

        if (!is_dir($targetDir)) {
            mkdir($targetDir, 0777, true);
        }

        $ext = pathinfo($item['filepath'], PATHINFO_EXTENSION);
        $targetFilename = ($mediaType === 'movie') 
            ? "{$sanitizedTitle}.{$ext}" 
            : "{$sanitizedTitle} - S" . sprintf("%02d", $season) . "E" . sprintf("%02d", $episode) . ".{$ext}";

        $targetPath = $targetDir . '/' . $targetFilename;

        if (file_exists($item['filepath'])) {
            rename($item['filepath'], $targetPath);
        }

        // Delete from staged
        $del = $db->prepare("DELETE FROM staged_imports WHERE id = :id");
        $del->execute(['id' => $id]);

        // Run rescan
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

        jsonResponse([
            'shows_count' => $showsCount,
            'episodes_count' => $episodesCount,
            'total_duration_hours' => round($totalSecs / 3600, 1),
            'total_storage_gb' => round($totalBytes / (1024 * 1024 * 1024), 2)
        ]);
    }
}
