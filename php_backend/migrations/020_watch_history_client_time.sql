-- KuraStream Migration 020: last-writer-wins between devices
-- A progress save carries the client's clock (milliseconds). The server keeps the newest one, so a phone that
-- reconnects and uploads old progress cannot overwrite what was watched later on another device.
ALTER TABLE watch_history
    ADD COLUMN client_updated_at BIGINT NULL DEFAULT NULL;
