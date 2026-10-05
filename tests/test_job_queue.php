<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/services/JobQueue.php';
require_once __DIR__ . '/../php_backend/services/BackupService.php';
require_once __DIR__ . '/../php_backend/worker.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running job queue / worker / backup tests...\n";

$db = Database::getConnection();
$db->exec("DELETE FROM jobs");
$db->exec("DELETE FROM worker_status");
$backupDir = sys_get_temp_dir() . '/kura_backups_' . getmypid();
putenv('BACKUP_DIR=' . $backupDir);
putenv('BACKUP_KEEP=2');
$server = null;

try {
    // 1. Enqueue merges identical pending jobs; payload order does not matter
    $a = JobQueue::enqueue('t_demo', ['x' => 1, 'y' => 2]);
    $b = JobQueue::enqueue('t_demo', ['y' => 2, 'x' => 1]);
    $c = JobQueue::enqueue('t_demo', ['x' => 3]);
    assert($b['existing'] === true && $b['id'] === $a['id'], 'the same job is not queued twice');
    assert($c['id'] !== $a['id'], 'a different payload is a different job');

    // 2. Claim is atomic and oldest-first; a second claim gets the next one
    $j1 = JobQueue::claim();
    $j2 = JobQueue::claim();
    assert($j1['id'] === $a['id'] && $j1['status'] === 'running' && $j1['attempts'] === 1, 'first claim takes the oldest');
    assert($j2['id'] === $c['id'], 'second claim takes the next job');
    assert(JobQueue::claim() === null, 'nothing left to claim');
    JobQueue::progress($j1['id'], 40, 'mitad');
    $got = JobQueue::get($j1['id']);
    assert($got['progress'] === 40 && $got['message'] === 'mitad' && $got['payload'] === ['x' => 1, 'y' => 2], 'progress is stored');
    JobQueue::complete($j1['id'], ['ok' => true]);
    assert(JobQueue::get($j1['id'])['status'] === 'done' && JobQueue::get($j1['id'])['result'] === ['ok' => true], 'complete stores the result');
    assert(JobQueue::enqueue('t_demo', ['x' => 1, 'y' => 2])['existing'] === false, 'a finished job can be queued again');

    // 3. Failure is retried once, then fails for good
    JobQueue::fail($j2['id'], 'boom');
    $retry = JobQueue::get($j2['id']);
    assert($retry['status'] === 'queued' && $retry['error'] === 'boom', 'first failure re-queues the job');
    $db->prepare("UPDATE jobs SET run_after = 0 WHERE id = :id")->execute(['id' => $j2['id']]);
    $again = JobQueue::claim();
    assert($again['id'] === $j2['id'] && $again['attempts'] === 2, 'the retry is claimed');
    JobQueue::fail($j2['id'], 'boom again');
    assert(JobQueue::get($j2['id'])['status'] === 'failed', 'after the last attempt it stays failed');

    // 4. A running job whose worker died is recovered
    $db->exec("DELETE FROM jobs");
    $stale = JobQueue::enqueue('t_stale');
    JobQueue::claim();
    $db->prepare("UPDATE jobs SET heartbeat_at = :t WHERE id = :id")->execute(['t' => time() - JobQueue::STALE_AFTER - 10, 'id' => $stale['id']]);
    assert(JobQueue::recoverStale() === 1, 'stale running job is detected');
    assert(JobQueue::get($stale['id'])['status'] === 'queued', 'and put back in the queue');

    // 5. Worker: handlers, results, errors, unknown types, "success=false" results
    $db->exec("DELETE FROM jobs");
    $worker = new KuraWorker();
    $worker->register('t_ok', fn(array $job) => ['echo' => $job['payload']['v']]);
    $worker->register('t_throw', function () { throw new RuntimeException('handler exploded'); });
    $worker->register('t_soft_fail', fn() => ['success' => false, 'error' => 'sin biblioteca']);
    $ok = JobQueue::enqueue('t_ok', ['v' => 'hola']);
    $soft = JobQueue::enqueue('t_soft_fail');
    $unknown = JobQueue::enqueue('t_nope');
    $thrower = JobQueue::enqueue('t_throw');
    while ($worker->runOne()) {}
    assert(JobQueue::get($ok['id'])['status'] === 'done' && JobQueue::get($ok['id'])['result'] === ['echo' => 'hola'], 'handler result is stored');
    $s = JobQueue::get($soft['id']);
    assert($s['status'] === 'failed' && $s['error'] === 'sin biblioteca', 'a result with success=false fails the job without retrying');
    assert(JobQueue::get($unknown['id'])['status'] === 'failed', 'an unknown job type fails');
    $t = JobQueue::get($thrower['id']);
    assert($t['status'] === 'queued' && str_contains($t['error'], 'handler exploded'), 'an exception is recorded and retried');

    // 6. Worker presence decides whether requests queue work (JOBS_MODE=auto)
    putenv('JOBS_MODE');
    $db->exec("DELETE FROM worker_status");
    assert(JobQueue::workerAlive() === false && JobQueue::shouldQueue() === false, 'no worker: slow work stays inline');
    $worker->chores(true);
    assert(JobQueue::workerAlive() === true && JobQueue::shouldQueue() === true, 'a worker heartbeat switches requests to the queue');
    putenv('JOBS_MODE=inline');
    assert(JobQueue::shouldQueue() === false, 'JOBS_MODE=inline wins');
    putenv('JOBS_MODE=queue');
    $db->exec("DELETE FROM worker_status");
    assert(JobQueue::shouldQueue() === true, 'JOBS_MODE=queue always queues');
    putenv('JOBS_MODE');

    // 7. Chores schedule the daily backup / season sync once, and purge old finished jobs
    $db->exec("DELETE FROM jobs");
    $worker->chores(true);
    $worker->chores(true);
    $count = fn(string $type) => (int)$db->query("SELECT COUNT(*) FROM jobs WHERE type = " . $db->quote($type))->fetchColumn();
    assert($count('season_sync_stale') === 1, 'the season sync is scheduled once, not on every tick');
    if (BackupService::isAvailable()) {
        assert($count('backup') === 1, 'the backup is scheduled once a day');
    }
    $db->exec("INSERT INTO jobs (type, dedupe_key, status, created_at, finished_at) VALUES ('t_old', 'x', 'done', 1, 1)");
    assert(JobQueue::purgeOld(14) === 1, 'old finished jobs are purged');
    echo "✓ Queue, retries, stale recovery, worker and scheduling OK\n";

    // 8. Backups: created atomically, listed, pruned to BACKUP_KEEP, downloadable by name only
    if (BackupService::isAvailable()) {
        $r1 = BackupService::run();
        assert(str_ends_with($r1['file'], '.sql.gz') && $r1['size'] > 200, 'a backup is written');
        $dump = (string)gzdecode((string)file_get_contents($backupDir . '/' . $r1['file']));
        assert(str_contains($dump, 'CREATE TABLE') && str_contains($dump, 'schema_migrations'), 'it contains the schema');
        assert(glob($backupDir . '/*.part') === [], 'no partial file is left behind');
        // distinct names need distinct seconds
        foreach (['20200101-000001', '20200101-000002', '20200101-000003'] as $stamp) {
            file_put_contents($backupDir . "/kurastream-$stamp.sql.gz", 'x');
        }
        $r2 = BackupService::run();
        assert(count(BackupService::list()) === 2 && $r2['removed'] >= 1, 'only the newest BACKUP_KEEP backups are kept');
        assert(BackupService::path('../../etc/passwd') === null && BackupService::path('kurastream-x.sql.gz') === null, 'path() rejects anything but backup names');
        assert(BackupService::path($r2['file']) !== null, 'path() resolves a real backup');
    } else {
        echo "  (mysqldump not installed: backup checks skipped)\n";
    }
    echo "✓ Backups OK\n";

    // 9. Admin endpoints through the real router
    $db->exec("DELETE FROM jobs");
    $admin = AuthMiddleware::createToken(['username' => 'job_admin', 'role' => 'admin', 'exp' => time() + 3600]);
    putenv('ADMIN_USER=job_admin');
    [$server, $port] = kura_start_server(['ADMIN_USER' => 'job_admin', 'JOBS_MODE' => 'queue', 'MEDIA_LIBRARY_PATH' => sys_get_temp_dir() . '/kura_empty_lib_' . getmypid(), 'BACKUP_DIR' => $backupDir]);
    [$code] = kura_http($port, 'POST', '/api/admin/scan');
    assert($code === 401, 'scan needs an admin');
    [$code, , $json] = kura_http($port, 'POST', '/api/admin/scan', null, $admin);
    assert($code === 202 && $json['queued'] === true && $json['job_id'] > 0, "scan is queued, not run in the request (got $code)");
    [$code, , $dup] = kura_http($port, 'POST', '/api/admin/scan', null, $admin);
    assert($code === 202 && $dup['job_id'] === $json['job_id'] && $dup['already_queued'] === true, 'a second click joins the pending job');
    [$code, , $st] = kura_http($port, 'GET', '/api/admin/jobs/' . $json['job_id'], null, $admin);
    assert($code === 200 && $st['job']['status'] === 'queued' && $st['job']['type'] === 'library_scan', 'job status is readable');
    [$code, , $list] = kura_http($port, 'GET', '/api/admin/jobs', null, $admin);
    assert($code === 200 && count($list['jobs']) === 1 && isset($list['worker_alive']), 'job list');
    [$code] = kura_http($port, 'GET', '/api/admin/jobs/999999', null, $admin);
    assert($code === 404, 'unknown job');
    [$code] = kura_http($port, 'GET', '/api/admin/jobs');
    assert($code === 401, 'jobs are admin only');
    [$code, , $none] = kura_http($port, 'POST', '/api/admin/shows/no_such_show/sync-seasons', null, $admin);
    assert($code === 404, 'queued season sync still validates the show');
    if (BackupService::isAvailable()) {
        [$code, , $bk] = kura_http($port, 'POST', '/api/admin/backups', null, $admin);
        assert($code === 202 && $bk['queued'] === true, 'backup is queued');
        [$code, , $bl] = kura_http($port, 'GET', '/api/admin/backups', null, $admin);
        assert($code === 200 && count($bl['backups']) >= 1, 'backups are listed');
        [$code, $h, , $raw] = kura_http($port, 'GET', '/api/admin/backups/' . $bl['backups'][0]['file'], null, $admin);
        assert($code === 200 && ($h['content-type'] ?? '') === 'application/gzip' && strlen($raw) > 100, 'a backup can be downloaded');
        [$code] = kura_http($port, 'GET', '/api/admin/backups/..%2F..%2Fetc%2Fpasswd', null, $admin);
        assert($code === 404, 'no path traversal in downloads');
    }

    // 10. The real worker process: --once runs what is queued (a scan of an empty library fails cleanly)
    $db->exec("DELETE FROM jobs");
    JobQueue::enqueue('library_scan');
    $cmd = sprintf('%s %s --once 2>&1', escapeshellarg(PHP_BINARY), escapeshellarg(__DIR__ . '/../php_backend/worker.php'));
    $out = shell_exec('MEDIA_LIBRARY_PATH=' . escapeshellarg(sys_get_temp_dir() . '/kura_empty_lib_' . getmypid()) . ' ' . $cmd);
    $row = $db->query("SELECT status, error FROM jobs WHERE type = 'library_scan'")->fetch(PDO::FETCH_ASSOC);
    assert($row && in_array($row['status'], ['failed', 'done'], true), 'worker --once processed the scan: ' . json_encode($row) . " / $out");
    assert(str_contains((string)$out, 'ready'), 'worker started');
    echo "✓ Admin endpoints and the worker process OK\n";

    // 11. The admin health panel's data
    $db->exec("DELETE FROM jobs");
    $db->exec("DELETE FROM worker_status");
    JobQueue::enqueue('t_queued_demo');
    $health = AdminController::systemHealth();
    foreach (['worker', 'jobs', 'backups', 'disk', 'processes', 'party_viewers', 'load_average', 'migrations_ok'] as $key) {
        assert(array_key_exists($key, $health), "system health has $key");
    }
    assert($health['worker']['alive'] === false && $health['jobs']['queued'] === 1, 'a queued job and no worker are reported');
    assert($health['disk']['library'] === null || $health['disk']['library']['used_percent'] >= 0, 'disk usage is a percentage');
    assert(is_int($health['processes']['ffmpeg']) && $health['migrations_ok'] === true, 'process counts and migration state');
    $worker->chores(true);
    assert(AdminController::systemHealth()['worker']['alive'] === true, 'the worker shows as alive after a heartbeat');
    echo "✓ System health data OK\n";
} finally {
    kura_stop_server($server);
    $db->exec("DELETE FROM jobs");
    $db->exec("DELETE FROM worker_status");
    foreach (glob($backupDir . '/*') ?: [] as $f) @unlink($f);
    @rmdir($backupDir);
}
echo "All job queue tests passed.\n";
