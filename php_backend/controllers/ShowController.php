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

        $show = DbHelper::getShow($showId);
        if (!$show) {
            jsonError('Show no encontrado', 404);
        }

        $show['status'] = $status;
        DbHelper::saveShow($show);

        jsonResponse(['success' => true, 'show' => $show]);
    }

    public static function getRandomShow(): void {
        $show = DbHelper::getRandomShow();
        jsonResponse([
            'success' => true,
            'show' => $show
        ]);
    }
}

