-- KuraStream Migration 016: cheap change detection for Watch Party streams
-- party_rooms.version is bumped on every state change so an SSE loop can poll one tiny row instead of re-reading
-- (and joining) the whole room several times per second. The party_members indexes serve the per-room and the
-- housekeeping staleness deletes.
ALTER TABLE party_rooms
    ADD COLUMN version INT NOT NULL DEFAULT 0;
ALTER TABLE party_members
    ADD INDEX idx_party_members_ping (last_ping),
    ADD INDEX idx_party_members_room_ping (room_id, last_ping);
