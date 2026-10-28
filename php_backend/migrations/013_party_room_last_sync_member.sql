-- KuraStream Migration 013: track which participant sent the last playback sync
-- Enables host to ignore echo updates from its own playback while applying remote guest controls.
ALTER TABLE party_rooms
    ADD COLUMN last_sync_member VARCHAR(64) NULL DEFAULT NULL;
