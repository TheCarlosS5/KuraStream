-- KuraStream Migration 015: rate limiter state in the database
-- One row per limiter key (md5 of the key) holding the timestamps inside its window. Shared by every PHP process
-- and container, unlike the per-host files in /tmp it replaces, and expired rows are purged.
CREATE TABLE IF NOT EXISTS rate_limits (
    k CHAR(32) NOT NULL PRIMARY KEY,
    hits TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    INDEX idx_rate_limits_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
