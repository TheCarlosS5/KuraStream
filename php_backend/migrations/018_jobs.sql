-- KuraStream Migration 018: background job queue + worker heartbeat
-- Library scans, season syncs, backups and subtitle extraction run in php_backend/worker.php instead of inside a
-- web request. A job is claimed atomically (UPDATE ... WHERE status = 'queued'), so several workers can coexist.
CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    payload TEXT NULL,
    dedupe_key CHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'queued',
    progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
    message VARCHAR(255) NULL,
    result MEDIUMTEXT NULL,
    error TEXT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    created_by VARCHAR(64) NULL,
    created_at BIGINT NOT NULL,
    run_after BIGINT NOT NULL DEFAULT 0,
    started_at BIGINT NULL,
    heartbeat_at BIGINT NULL,
    finished_at BIGINT NULL,
    INDEX idx_jobs_status_run (status, run_after, id),
    INDEX idx_jobs_dedupe (dedupe_key, status),
    INDEX idx_jobs_type_created (type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS worker_status (
    name VARCHAR(64) NOT NULL PRIMARY KEY,
    last_seen BIGINT NOT NULL,
    info VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
