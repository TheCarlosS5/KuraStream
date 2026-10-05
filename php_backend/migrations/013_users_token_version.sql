-- KuraStream Migration 013: revocable sessions
-- Session tokens carry the account's token_version ("ver"). Changing the password or signing out everywhere
-- increments it, which immediately invalidates every token issued before.
ALTER TABLE users
    ADD COLUMN token_version INT NOT NULL DEFAULT 0;
