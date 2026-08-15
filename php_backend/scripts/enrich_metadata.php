<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/TmdbScraper.php';

echo "=== INICIANDO ENRIQUECIMIENTO DE METADATOS EN BASE DE DATOS ===\n";

$shows = DbHelper::getShows('all');
echo "Total de series/películas encontradas: " . count($shows) . "\n\n";

foreach ($shows as $show) {
    $showId = $show['id'];
    $title = $show['title'];
    $mediaType = $show['media_type'] ?? 'anime';

    echo "Procesando: [{$showId}] '{$title}' ({$mediaType})...\n";

    // Search TMDB
    $searchQuery = str_replace('_', ' ', $title);
    if (strcasecmp($showId, 'Ranma1_2') === 0 || strcasecmp($title, 'Ranma1 2') === 0) {
        $searchQuery = 'Ranma 1/2';
    } else if (strcasecmp($showId, 'Oshi_no_Ko') === 0 || strcasecmp($title, 'Oshi no Ko') === 0) {
        $searchQuery = 'Oshi no Ko';
    }

    $searchResults = TmdbScraper::search($searchQuery, $mediaType);
    if (empty($searchResults)) {
        echo "  [AVISO] No se encontraron resultados en TMDB para '{$searchQuery}'\n";
        continue;
    }

    $first = $searchResults[0];
    $tmdbId = (int)$first['id'];
    echo "  -> TMDB ID encontrado: {$tmdbId} ('{$first['title']}')\n";

    $details = TmdbScraper::getDetails($tmdbId, $mediaType);
    if (!$details) {
        echo "  [ERROR] No se pudieron obtener detalles para TMDB ID {$tmdbId}\n";
        continue;
    }

    // Update Show Data
    $show['synopsis'] = !empty($details['synopsis']) ? $details['synopsis'] : ($show['synopsis'] ?? '');
    $show['rating'] = ($details['rating'] > 0) ? $details['rating'] : ($show['rating'] ?? 0.0);
    $show['year'] = $details['year'] ?: ($show['year'] ?? null);
    $show['studio'] = !empty($details['studio']) ? $details['studio'] : ($show['studio'] ?? '');
    $show['director'] = !empty($details['director']) ? $details['director'] : ($show['director'] ?? '');
    $show['writer'] = !empty($details['writer']) ? $details['writer'] : ($show['writer'] ?? '');
    $show['cast_members'] = !empty($details['cast_members']) ? $details['cast_members'] : ($show['cast_members'] ?? []);
    $show['genres'] = !empty($details['genres']) ? $details['genres'] : ($show['genres'] ?? '');
    if (!empty($details['trailer_key'])) {
        $show['trailer_key'] = $details['trailer_key'];
    }
    if (empty($show['poster_path']) && !empty($details['poster_path'])) {
        $show['poster_path'] = $details['poster_path'];
    }
    if (empty($show['backdrop_path']) && !empty($details['backdrop_path'])) {
        $show['backdrop_path'] = $details['backdrop_path'];
    }
    if (!empty($details['status'])) {
        $show['status'] = $details['status'];
    }

    DbHelper::saveShow($show);
    echo "  -> Show guardado: Estudio='{$show['studio']}', Director='{$show['director']}', Guionista='{$show['writer']}', Actores=" . count($show['cast_members']) . "\n";

    // Enrich Episodes
    if ($mediaType !== 'movie') {
        $episodes = DbHelper::getEpisodesForShow($showId);
        echo "  -> Enriqueciendo " . count($episodes) . " capítulos...\n";

        $seasonsCache = [];
        $enrichedCount = 0;

        foreach ($episodes as $ep) {
            $s = (int)($ep['season_number'] ?? 1);
            if (!isset($seasonsCache[$s])) {
                try {
                    $seasonsCache[$s] = TmdbScraper::getSeasonEpisodes($tmdbId, $s);
                } catch (Throwable $e) {
                    $seasonsCache[$s] = [];
                }
            }

            $epNum = (int)($ep['episode_number'] ?? 1);
            $epMeta = $seasonsCache[$s][$epNum] ?? null;

            if ($epMeta) {
                if (!empty($epMeta['title'])) {
                    $ep['title'] = $epMeta['title'];
                }
                if (!empty($epMeta['synopsis'])) {
                    $ep['synopsis'] = $epMeta['synopsis'];
                }
                if (empty($ep['thumbnail_path']) && !empty($epMeta['still_path'])) {
                    $ep['thumbnail_path'] = $epMeta['still_path'];
                }
                DbHelper::saveEpisode($ep);
                $enrichedCount++;
            }
        }
        echo "  -> {$enrichedCount} capítulos actualizados con títulos y sinopsis en español!\n";
    }

    echo "\n";
}

echo "=== ENRIQUECIMIENTO COMPLETADO CON ÉXITO ===\n";
