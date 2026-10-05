<?php
/**
 * PC half of the intro/ending offload, run against a copy of the server's state; writes only the
 * changed timings. Nothing here touches the server's database.
 *  1. AniSkip (needs internet, which the home server lacks): openings and ending credits of every
 *     episode that is new, missing or, with --force, already answered (IntroSync rules).
 *  2. Audio (ffmpeg + Chromaprint on the local copy of the library): checks and completes the
 *     openings (AudioIntroSync) and the ending credits (AudioOutroSync).
 *
 *   php php_backend/scripts/audio_intros_local.php --state=state.json --out=updates.json
 *       [--library=C:/path/to/library] [--show="Yuru Camp"] [--force] [--no-aniskip] [--no-audio]
 *
 * Episodes whose file is not in the local library are left out of the audio pass (neither
 * analysed nor used as reference), so a library that is still syncing never marks anything as
 * "no opening"; AniSkip does not need the files and covers them all.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
define('TESTING_MODE', true);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/IntroSync.php';
require_once __DIR__ . '/../services/AudioIntroSync.php';
require_once __DIR__ . '/../services/AudioOutroSync.php';

$opts = getopt('', ['state:', 'out:', 'library:', 'show:', 'force', 'no-aniskip', 'no-audio']);
if (empty($opts['state']) || empty($opts['out'])) {
    fwrite(STDERR, "Uso: audio_intros_local.php --state=state.json --out=updates.json [--library=DIR] [--show=ID] [--force] [--no-aniskip] [--no-audio]\n");
    exit(1);
}
$state = json_decode((string)file_get_contents($opts['state']), true);
$remoteLib = rtrim(str_replace('\\', '/', (string)($state['library_dir'] ?? '')), '/') . '/';
$localLib = rtrim(str_replace('\\', '/', (string)($opts['library'] ?? LIBRARY_DIR)), '/') . '/';
$fields = ['id', 'show_id', 'season_number', 'episode_number', 'duration', 'filepath', 'intro_start', 'intro_end',
    'outro_start', 'outro_end', 'intro_source', 'intro_checked_at', 'outro_source', 'outro_checked_at'];

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE episodes (id TEXT PRIMARY KEY, show_id TEXT, season_number INT, episode_number INT, duration REAL,
    filepath TEXT, intro_start INT, intro_end INT, outro_start INT, outro_end INT, intro_source TEXT, intro_checked_at TEXT,
    outro_source TEXT, outro_checked_at TEXT, chapters TEXT, audio_tracks TEXT, subtitle_tracks TEXT)');
$pdo->exec('CREATE TABLE show_seasons (show_id TEXT, season_number INT, mal_map TEXT, PRIMARY KEY (show_id, season_number))');

$insert = $pdo->prepare('INSERT INTO episodes (' . implode(',', $fields) . ') VALUES (' . implode(',', array_fill(0, count($fields), '?')) . ')');
$notLocal = [];
foreach ($state['episodes'] ?? [] as $e) {
    $path = str_replace('\\', '/', (string)$e['filepath']);
    if (str_starts_with($path, $remoteLib)) $path = $localLib . substr($path, strlen($remoteLib));
    if (!is_file($path)) $notLocal[] = $e['id'];
    $e['filepath'] = $path;
    $insert->execute(array_map(fn($f) => $e[$f] ?? null, $fields));
}
$insert = $pdo->prepare('INSERT INTO show_seasons VALUES (?,?,?)');
foreach ($state['seasons'] ?? [] as $s) $insert->execute([$s['show_id'], $s['season_number'], $s['mal_map']]);
Database::setConnection($pdo);

$snapshot = function () use ($pdo): array {
    $rows = [];
    foreach ($pdo->query('SELECT id, intro_start, intro_end, intro_source, outro_start, outro_end, outro_source FROM episodes') as $row) $rows[$row['id']] = $row;
    return $rows;
};
$before = $snapshot();

$shows = array_values(array_filter($state['shows'] ?? [], fn($show) => ($show['media_type'] ?? 'anime') !== 'movie'
    && (empty($opts['show']) || $show['id'] === $opts['show'])));

if (!isset($opts['no-aniskip'])) {
    echo "AniSkip (intros y endings):\n";
    foreach ($shows as $show) {
        $r = IntroSync::syncShow($show['id'], isset($opts['force']));
        if ($r['offline']) {
            echo "   AniSkip no responde; se omite el resto de consultas.\n";
            break;
        }
        if ($r['found'] + $r['missing'] + $r['outros_found'] + $r['outros_missing'] + $r['unmapped'] === 0) continue;
        printf("   %s: intros %d encontradas / %d sin datos; endings %d encontrados / %d sin datos; %d sin episodio MAL\n",
            $show['id'], $r['found'], $r['missing'], $r['outros_found'], $r['outros_missing'], $r['unmapped']);
    }
}

$after = $snapshot();
if (!isset($opts['no-audio'])) {
    if ($notLocal) echo 'Aviso: ' . count($notLocal) . " episodios no están en la biblioteca local; el audio los omite.\n";
    $delete = $pdo->prepare('DELETE FROM episodes WHERE id = ?');
    foreach ($notLocal as $id) $delete->execute([$id]);
    echo "Audio (openings):\n";
    foreach ($shows as $show) {
        $t0 = microtime(true);
        $r = AudioIntroSync::syncShow($show['id']);
        if ($r['checked'] + $r['corrected'] + $r['found'] + $r['found_unreferenced'] + $r['none'] === 0) continue;
        printf("   %s: %d encontradas, %d sin referencia, %d corregidas de AniSkip, %d confirmadas, %d sin opening (%.0fs)\n",
            $show['id'], $r['found'], $r['found_unreferenced'], $r['corrected'], $r['checked'], $r['none'], microtime(true) - $t0);
    }
    echo "Audio (endings):
";
    foreach ($shows as $show) {
        $t0 = microtime(true);
        $r = AudioOutroSync::syncShow($show['id']);
        if ($r['checked'] + $r['corrected'] + $r['found'] + $r['found_unreferenced'] + $r['none'] === 0) continue;
        printf("   %s: %d encontrados, %d sin referencia, %d corregidos de AniSkip, %d confirmados, %d sin ending (%.0fs)
",
            $show['id'], $r['found'], $r['found_unreferenced'], $r['corrected'], $r['checked'], $r['none'], microtime(true) - $t0);
    }
    $after = $snapshot() + $after;
}

$num = fn($v) => $v === null ? null : (int)$v;
$updates = [];
foreach ($after as $id => $row) {
    $old = $before[$id];
    $u = ['id' => $id];
    if ($old['intro_source'] !== $row['intro_source'] || $old['intro_start'] != $row['intro_start'] || $old['intro_end'] != $row['intro_end']) {
        $u += ['intro_start' => $num($row['intro_start']), 'intro_end' => $num($row['intro_end']), 'intro_source' => $row['intro_source']];
    }
    if ($old['outro_source'] !== $row['outro_source'] || $old['outro_start'] != $row['outro_start'] || $old['outro_end'] != $row['outro_end']) {
        $u += ['outro_start' => $num($row['outro_start']), 'outro_end' => $num($row['outro_end']), 'outro_source' => $row['outro_source']];
    }
    if (count($u) > 1) $updates[] = $u;
}
file_put_contents($opts['out'], json_encode($updates));
echo count($updates) . " cambios escritos en {$opts['out']}\n";
