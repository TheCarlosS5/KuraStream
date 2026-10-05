<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

/**
 * Small database-backed job queue. Producers (admin endpoints, the worker's own scheduler) enqueue; php_backend/worker.php
 * claims and runs. Identical queued/running jobs are merged (same type + payload), so double clicks and overlapping
 * schedules never pile up.
 */
class JobQueue {
    public const MAX_ATTEMPTS = 2;
    /** A running job that has not reported for this long belongs to a worker that died. */
    public const STALE_AFTER = 300;
    /** The worker counts as alive when it reported within this many seconds. */
    public const WORKER_ALIVE_WITHIN = 45;

    private static function db(): PDO {
        return Database::getConnection();
    }

    private static function dedupeKey(string $type, array $payload): string {
        ksort($payload);
        return md5($type . '|' . json_encode($payload));
    }

    /** @return array{id:int, existing:bool} */
    public static function enqueue(string $type, array $payload = [], ?string $createdBy = null, int $delaySeconds = 0): array {
        $db = self::db();
        $key = self::dedupeKey($type, $payload);
        $stmt = $db->prepare("SELECT id FROM jobs WHERE dedupe_key = :k AND status IN ('queued', 'running') ORDER BY id LIMIT 1");
        $stmt->execute(['k' => $key]);
        $existing = $stmt->fetchColumn();
        if ($existing) {
            return ['id' => (int)$existing, 'existing' => true];
        }
        $now = time();
        $db->prepare(
            "INSERT INTO jobs (type, payload, dedupe_key, status, created_by, created_at, run_after)
             VALUES (:t, :p, :k, 'queued', :u, :c, :r)"
        )->execute([
            't' => $type,
            'p' => json_encode($payload),
            'k' => $key,
            'u' => $createdBy,
            'c' => $now,
            'r' => $now + max(0, $delaySeconds),
        ]);
        return ['id' => (int)$db->lastInsertId(), 'existing' => false];
    }

    /** Claims the oldest runnable job for this worker, or null when there is none. */
    public static function claim(): ?array {
        $db = self::db();
        $now = time();
        for ($try = 0; $try < 5; $try++) {
            $stmt = $db->prepare("SELECT id FROM jobs WHERE status = 'queued' AND run_after <= :n ORDER BY id LIMIT 1");
            $stmt->execute(['n' => $now]);
            $id = $stmt->fetchColumn();
            if (!$id) {
                return null;
            }
            $upd = $db->prepare(
                "UPDATE jobs SET status = 'running', started_at = :n, heartbeat_at = :n, attempts = attempts + 1, progress = 0, error = NULL
                 WHERE id = :id AND status = 'queued'"
            );
            $upd->execute(['n' => $now, 'id' => $id]);
            if ($upd->rowCount() === 1) {
                return self::get((int)$id);
            }
            // another worker took it first: look again
        }
        return null;
    }

    public static function progress(int $id, int $percent, ?string $message = null): void {
        self::db()->prepare("UPDATE jobs SET progress = :p, message = :m, heartbeat_at = :n WHERE id = :id AND status = 'running'")
            ->execute(['p' => max(0, min(100, $percent)), 'm' => $message !== null ? mb_substr($message, 0, 250) : null, 'n' => time(), 'id' => $id]);
    }

    public static function complete(int $id, array $result = []): void {
        self::db()->prepare("UPDATE jobs SET status = 'done', progress = 100, result = :r, finished_at = :n, heartbeat_at = :n WHERE id = :id")
            ->execute(['r' => json_encode($result, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), 'n' => time(), 'id' => $id]);
    }

    /** A failed job is retried once (after a pause) unless $final. */
    public static function fail(int $id, string $error, bool $final = false): void {
        $job = self::get($id);
        $retry = !$final && $job && (int)$job['attempts'] < self::MAX_ATTEMPTS;
        if ($retry) {
            self::db()->prepare("UPDATE jobs SET status = 'queued', error = :e, run_after = :r, started_at = NULL WHERE id = :id")
                ->execute(['e' => mb_substr($error, 0, 2000), 'r' => time() + 30, 'id' => $id]);
            return;
        }
        self::db()->prepare("UPDATE jobs SET status = 'failed', error = :e, finished_at = :n WHERE id = :id")
            ->execute(['e' => mb_substr($error, 0, 2000), 'n' => time(), 'id' => $id]);
    }

    /** Jobs left 'running' by a worker that died are retried (or failed once out of attempts). */
    public static function recoverStale(): int {
        $db = self::db();
        $stmt = $db->prepare("SELECT id FROM jobs WHERE status = 'running' AND heartbeat_at < :t");
        $stmt->execute(['t' => time() - self::STALE_AFTER]);
        $count = 0;
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $id) {
            self::fail((int)$id, 'El worker se interrumpió durante el trabajo');
            $count++;
        }
        return $count;
    }

    public static function get(int $id): ?array {
        $stmt = self::db()->prepare("SELECT * FROM jobs WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? self::present($row) : null;
    }

    public static function recent(int $limit = 30): array {
        $limit = max(1, min(100, $limit));
        $rows = self::db()->query("SELECT * FROM jobs ORDER BY id DESC LIMIT $limit")->fetchAll(PDO::FETCH_ASSOC);
        return array_map([self::class, 'present'], $rows);
    }

    public static function lastCreatedAt(string $type): int {
        $stmt = self::db()->prepare("SELECT MAX(created_at) FROM jobs WHERE type = :t");
        $stmt->execute(['t' => $type]);
        return (int)$stmt->fetchColumn();
    }

    public static function purgeOld(int $keepDays = 14): int {
        $stmt = self::db()->prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at < :t");
        $stmt->execute(['t' => time() - $keepDays * 86400]);
        return $stmt->rowCount();
    }

    private static function present(array $row): array {
        $row['id'] = (int)$row['id'];
        $row['progress'] = (int)$row['progress'];
        $row['attempts'] = (int)$row['attempts'];
        $row['payload'] = $row['payload'] !== null ? (json_decode($row['payload'], true) ?: []) : [];
        $row['result'] = $row['result'] !== null ? json_decode($row['result'], true) : null;
        unset($row['dedupe_key']);
        return $row;
    }

    // --- worker presence ---------------------------------------------------------------------------------------

    public static function workerHeartbeat(string $name, string $info = ''): void {
        self::db()->prepare(
            "INSERT INTO worker_status (name, last_seen, info) VALUES (:n, :t, :i)
             ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), info = VALUES(info)"
        )->execute(['n' => $name, 't' => time(), 'i' => mb_substr($info, 0, 250)]);
    }

    public static function workerAlive(): bool {
        try {
            $stmt = self::db()->prepare("SELECT COUNT(*) FROM worker_status WHERE last_seen >= :t");
            $stmt->execute(['t' => time() - self::WORKER_ALIVE_WITHIN]);
            return (int)$stmt->fetchColumn() > 0;
        } catch (Throwable $e) {
            return false;
        }
    }

    /**
     * Should a request hand its slow work to the worker? JOBS_MODE=queue always does (and the job waits for a
     * worker), JOBS_MODE=inline never does, and the default "auto" does so only while a worker is alive, so a
     * plain `php -S` development setup keeps working without one.
     */
    public static function shouldQueue(): bool {
        $mode = strtolower(trim((string)getenv('JOBS_MODE')));
        if ($mode === 'queue') return true;
        if ($mode === 'inline') return false;
        return self::workerAlive();
    }
}
