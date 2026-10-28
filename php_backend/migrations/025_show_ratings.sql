-- KuraStream Migration 025: personal 1-5 ratings per profile (they steer "Porque viste ...")
CREATE TABLE IF NOT EXISTS show_ratings (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    show_id VARCHAR(255) NOT NULL,
    rating TINYINT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name, show_id),
    INDEX idx_show_ratings_show (show_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
