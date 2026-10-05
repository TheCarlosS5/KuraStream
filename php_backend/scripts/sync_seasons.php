<?php
/**
 * Per-season artwork/metadata (TMDB + AniList) and AniSkip intro timings for the library.
 *
 *   php php_backend/scripts/sync_seasons.php                # shows that are new or out of date
 *   php php_backend/scripts/sync_seasons.php --all          # every anime show
 *   php php_backend/scripts/sync_seasons.php --show="Yuru Camp" --force
 *   php php_backend/scripts/sync_seasons.php --all --intros-only
 *
 * --force re-downloads season art and asks AniSkip again for episodes it already answered.
 * Timings set by an admin or read from the file's chapters are never replaced.
 * --audio also runs the audio pass (AudioIntroSync: checks AniSkip's openings against the files and
 * finds the missing ones). It decodes ~10 min of audio per episode, so it is NOT run on the home
 * server: scripts/audio_intros_from_pc.py runs it on a desktop PC against the synced library copy.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/SeasonSync.php';
require_once __DIR__ . '/../services/IntroSync.php';
require_once __DIR__ . '/../services/AudioIntroSync.php';

$opts = getopt('', ['show:', 'all', 'force', 'intros-only', 'seasons-only', 'audio']);
$force = isset($opts['force']);

if (isset($opts['show'])) {
    $showIds = [(string)$opts['show']];
} else if (isset($opts['all'])) {
    $showIds = array_column(DbHelper::getShows('anime'), 'id');
} else {
    $showIds = SeasonSync::staleShowIds();
}

echo 'Series a sincronizar: ' . count($showIds) . "\n";
foreach ($showIds as $showId) {
    echo "\n== {$showId}\n";
    if (!isset($opts['intros-only'])) {
        $res = SeasonSync::syncShow($showId, $force);
        if (!empty($res['error']) || !empty($res['skipped'])) {
            echo '   omitida: ' . ($res['error'] ?? $res['skipped']) . "\n";
            continue;
        }
        echo '   temporadas: ' . implode(', ', $res['seasons']) . " (TMDB {$res['tmdb_seasons']}, AniList {$res['franchise_entries']} entradas)\n";
        foreach (DbHelper::getShowSeasons($showId) as $row) {
            $map = json_decode($row['mal_map'] ?? '[]', true) ?: [];
            $parts = array_map(fn($s) => "E{$s['first']}-{$s['last']} -> MAL {$s['mal_id']} ep {$s['mal_first']}+", $map);
            echo "   T{$row['season_number']} {$row['title']} [{$row['status']}] " . ($row['poster_path'] ? 'poster' : 'sin poster') . ', ' . ($row['backdrop_path'] ? 'fondo' : 'sin fondo')
                . ($parts ? ' | ' . implode('; ', $parts) : '') . "\n";
        }
    }
    if (!isset($opts['seasons-only'])) {
        $intro = IntroSync::syncShow($showId, $force);
        echo "   intros: {$intro['found']} encontradas, {$intro['missing']} sin datos en AniSkip, {$intro['unmapped']} sin episodio MAL, {$intro['skipped']} ya hechas/protegidas"
            . ($intro['offline'] ? ' (AniSkip no responde)' : '') . "\n";
    }
    if (!AnimeSources::isOnline()) {
        echo "\nSin conexión a internet: se omite el resto de la sincronización en línea.\n";
        break;
    }
}

// Audio pass over every anime show (only episodes still pending do any work). Heavy: opt-in.
if (isset($opts['audio']) && !isset($opts['seasons-only'])) {
    $audioIds = isset($opts['show']) ? [(string)$opts['show']] : array_column(DbHelper::getShows('anime'), 'id');
    echo "\n== Detección por audio\n";
    foreach ($audioIds as $showId) {
        $r = AudioIntroSync::syncShow($showId);
        if ($r['checked'] + $r['corrected'] + $r['found'] + $r['found_unreferenced'] + $r['none'] === 0) continue;
        echo "   {$showId}: {$r['found']} encontradas, {$r['found_unreferenced']} sin referencia, {$r['corrected']} corregidas de AniSkip, {$r['checked']} de AniSkip confirmadas, {$r['none']} sin opening\n";
    }
}
