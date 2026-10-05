-- KuraStream Migration 019: referential integrity
-- Rows that belong to something that no longer exists are removed, and the relations that cannot be broken by a
-- legitimate code path become foreign keys with ON DELETE CASCADE, so deleting a show or a Watch Party room cannot
-- leave orphans behind (the application used to delete them by hand, and an interrupted request left them).
-- Watch history and profile data are NOT cascaded from episodes: deleting and re-importing a show must not erase
-- what people already watched (DbHelper::deleteShow removes the history of the show's episodes explicitly).
-- The foreign keys are optional statements: a database imported from a dump with different collations keeps working
-- (without the constraint) instead of failing to start.

DELETE FROM party_messages WHERE room_id NOT IN (SELECT id FROM party_rooms);
DELETE FROM party_members WHERE room_id NOT IN (SELECT id FROM party_rooms);
DELETE FROM show_seasons WHERE show_id NOT IN (SELECT id FROM shows);
DELETE FROM episodes WHERE show_id NOT IN (SELECT id FROM shows);
DELETE FROM favorites WHERE show_id NOT IN (SELECT id FROM shows);
DELETE FROM comments WHERE show_id NOT IN (SELECT id FROM shows);

-- @optional
ALTER TABLE party_messages ADD CONSTRAINT fk_party_messages_room FOREIGN KEY (room_id) REFERENCES party_rooms (id) ON DELETE CASCADE;
-- @optional
ALTER TABLE party_members ADD CONSTRAINT fk_party_members_room FOREIGN KEY (room_id) REFERENCES party_rooms (id) ON DELETE CASCADE;
-- @optional
ALTER TABLE show_seasons ADD CONSTRAINT fk_show_seasons_show FOREIGN KEY (show_id) REFERENCES shows (id) ON DELETE CASCADE;
-- @optional
ALTER TABLE episodes ADD CONSTRAINT fk_episodes_show FOREIGN KEY (show_id) REFERENCES shows (id) ON DELETE CASCADE;
-- @optional
ALTER TABLE favorites ADD CONSTRAINT fk_favorites_show FOREIGN KEY (show_id) REFERENCES shows (id) ON DELETE CASCADE;
-- @optional
ALTER TABLE comments ADD CONSTRAINT fk_comments_show FOREIGN KEY (show_id) REFERENCES shows (id) ON DELETE CASCADE;
