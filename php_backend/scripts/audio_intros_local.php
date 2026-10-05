<?php
/**
 * PC half of the audio-intro offload: runs AudioIntroSync (ffmpeg + Chromaprint) on this machine
 * against a copy of the server's state and the local copy of the library, and writes only the
 * changed timings. Nothing here touches the server's database.
 *
 *   php php_backend/scripts/audio_intros_local.php --state=state.json --out=updates.json
 *       [--library=C:/path/to/library] [--show="Yuru Camp"]
 *
 * Episodes whose file is not in the local library are left out (neither analysed nor used as
 * reference), so a library that is still syncing never marks anything as "no opening".
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
define('TESTING_MODE', true);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/AudioIntroSync.php';

$opts = getopt('', ['state:', 'out:', 'library:', 'show:']);
if (empty($opts['state']) || empty($opts['out'])) {
    fwrite(STDERR, "Uso: audio_intros_local.php --state=state.json --out=updates.json [--library=DIR] [--show=ID]\n");
    exit(1);
}
$state = json_decode((string)file_get_contents($opts['state']), true);
$remoteLib = rtrim(str_replace('\\', '/', (string)($state['library_dir'] ?? '')), '/') . '/';
$localLib = rtrim(str_replace('\\', '/', (string)($opts['library'] ?? LIBRARY_DIR)), '/') . '/';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE episodes (id TEXT PRIMARY KEY, show_id TEXT, season_number INT, episode_number INT, duration REAL,
    filepath TEXT, intro_start INT, intro_end INT, outro_start INT, intro_source TEXT, intro_checked_at TEXT,
    chapters TEXT, audio_tracks TEXT, subtitle_tracks TEXT)');
$pdo->exec('CREATE TABLE show_seasons (show_id TEXT, season_number INT, mal_map TEXT, PRIMARY KEY (show_id, season_number))');

$insert = $pdo->prepare('INSERT INTO episodes VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)');
$missing = 0;
foreach ($state['episodes'] ?? [] as $e) {
    $path = str_replace('\\', '/', (string)$e['filepath']);
    if (str_starts_with($path, $remoteLib)) $path = $localLib . substr($path, strlen($remoteLib));
    if (!is_file($path)) {
        $missing++;
        continue;
    }
    $insert->execute([$e['id'], $e['show_id'], $e['season_number'], $e['episode_number'], $e['duration'], $path,
        $e['intro_start'], $e['intro_end'], $e['outro_start'], $e['intro_source'], $e['intro_checked_at']]);
}
$insert = $pdo->prepare('INSERT INTO show_seasons VALUES (?,?,?)');
foreach ($state['seasons'] ?? [] as $s) $insert->execute([$s['show_id'], $s['season_number'], $s['mal_map']]);
Database::setConnection($pdo);
if ($missing) echo "Aviso: {$missing} episodios no están en la biblioteca local y se omiten.\n";

$before = [];
foreach ($pdo->query('SELECT id, intro_start, intro_end, intro_source FROM episodes') as $row) $before[$row['id']] = $row;

foreach ($state['shows'] ?? [] as $show) {
    if (($show['media_type'] ?? 'anime') === 'movie') continue;
    if (!empty($opts['show']) && $show['id'] !== $opts['show']) continue;
    $t0 = microtime(true);
    $r = AudioIntroSync::syncShow($show['id']);
    if ($r['checked'] + $r['corrected'] + $r['found'] + $r['found_unreferenced'] + $r['none'] === 0) continue;
    printf("   %s: %d encontradas, %d sin referencia, %d corregidas de AniSkip, %d confirmadas, %d sin opening (%.0fs)\n",
        $show['id'], $r['found'], $r['found_unreferenced'], $r['corrected'], $r['checked'], $r['none'], microtime(true) - $t0);
}

$updates = [];
foreach ($pdo->query('SELECT id, intro_start, intro_end, intro_source FROM episodes') as $row) {
    $old = $before[$row['id']];
    if ($old['intro_source'] === $row['intro_source'] && $old['intro_start'] == $row['intro_start'] && $old['intro_end'] == $row['intro_end']) continue;
    $updates[] = [
        'id' => $row['id'],
        'intro_start' => $row['intro_start'] === null ? null : (int)$row['intro_start'],
        'intro_end' => $row['intro_end'] === null ? null : (int)$row['intro_end'],
        'intro_source' => $row['intro_source'],
    ];
}
file_put_contents($opts['out'], json_encode($updates));
echo count($updates) . " cambios escritos en {$opts['out']}\n";
