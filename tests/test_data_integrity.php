<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/services/MigrationManager.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running data integrity tests (migrations, progress, foreign keys, UTC)...\n";

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$showId = "di_show_$suffix"; $epId = "di_show_{$suffix}_S1_E1"; $room = "DI-ROOM-$suffix"; $user = "di_user_$suffix";
$server = null; $tmp = sys_get_temp_dir() . "/kura_di_$suffix";

try {
    // 1. The SQL splitter understands strings and comments
    $sql = "-- header; with a semicolon\nCREATE TABLE a (x VARCHAR(10) DEFAULT 'a;b', y INT); /* block; comment */\n"
        . "INSERT INTO a VALUES ('it''s; fine', 1);\n# hash; comment\nINSERT INTO a VALUES (\"q;\\\"uote\", 2);\n--no-space-is-not-a-comment\nSELECT 1";
    $st = MigrationManager::parseSqlStatements($sql);
    assert(count($st) === 4, 'four statements, got ' . count($st) . ': ' . json_encode($st));
    assert(str_contains($st[0], "'a;b'") && str_contains($st[1], "'it''s; fine'") && str_contains($st[2], 'q;\\"uote'), 'semicolons inside quotes survive');
    assert(str_contains($st[3], '--no-space-is-not-a-comment'), '-- without a space is not a comment (MySQL rule)');
    $d = MigrationManager::parseSqlStatementsDetailed("-- @optional\nALTER TABLE x ADD c INT;\nALTER TABLE y ADD d INT;\n-- note\n-- @optional\nSELECT 2;");
    assert(array_column($d, 'optional') === [true, false, true], 'optional flags: ' . json_encode($d));

    // 2. An optional statement that fails is skipped, a mandatory one aborts the migration (and nothing is recorded)
    $probe = "di_probe_$suffix";
    $db->exec("CREATE TABLE $probe (id INT PRIMARY KEY) ENGINE=InnoDB");
    $good = "999_test_$suffix.sql";
    $dir = __DIR__ . '/../php_backend/migrations';
    file_put_contents("$dir/$good", "-- @optional\nALTER TABLE no_such_table_$suffix ADD CONSTRAINT x FOREIGN KEY (a) REFERENCES b (c);\nINSERT INTO $probe VALUES (1);\n");
    $r = MigrationManager::runPending($db);
    assert(in_array($good, $r['newly_applied'], true), 'a migration with a failing optional statement still applies');
    assert((int)$db->query("SELECT COUNT(*) FROM $probe")->fetchColumn() === 1, 'and its other statements ran');
    $db->exec("DELETE FROM schema_migrations WHERE version = " . $db->quote($good));
    $bad = "998_test_$suffix.sql";
    @unlink("$dir/$good");
    file_put_contents("$dir/$bad", "INSERT INTO $probe VALUES (2);\nALTER TABLE no_such_table_$suffix ADD c INT;\n");
    $failed = false;
    try { MigrationManager::runPending($db); } catch (RuntimeException $e) { $failed = str_contains($e->getMessage(), $bad); }
    assert($failed, 'a mandatory failing statement aborts and names the migration');
    assert((int)$db->query("SELECT COUNT(*) FROM schema_migrations WHERE version = " . $db->quote($bad))->fetchColumn() === 0, 'a failed migration is not recorded as applied');
    @unlink("$dir/$bad");
    echo "✓ Migration parser and failure handling OK\n";

    // 3. /api/health reports a failed migration as degraded (503) once, instead of every request re-running it
    @mkdir($tmp, 0777, true);
    $key = md5(DB_HOST . '|' . DB_PORT . '|' . DB_NAME);
    $files = glob(__DIR__ . '/../php_backend/migrations/*.sql'); sort($files);
    // "the newest migration was already attempted": requests skip the migration step, like they do after a failure
    file_put_contents("$tmp/kurastream_schema_$key.txt", basename(end($files)));
    file_put_contents("$tmp/kurastream_schema_failed_$key.json", json_encode(['error' => 'Migration failed', 'latest' => '999_x.sql', 'at' => time()]));
    [$server, $port] = kura_start_server(['TMPDIR' => $tmp]);
    [$code, , $json] = kura_http($port, 'GET', '/api/health');
    assert($code === 503 && $json['status'] === 'degraded' && ($json['migrations'] ?? '') === 'failed', "health says degraded when a migration failed (got $code)");
    kura_stop_server($server); $server = null;
    @unlink("$tmp/kurastream_schema_failed_$key.json");
    [$server, $port] = kura_start_server(['TMPDIR' => $tmp]);
    [$code, , $json] = kura_http($port, 'GET', '/api/health');
    assert($code === 200 && $json['status'] === 'healthy', 'and healthy again without the failure marker');
    kura_stop_server($server); $server = null;
    echo "✓ Health reflects migration failures\n";

    // 4. UTC everywhere: the connection, and ISO-8601 with a zone on the way out
    assert($db->query("SELECT @@session.time_zone")->fetchColumn() === '+00:00', 'the connection runs in UTC');
    $iso = kuraIsoDates(['created_at' => '2026-10-05 14:03:00', 'updated_at' => '2026-10-05 14:03:00.123456', 'air_date' => '2026-10-05', 'content' => '2026-10-05 14:03:00',
        'nested' => [['last_ping' => '2026-10-05 14:03:00', 'timestamp' => '2026-10-05 14:03:00', 'synced_at' => null, 'note_at' => 'tomorrow']], 'count' => 3]);
    assert($iso['created_at'] === '2026-10-05T14:03:00Z' && $iso['updated_at'] === '2026-10-05T14:03:00Z', 'timestamps get a zone');
    assert($iso['air_date'] === '2026-10-05' && $iso['content'] === '2026-10-05 14:03:00', 'dates and free text are untouched');
    assert($iso['nested'][0]['last_ping'] === '2026-10-05T14:03:00Z' && $iso['nested'][0]['timestamp'] === '2026-10-05T14:03:00Z' && $iso['nested'][0]['note_at'] === 'tomorrow' && $iso['count'] === 3, 'nested values and non-dates are handled');
    echo "✓ UTC and ISO-8601 OK\n";

    // 5. Watch progress: canonical id, completed only goes up, newest device wins
    DbHelper::saveShow(['id' => $showId, 'title' => 'DI Show', 'type' => 'anime', 'folder' => 'di']);
    DbHelper::saveEpisode(['id' => $epId, 'show_id' => $showId, 'season_number' => 1, 'episode_number' => 1, 'title' => 'E1', 'filepath' => '/tmp/none.mkv',
        'duration' => 1000, 'size' => 1, 'video_codec' => 'h264', 'resolution' => '1x1', 'fps' => 24, 'audio_tracks' => [], 'subtitle_tracks' => [], 'thumbnail_path' => '', 'chapters' => []]);
    $row = fn() => $db->query("SELECT * FROM watch_history WHERE username = " . $db->quote($user) . " AND profile_name = 'Principal'")->fetch(PDO::FETCH_ASSOC);

    DbHelper::saveProgress($user, 'Principal', $epId, 950, 1000, true, 5000);
    assert($row()['completed'] == 1 && (float)$row()['progress_seconds'] === 950.0, 'finished episode is stored');
    DbHelper::saveProgress($user, 'Principal', $epId, 10, 1000, false, 6000);
    assert($row()['completed'] == 1, 'watching the opening again does not unmark a finished episode');
    assert((float)$row()['progress_seconds'] === 10.0, 'but the position follows the newest write');
    DbHelper::saveProgress($user, 'Principal', $epId, 500, 1000, false, 5500);
    assert((float)$row()['progress_seconds'] === 10.0 && (int)$row()['client_updated_at'] === 6000, 'an older write from another device is ignored');
    DbHelper::saveProgress($user, 'Principal', $epId, 700, 1000, false, 7000);
    assert((float)$row()['progress_seconds'] === 700.0 && (int)$row()['client_updated_at'] === 7000, 'a newer one wins');
    DbHelper::saveProgress($user, 'Principal', $epId, 710, 1000, false, (time() + 10 * 86400) * 1000);
    assert((float)$row()['progress_seconds'] === 710.0 && (int)$row()['client_updated_at'] === 7000, 'a clock far in the future is ignored, not trusted');
    DbHelper::saveProgress($user, 'Principal', $epId, 720, 1000, false, null);
    assert((float)$row()['progress_seconds'] === 720.0 && (int)$row()['client_updated_at'] === 7000, 'clients without a clock (old apps) still save, keeping the stored one');
    echo "✓ Progress rules OK\n";

    // 6. Foreign keys: deleting a show or a room leaves nothing behind
    $db->prepare("INSERT INTO favorites (username, profile_name, show_id) VALUES (:u, 'Principal', :s)")->execute(['u' => $user, 's' => $showId]);
    DbHelper::addComment($showId, $user, 'Principal', 'hola');
    $db->prepare("INSERT INTO show_seasons (show_id, season_number, name) VALUES (:s, 1, 'T1')")->execute(['s' => $showId]);
    $failed = false;
    try { DbHelper::saveEpisode(['id' => "orphan_$suffix", 'show_id' => "no_such_show_$suffix", 'season_number' => 1, 'episode_number' => 1, 'title' => 'x', 'filepath' => '/tmp/x.mkv',
        'duration' => 1, 'size' => 1, 'video_codec' => '', 'resolution' => '', 'fps' => 0, 'audio_tracks' => [], 'subtitle_tracks' => [], 'thumbnail_path' => '', 'chapters' => []]); }
    catch (PDOException $e) { $failed = true; }
    assert($failed, 'an episode cannot be created for a show that does not exist');
    $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $showId]);   // the database itself cascades
    foreach (['episodes' => 'show_id', 'favorites' => 'show_id', 'comments' => 'show_id', 'show_seasons' => 'show_id'] as $table => $col) {
        assert((int)$db->query("SELECT COUNT(*) FROM $table WHERE $col = " . $db->quote($showId))->fetchColumn() === 0, "$table rows of a deleted show are gone");
    }
    DbHelper::createPartyRoom(['id' => $room, 'name' => 'r', 'host_user' => $user, 'episode_id' => $epId]);
    DbHelper::addPartyMessage($room, $user, 'hi');
    DbHelper::recordPartyMember($room, $user, 'mem_' . $suffix, hash('sha256', 'x'), 'host');
    $db->prepare("DELETE FROM party_rooms WHERE id = :r")->execute(['r' => $room]);
    foreach (['party_messages', 'party_members'] as $table) {
        assert((int)$db->query("SELECT COUNT(*) FROM $table WHERE room_id = " . $db->quote($room))->fetchColumn() === 0, "$table rows of a deleted room are gone");
    }
    echo "✓ Foreign keys cascade OK\n";
} finally {
    kura_stop_server($server);
    @unlink(__DIR__ . "/../php_backend/migrations/999_test_$suffix.sql");
    @unlink(__DIR__ . "/../php_backend/migrations/998_test_$suffix.sql");
    $db->exec("DELETE FROM schema_migrations WHERE version LIKE '99%\\_test\\_$suffix.sql' OR version LIKE '998\\_test\\_$suffix.sql'");
    $db->exec("DROP TABLE IF EXISTS di_probe_$suffix");
    $db->prepare("DELETE FROM watch_history WHERE username = :u")->execute(['u' => $user]);
    $db->prepare("DELETE FROM party_rooms WHERE id = :r")->execute(['r' => $room]);
    $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $showId]);
    foreach (glob("$tmp/*") ?: [] as $f) @unlink($f);
    @rmdir($tmp);
}
echo "All data integrity tests passed.\n";
