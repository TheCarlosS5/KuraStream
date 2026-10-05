<?php
/**
 * KuraStream background worker. Run it next to the web server:
 *
 *   php php_backend/worker.php            # forever (systemd / docker-compose service)
 *   php php_backend/worker.php --once     # process what is queued, run the schedule once, exit (tests, cron)
 *
 * It runs the jobs the web requests queue (library scan, season sync, backups, ...) and the periodic chores that
 * used to depend on somebody opening the right page: expired Watch Party rooms, subtitle cache, rate limiter rows,
 * old jobs, the daily database backup and the stale-season sync.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/services/JobQueue.php';
require_once __DIR__ . '/services/BackupService.php';

class KuraWorker {
    /** @var array<string, callable> */
    private array $handlers = [];
    private int $lastChores = 0;
    private bool $stop = false;
    private string $name;

    public function __construct() {
        $this->name = (gethostname() ?: 'worker') . ':' . getmypid();
        $this->handlers = [
            'library_scan' => function (array $job): array {
                require_once __DIR__ . '/services/LibraryScanner.php';
                $result = LibraryScanner::runScan();
                if (($result['success'] ?? true) !== false) {
                    // New files: have their subtitles and fonts ready before anybody presses play.
                    JobQueue::enqueue('subtitles_prepare', [], 'scheduler');
                }
                return $result;
            },
            'subtitles_prepare' => function (array $job): array {
                require_once __DIR__ . '/services/SubtitleCache.php';
                $db = Database::getConnection();
                $rows = $db->query(
                    "SELECT id, filepath, subtitle_tracks FROM episodes
                     WHERE availability_status = 'available' AND subtitle_tracks IS NOT NULL AND subtitle_tracks NOT IN ('', '[]', 'null')
                     ORDER BY show_id, season_number, episode_number"
                )->fetchAll(PDO::FETCH_ASSOC);
                $total = max(1, count($rows));
                $sum = ['episodes' => count($rows), 'tracks' => 0, 'fonts' => 0, 'failed' => 0];
                $started = time();
                foreach ($rows as $i => $row) {
                    if (time() - $started > 3600) {   // the next scheduled run continues where this one stopped
                        $sum['stopped_early'] = true;
                        break;
                    }
                    $r = SubtitleCache::prepareEpisode($row);
                    $sum['tracks'] += $r['tracks'];
                    $sum['fonts'] += $r['fonts'];
                    $sum['failed'] += $r['failed'];
                    if ($i % 5 === 0) {
                        JobQueue::progress($job['id'], (int)floor($i * 100 / $total), ($i + 1) . '/' . count($rows) . ' episodios');
                    }
                    if ($this->stop) break;
                }
                return $sum;
            },
            'season_sync' => function (array $job): array {
                require_once __DIR__ . '/services/SeasonSync.php';
                require_once __DIR__ . '/services/IntroSync.php';
                $showId = (string)($job['payload']['show_id'] ?? '');
                $force = !empty($job['payload']['force']);
                $seasons = SeasonSync::syncShow($showId, $force);
                if (!empty($seasons['error'])) {
                    throw new RuntimeException('Show no encontrado');
                }
                return ['seasons' => $seasons, 'intros' => IntroSync::syncShow($showId, $force)];
            },
            'season_sync_stale' => function (array $job): array {
                require_once __DIR__ . '/services/LibraryScanner.php';
                return LibraryScanner::syncSeasonMetadata(600);
            },
            'backup' => fn(array $job): array => BackupService::run(),
        ];
    }

    /** Extra handlers (used by tests and by later features such as subtitle extraction). */
    public function register(string $type, callable $handler): void {
        $this->handlers[$type] = $handler;
    }

    public function stop(): void {
        $this->stop = true;
    }

    /** Runs one job if any is due. Returns whether something ran. */
    public function runOne(): bool {
        $job = JobQueue::claim();
        if ($job === null) {
            return false;
        }
        $handler = $this->handlers[$job['type']] ?? null;
        if ($handler === null) {
            JobQueue::fail($job['id'], 'Tipo de trabajo desconocido: ' . $job['type'], true);
            return true;
        }
        $this->log("job #{$job['id']} {$job['type']} started");
        try {
            $result = $handler($job);
            if (is_array($result) && array_key_exists('success', $result) && $result['success'] === false) {
                JobQueue::fail($job['id'], (string)($result['error'] ?? 'El trabajo terminó con error'), true);
            } else {
                JobQueue::complete($job['id'], is_array($result) ? $result : ['result' => $result]);
            }
        } catch (Throwable $e) {
            $this->log("job #{$job['id']} {$job['type']} failed: " . $e->getMessage());
            JobQueue::fail($job['id'], $e->getMessage());
        }
        return true;
    }

    /** Periodic chores and scheduling. Cheap enough to call every few seconds; each part rate-limits itself. */
    public function chores(bool $force = false): void {
        $now = time();
        JobQueue::workerHeartbeat($this->name, 'ok');
        if (!$force && $now - $this->lastChores < 60) {
            return;
        }
        $this->lastChores = $now;

        try { JobQueue::recoverStale(); } catch (Throwable $e) { $this->log('recoverStale: ' . $e->getMessage()); }
        try { DbHelper::runPartyHousekeeping(); } catch (Throwable $e) { $this->log('party housekeeping: ' . $e->getMessage()); }
        try {
            $db = Database::getConnection();
            $db->prepare("DELETE FROM rate_limits WHERE expires_at < :n")->execute(['n' => $now]);
        } catch (Throwable $e) { $this->log('rate limits: ' . $e->getMessage()); }
        try {
            require_once __DIR__ . '/controllers/PlayerController.php';
            require_once __DIR__ . '/services/SubtitleCache.php';
            $cache = SubtitleCache::dir();
            if (is_dir($cache)) PlayerController::pruneCacheDir($cache);
        } catch (Throwable $e) { $this->log('cache prune: ' . $e->getMessage()); }
        try { JobQueue::purgeOld(); } catch (Throwable $e) { $this->log('purge jobs: ' . $e->getMessage()); }

        // Schedule: a database backup every day, stale season metadata every 6 hours.
        try {
            if (BackupService::isAvailable() && $now - JobQueue::lastCreatedAt('backup') >= 86400) {
                JobQueue::enqueue('backup', [], 'scheduler');
            }
            if ($now - JobQueue::lastCreatedAt('subtitles_prepare') >= 86400) {
                JobQueue::enqueue('subtitles_prepare', [], 'scheduler');
            }
            if ($now - JobQueue::lastCreatedAt('season_sync_stale') >= 21600) {
                JobQueue::enqueue('season_sync_stale', [], 'scheduler');
            }
        } catch (Throwable $e) { $this->log('schedule: ' . $e->getMessage()); }
    }

    public function run(bool $once): void {
        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGTERM, fn() => $this->stop());
            pcntl_signal(SIGINT, fn() => $this->stop());
        }
        $this->log('worker ' . $this->name . ' ready');
        $this->chores(true);
        do {
            $ran = $this->runOne();
            $this->chores();
            if ($once && !$ran) {
                break;
            }
            if (!$ran && !$once) {
                sleep(2);
            }
        } while (!$this->stop);
    }

    private function log(string $message): void {
        fwrite(STDERR, '[' . date('c') . '] ' . $message . PHP_EOL);
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    // MigrationManager runs on the first connection, so the jobs table exists before the first query.
    (new KuraWorker())->run(in_array('--once', $argv ?? [], true));
}
