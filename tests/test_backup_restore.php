<?php
/**
 * A backup nobody has restored is only a hope. This runs the real round trip on the (disposable) test database:
 * create data -> back up with BackupService -> damage the database -> restore with scripts/restore_backup.sh ->
 * compare every table. It also checks that the restore script refuses truncated and corrupt files.
 */
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/services/BackupService.php';

echo "Running backup and restore round-trip test...\n";

$client = trim((string)shell_exec('command -v mysql || command -v mariadb'));
if (!BackupService::isAvailable() || $client === '') {
    echo "  Skipped: mysqldump / mysql client not installed on this host\n";
    exit(0);
}
if (!str_ends_with((string)DB_NAME, '_test')) {
    echo "  Skipped: refusing to restore into a database that is not named *_test\n";
    exit(0);
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$dir = sys_get_temp_dir() . "/kura_backup_test_$sfx";
mkdir($dir, 0700, true);
putenv("BACKUP_DIR=$dir");

$user = "br_user_$sfx";
$show = "br_show_$sfx";
$cleanup = function () use ($db, $user, $show, $dir) {
    foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'show_ratings', 'comments', 'user_profiles', 'users'] as $t) {
        try { $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $user]); } catch (Throwable $e) {}
    }
    try {
        $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $show]);
        $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $show]);
    } catch (Throwable $e) {}
    foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($dir);
};

function br_fingerprint(PDO $db): array {
    $out = [];
    $tables = $db->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    sort($tables);
    foreach ($tables as $t) {
        $rows = (int)$db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        $sum = $db->query("CHECKSUM TABLE `$t`")->fetch(PDO::FETCH_NUM);
        $out[$t] = ['rows' => $rows, 'checksum' => (string)($sum[1] ?? '')];
    }
    return $out;
}

try {
    // 1. Data with the things that go wrong in dumps: accents, emoji, JSON, long text, NULLs, foreign keys
    DbHelper::registerUser($user, 'br_password_1');
    $profile = DbHelper::getUserProfiles($user)[0];
    DbHelper::saveShow(['id' => $show, 'title' => "Señor Ñandú 日本語 \u{1F600}", 'synopsis' => str_repeat("línea con 'comillas' y \"dobles\"\n", 200),
        'rating' => 7.5, 'year' => 2026, 'genres' => 'Acción, Fantasía']);
    DbHelper::saveEpisode(['id' => "{$show}_e1", 'show_id' => $show, 'season_number' => 1, 'episode_number' => 1, 'title' => 'E1',
        'filepath' => "/media/{$show}.mkv", 'duration' => 1440.5, 'audio_tracks' => [['title' => 'Español', 'language' => 'spa']]]);
    DbHelper::saveProgress($user, $profile['name'], "{$show}_e1", 700.25, 1440.5);
    DbHelper::addComment($show, $user, $profile['name'], "Comentario con emoji \u{1F389} y acentos áéíóú");
    DbHelper::setRating($user, $profile['name'], $show, 5);
    DbHelper::setListStatus($user, $profile['name'], $show, 'watching');

    $before = br_fingerprint($db);
    assert(count($before) >= 15, 'The schema has its tables (' . count($before) . ')');

    // 2. Back up
    $backup = BackupService::run();
    $path = BackupService::path($backup['file']);
    assert($path !== null && $backup['size'] > 1000, 'A backup file was written');
    assert(str_contains((string)shell_exec('gzip -dc ' . escapeshellarg($path) . ' | tail -c 400'), 'Dump completed'), 'The dump ends with its completion marker');
    echo "✓ Backup written (" . $backup['size'] . " bytes) OK\n";

    // 3. Damage the database the way a bad day would: lose rows, a whole table, and change data
    $db->exec("DELETE FROM watch_history");
    $db->exec("DELETE FROM comments");
    $db->exec("UPDATE shows SET title = 'CORRUPTED'");
    $db->exec("DROP TABLE show_ratings");
    assert(br_fingerprint($db) !== $before, 'The damage is visible');

    // 4. A truncated or corrupt file must be refused before anything is touched
    $truncated = $dir . '/kurastream-20200101-000000.sql.gz';
    $bytes = file_get_contents($path);
    file_put_contents($truncated, substr($bytes, 0, (int)(strlen($bytes) / 2)));
    $env = ['DB_HOST' => DB_HOST, 'DB_PORT' => (string)DB_PORT, 'DB_NAME' => DB_NAME, 'DB_USER' => DB_USER, 'DB_PASS' => (string)DB_PASS, 'PATH' => getenv('PATH')];
    $run = function (array $args) use ($env): array {
        $cmd = array_merge(['bash', __DIR__ . '/../scripts/restore_backup.sh'], $args);
        $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        $out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        return [proc_close($p), $out];
    };
    [$code, $msg] = $run([$truncated, '--yes']);
    assert($code !== 0, 'A truncated backup is refused: ' . $msg);
    [$code] = $run(['/no/such/file.sql.gz', '--yes']);
    assert($code !== 0, 'A missing file is refused');
    [$code, $msg] = $run([$path]);
    assert($code !== 0 && str_contains($msg, '--yes'), 'Without --yes nothing is restored');
    assert(br_fingerprint($db) !== $before, 'Refusals did not change the database');
    echo "✓ Truncated / missing / unconfirmed restores are refused OK\n";

    // 5. Restore
    [$code, $msg] = $run([$path, '--yes']);
    assert($code === 0, 'The restore succeeds: ' . $msg);
    assert(count(glob($dir . '/pre-restore-*.sql.gz')) === 1, 'A safety copy of the previous state was saved first');

    // 6. Everything is back, byte for byte
    $db = Database::getConnection();
    $after = br_fingerprint($db);
    $diff = [];
    foreach ($before as $t => $f) {
        if (!isset($after[$t])) { $diff[] = "$t missing"; continue; }
        if ($after[$t]['rows'] !== $f['rows']) $diff[] = "$t rows {$f['rows']} -> {$after[$t]['rows']}";
        if ($after[$t]['checksum'] !== $f['checksum']) $diff[] = "$t checksum differs";
    }
    foreach ($after as $t => $_) if (!isset($before[$t])) $diff[] = "$t is new";
    assert(!$diff, "Restored database differs from the original:\n  " . implode("\n  ", $diff));
    $title = $db->query("SELECT title FROM shows WHERE id = " . $db->quote($show))->fetchColumn();
    assert($title === "Señor Ñandú 日本語 \u{1F600}", 'Accents, CJK and emoji survived');
    assert(count(DbHelper::getComments($show)) === 1 && DbHelper::getRatings($user, $profile['name'])[$show] === 5, 'Comments and ratings are back');
    assert(DbHelper::getWatchSecondsToday($user, $profile['name']) >= 0, 'Application queries work on the restored database');
    echo "✓ Restore brought back " . count($after) . " tables identical to the original OK\n";

    // 7. The restored database is a working one (migrations table included: nothing re-runs or is missing)
    require_once __DIR__ . '/../php_backend/services/MigrationManager.php';
    $status = MigrationManager::getStatus();
    assert(empty($status['pending']), 'No migration is pending after a restore');
    echo "✓ Restored database is up to date OK\n";
} finally {
    $cleanup();
}
echo "Backup and restore round-trip test passed!\n";
