-- KuraStream Migration 014: Watch Party rooms admit guests without an account only when the host allows it
ALTER TABLE party_rooms
    ADD COLUMN allow_guests TINYINT(1) NOT NULL DEFAULT 0;
