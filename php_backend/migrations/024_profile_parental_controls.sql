-- KuraStream Migration 024: parental controls per profile
-- max_rating: highest age rating the profile may open (G, PG, PG-13); NULL = no cap beyond the kids switch.
-- daily_limit_minutes: screen time per day; NULL = unlimited. Time is counted from the progress saves the players send.
ALTER TABLE user_profiles
    ADD COLUMN max_rating VARCHAR(8) NULL DEFAULT NULL,
    ADD COLUMN daily_limit_minutes INT NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS profile_watch_time (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL,
    day DATE NOT NULL,
    seconds INT NOT NULL DEFAULT 0,
    last_ping DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (username, profile_name, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
