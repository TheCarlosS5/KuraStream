-- KuraStream Migration 005: Notifications Read State, Episode Creation Timestamps, and Library Hardening
-- 1. Add notification read-state timestamp to user_preferences
ALTER TABLE user_preferences
    ADD COLUMN notifications_last_seen_at TIMESTAMP NULL DEFAULT NULL;

-- 2. Add episode creation timestamp for accurate notification calculation
ALTER TABLE episodes
    ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 3. Backfill created_at for existing episodes from show's created_at
UPDATE episodes e
    INNER JOIN shows s ON e.show_id = s.id
    SET e.created_at = s.created_at
    WHERE e.created_at IS NULL OR e.created_at = '0000-00-00 00:00:00';

-- 4. Add storage resilience columns to episodes (prevent deletion during storage disconnects)
ALTER TABLE episodes
    ADD COLUMN availability_status VARCHAR(32) NOT NULL DEFAULT 'available',
    ADD COLUMN missing_scan_count INT NOT NULL DEFAULT 0,
    ADD COLUMN missing_since TIMESTAMP NULL DEFAULT NULL;

-- 5. Add file_mtime for precise fingerprint caching
ALTER TABLE episodes
    ADD COLUMN file_mtime BIGINT NULL DEFAULT NULL;

-- 6. Add persistent TMDB ID to shows to prevent heuristic guessing on rescans
ALTER TABLE shows
    ADD COLUMN tmdb_id VARCHAR(64) NULL DEFAULT NULL;
