<?php
/**
 * Server half of the audio-intro offload (light work only, no media decoding):
 *   php php_backend/scripts/intro_state.php dump > state.json      # episodes + season MAL maps
 *   php php_backend/scripts/intro_state.php apply updates.json     # store results computed on a PC
 * The heavy part (php_backend/scripts/audio_intros_local.php) runs on a desktop PC; see
 * scripts/audio_intros_from_pc.py, which drives both halves over SSH.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

$mode = $argv[1] ?? '';
$db = Database::getConnection();

if ($mode === 'dump') {
    echo json_encode([
        'library_dir' => realpath(LIBRARY_DIR) ?: LIBRARY_DIR,
        'episodes' => $db->query('SELECT id, show_id, season_number, episode_number, duration, filepath, intro_start, intro_end, outro_start, outro_end, intro_source, intro_checked_at FROM episodes')->fetchAll(),
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
    foreach ($updates as $u) {
        // Ending credits computed on the PC (AniSkip), without touching the opening.
        if (!empty($u['id']) && array_key_exists('outro_start', $u) && array_key_exists('outro_end', $u) && !isset($u['intro_source'])) {
            $os = $u['outro_start'] === null ? null : (int)$u['outro_start'];
            $oe = $u['outro_end'] === null ? null : (int)$u['outro_end'];
            if ($os !== null && $oe !== null && $oe <= $os) continue;
            if (DbHelper::saveEpisodeTimestamps((string)$u['id'], ['outro_start' => $os, 'outro_end' => $oe])) $applied++;
            continue;
        }
        // Only what the audio pass writes; anything else in the file is ignored.
        if (!in_array($u['intro_source'] ?? '', ['audio', 'aniskip_checked', 'none'], true) || empty($u['id'])) continue;
        $data = ['intro_source' => $u['intro_source']];
        if (array_key_exists('intro_start', $u) && array_key_exists('intro_end', $u)) {
            $start = $u['intro_start'] === null ? null : (int)$u['intro_start'];
            $end = $u['intro_end'] === null ? null : (int)$u['intro_end'];
            if ($start !== null && ($end === null || $end <= $start || $start < 0)) continue;
            $data['intro_start'] = $start;
            $data['intro_end'] = $end;
        }
        if (DbHelper::saveEpisodeTimestamps((string)$u['id'], $data)) $applied++;
    }
    echo "Aplicados: {$applied} de " . count($updates) . "\n";
    exit(0);
}

fwrite(STDERR, "Uso: intro_state.php dump | apply <updates.json>\n");
exit(1);
