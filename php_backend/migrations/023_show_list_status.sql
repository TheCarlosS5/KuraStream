-- KuraStream Migration 023: watch-list status per profile (watching / planned / completed / dropped)
CREATE TABLE IF NOT EXISTS show_list_status (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    show_id VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name, show_id),
    INDEX idx_show_list_status_show (show_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
