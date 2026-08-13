<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/TmdbScraper.php';

class ShowController {
    public static function getShows(): void {
        $type = $_GET['type'] ?? 'all';
        $statusParam = $_GET['status'] ?? 'all';
        $sortParam = $_GET['sort'] ?? 'default';

        $shows = DbHelper::getShows($type);

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

    public static function searchShows(): void {
        $query = trim($_GET['query'] ?? '');
        $type = $_GET['type'] ?? 'anime';

        if (empty($query)) {
            jsonError('Término de búsqueda requerido', 400);
        }

        $results = TmdbScraper::search($query, $type);
        jsonResponse($results);
    }

    public static function getShowDetails(string $id): void {
        $show = DbHelper::getShow($id);
        if (!$show) {
            jsonError('Show no encontrado', 404);
        }

        $episodes = DbHelper::getEpisodesForShow($id);
        $show['episodes'] = $episodes;

        jsonResponse($show);
    }

    public static function toggleStatus(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $showId = $data['showId'] ?? '';
        $status = $data['status'] ?? '';

        if (empty($showId) || empty($status)) {
            jsonError('showId y status requeridos', 400);
        }

        $success = DbHelper::updateShowStatus($showId, $status);
        if (!$success) {
            jsonError('Error al actualizar el estado del show', 500);
        }

        jsonResponse(['success' => true]);
    }

    public static function getComments(): void {
        $showId = $_GET['show_id'] ?? '';
        if (empty($showId)) {
            jsonError('show_id requerido', 400);
        }

        $comments = DbHelper::getComments($showId);
        jsonResponse(['success' => true, 'comments' => $comments]);
    }

    public static function addComment(): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $showId = $data['show_id'] ?? '';
        $content = trim($data['content'] ?? '');
        $profile = $data['profile_name'] ?? 'Principal';
        $episodeId = $data['episode_id'] ?? '';

        if (empty($showId) || empty($content)) {
            jsonError('show_id y content requeridos', 400);
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
        $show = DbHelper::getRandomShow();
        jsonResponse([
            'success' => true,
            'show' => $show
        ]);
    }
}

