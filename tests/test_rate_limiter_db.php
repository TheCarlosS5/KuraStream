<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';

echo "Running database-backed rate limiter tests...\n";

$db = Database::getConnection();
$key = 'rldb_' . bin2hex(random_bytes(4));
RateLimiter::clear($key);

// 1. State is in the table, shared across processes
assert(RateLimiter::check($key, 3, 60) === true, '1st attempt allowed');
$stmt = $db->prepare("SELECT hits, expires_at FROM rate_limits WHERE k = :k");
$stmt->execute(['k' => md5($key)]);
$row = $stmt->fetch();
assert($row !== false && count(json_decode($row['hits'], true)) === 1, 'The attempt is stored in rate_limits');
assert((int)$row['expires_at'] >= time() + 59, 'The row expires with its window');
RateLimiter::check($key, 3, 60);
RateLimiter::check($key, 3, 60);
$retry = 0;
assert(RateLimiter::check($key, 3, 60, $retry) === false && $retry >= 1 && $retry <= 60, 'The 4th attempt is refused with a Retry-After');
RateLimiter::clear($key);
$stmt->execute(['k' => md5($key)]);
assert($stmt->fetch() === false, 'clear() removes the row');
echo "✓ State lives in the database OK\n";

// 2. Atomic across concurrent processes: exactly $limit of $procs attempts succeed
$limit = 5; $procs = 14;
$racy = 'rldb_race_' . bin2hex(random_bytes(4));
$script = 'define("TESTING_MODE", true); require ' . var_export(__DIR__ . '/../php_backend/middleware/RateLimiter.php', true)
    . '; echo RateLimiter::check(' . var_export($racy, true) . ', ' . $limit . ', 60) ? "1" : "0";';
$children = [];
for ($i = 0; $i < $procs; $i++) {
    $children[] = proc_open([PHP_BINARY, '-r', $script], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
    $children[$i] = [$children[$i], $pipes];
}
$allowed = 0; $total = 0;
foreach ($children as [$proc, $pipes]) {
    $out = stream_get_contents($pipes[1]);
    fclose($pipes[1]); fclose($pipes[2]); proc_close($proc);
    $total += strlen($out);
    $allowed += (int)$out;
}
assert($total === $procs, "all $procs workers answered (got $total)");
assert($allowed === $limit, "exactly $limit of $procs concurrent attempts must pass (got $allowed)");
RateLimiter::clear($racy);
echo "✓ $procs concurrent processes share one limit atomically OK\n";

// 3. A broken store refuses instead of letting everything through
class RlBrokenPdo extends PDO {
    public function __construct() {}
    public function beginTransaction(): bool { $e = new PDOException('MySQL server has gone away'); $e->errorInfo = ['HY000', 2006, 'gone away']; throw $e; }
}
Database::setConnection(new RlBrokenPdo());
$prev = ini_set('error_log', '/dev/null');
try {
    $retry = 0;
    assert(RateLimiter::check('rldb_broken', 3, 60, $retry) === false, 'A storage failure must refuse the attempt (fail closed)');
    assert($retry > 0, 'and tell the client when to retry');
} finally {
    ini_set('error_log', (string)$prev);
    Database::setConnection(null);
}
echo "✓ Storage failure fails closed OK\n";

// 4. Expired rows are purged
$db->prepare("INSERT INTO rate_limits (k, hits, expires_at) VALUES (:k, '[]', :e) ON DUPLICATE KEY UPDATE expires_at = :e")->execute(['k' => md5('rldb_old'), 'e' => time() - 10]);
RateLimiter::$housekeepingOneIn = 1;   // purge on every call
RateLimiter::check('rldb_purge', 1000000, 60);
RateLimiter::$housekeepingOneIn = 200;
$stmt = $db->prepare("SELECT COUNT(*) FROM rate_limits WHERE k = :k");
$stmt->execute(['k' => md5('rldb_old')]);
assert((int)$stmt->fetchColumn() === 0, 'Expired rows are purged by housekeeping');
RateLimiter::clear('rldb_purge');
echo "✓ Expired rows are purged OK\n";

echo "All database rate limiter tests passed.\n";
