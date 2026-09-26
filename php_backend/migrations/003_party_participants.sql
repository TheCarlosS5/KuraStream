-- KuraStream Migration 003: Party Members Tracking Table
-- Track active participants per Watch Party room for accurate presence and secure guest tokens

CREATE TABLE IF NOT EXISTS party_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(64) NOT NULL,
    member_id VARCHAR(64) NULL,
    username VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NULL,
    role VARCHAR(32) DEFAULT 'guest',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_party_members_room (room_id),
    INDEX idx_party_members_token (token_hash),
    UNIQUE KEY uniq_room_user (room_id, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
