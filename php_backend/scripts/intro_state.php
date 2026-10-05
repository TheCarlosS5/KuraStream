<?php
/**
 * Server half of the intro/ending offload (light work only: no media decoding, no internet):
 *   php php_backend/scripts/intro_state.php dump > state.json      # episodes + season MAL maps
 *   php php_backend/scripts/intro_state.php apply updates.json     # store results computed on a PC
 * The rest (AniSkip lookups and the audio pass, php_backend/scripts/audio_intros_local.php) runs
 * on a desktop PC; see scripts/audio_intros_from_pc.py, which drives both halves over SSH.
 * Timings an admin set (or the file's chapters) are re-checked here and never replaced.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/IntroSync.php';

$mode = $argv[1] ?? '';
$db = Database::getConnection();

if ($mode === 'dump') {
    echo json_encode([
        'library_dir' => realpath(LIBRARY_DIR) ?: LIBRARY_DIR,
        'episodes' => $db->query('SELECT id, show_id, season_number, episode_number, duration, filepath, intro_start, intro_end, outro_start, outro_end, intro_source, intro_checked_at, outro_source, outro_checked_at FROM episodes')->fetchAll(),
        'seasons' => $db->query('SELECT show_id, season_number, mal_map FROM show_seasons')->fetchAll(),
        'shows' => $db->query('SELECT id, media_type FROM shows')->fetchAll(),
    ]);
    exit(0);
}

if ($mode === 'apply' && !empty($argv[2])) {
    $updates = json_decode((string)file_get_contents($argv[2]), true);
    if (!is_array($updates)) {
        fwrite(STDERR, "JSON inválido\n");
        exit(1);
    }
    $applied = 0;
    $introSources = ['audio', 'aniskip', 'aniskip_checked', 'aniskip_none', 'none'];
    $outroSources = ['audio', 'aniskip', 'aniskip_checked', 'aniskip_none', 'none'];
    foreach ($updates as $u) {
        if (empty($u['id']) || !($current = DbHelper::getEpisode((string)$u['id']))) continue;
        $data = [];
        // Opening: only the sources the PC passes write, and never over an admin/chapters one.
        if (in_array($u['intro_source'] ?? '', $introSources, true) && !IntroSync::introLocked($current)) {
            $data['intro_source'] = $u['intro_source'];
            if (array_key_exists('intro_start', $u) && array_key_exists('intro_end', $u)) {
                $start = $u['intro_start'] === null ? null : (int)$u['intro_start'];
                $end = $u['intro_end'] === null ? null : (int)$u['intro_end'];
                if ($start === null || ($end !== null && $end > $start && $start >= 0)) {
                    $data['intro_start'] = $start;
                    $data['intro_end'] = $end;
                } else {
                    unset($data['intro_source']);
                }
            }
        }
        // Ending credits, same rules.
        if (in_array($u['outro_source'] ?? '', $outroSources, true) && !IntroSync::outroLocked($current)) {
            $data['outro_source'] = $u['outro_source'];
            if (array_key_exists('outro_start', $u) && array_key_exists('outro_end', $u)) {
                $start = $u['outro_start'] === null ? null : (int)$u['outro_start'];
                $end = $u['outro_end'] === null ? null : (int)$u['outro_end'];
                if (($start === null && $end === null) || ($start !== null && $end !== null && $end > $start && $start >= 0)) {
                    $data['outro_start'] = $start;
                    $data['outro_end'] = $end;
                } else {
                    unset($data['outro_source']);
                }
            }
        }
        if ($data && DbHelper::saveEpisodeTimestamps((string)$u['id'], $data)) $applied++;
    }
    echo "Aplicados: {$applied} de " . count($updates) . "\n";
    exit(0);
}

fwrite(STDERR, "Uso: intro_state.php dump | apply <updates.json>\n");
exit(1);
