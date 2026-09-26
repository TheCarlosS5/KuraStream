-- KuraStream Migration 002: Watch Party Rooms and Messages
-- Establishes watch party rooms and persistent chat messages

CREATE TABLE IF NOT EXISTS party_rooms (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) DEFAULT '',
    host_user VARCHAR(64) NOT NULL,
    episode_id VARCHAR(255) NOT NULL,
    is_playing TINYINT(1) DEFAULT 0,
    `current_time` DOUBLE DEFAULT 0,
    last_sync_timestamp BIGINT NOT NULL DEFAULT 0,
    is_public TINYINT(1) DEFAULT 0,
    allow_guest_controls TINYINT(1) DEFAULT 0,
    participants_count INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_party_rooms_public (is_public),
    INDEX idx_party_rooms_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS party_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(64) NOT NULL,
    username VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(32) DEFAULT 'chat',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_party_messages_room (room_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
