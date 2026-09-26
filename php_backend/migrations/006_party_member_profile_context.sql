-- KuraStream Migration 006: Party Member Profile Context (Kids Mode Enforcement)
-- Adds explicit profile context and kids mode restriction flag to party_members

ALTER TABLE party_members
    ADD COLUMN is_kids TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN account_username VARCHAR(64) NULL DEFAULT NULL,
    ADD COLUMN profile_id VARCHAR(64) NULL DEFAULT NULL;
