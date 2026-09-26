-- KuraStream Migration 004: Security Hardening for User Profiles and Watch Party Members
-- Enforces unique profile names per user account
-- Migrates Watch Party participant identity to unique member_id + token_hash credentials

-- 1. Ensure profile name uniqueness per user account
ALTER TABLE user_profiles
    ADD UNIQUE KEY uniq_user_profile_name (username, name);

-- 2. Add authenticated member identity, token hash, and role to party_members
ALTER TABLE party_members
    ADD COLUMN member_id VARCHAR(64) NOT NULL DEFAULT '' AFTER room_id,
    ADD COLUMN token_hash VARCHAR(64) NOT NULL DEFAULT '' AFTER member_id,
    ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'viewer' AFTER token_hash;

-- 3. Backfill any existing legacy party member records with secure deterministic member credentials
UPDATE party_members
    SET member_id = CONCAT('mem_', SUBSTRING(MD5(CONCAT(id, username, joined_at)), 1, 16))
    WHERE member_id = '' OR member_id IS NULL;

UPDATE party_members
    SET token_hash = SHA2(CONCAT(member_id, 'kura_salt_fallback'), 256)
    WHERE token_hash = '' OR token_hash IS NULL;

-- 4. Drop legacy unique constraint on room_id + username to allow shared display names
ALTER TABLE party_members
    DROP INDEX uniq_room_user;

-- 5. Add unique constraint on room_id + member_id and index on token_hash
ALTER TABLE party_members
    ADD UNIQUE KEY uniq_room_member (room_id, member_id),
    ADD INDEX idx_party_members_token (token_hash);

-- 6. Add notifications read state timestamp to user_preferences
ALTER TABLE user_preferences
    ADD COLUMN notifications_last_seen_at TIMESTAMP NULL DEFAULT NULL;
