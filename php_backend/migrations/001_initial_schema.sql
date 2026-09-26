-- KuraStream Migration 001: Initial Schema
-- Baseline tables for users, user_profiles, shows, episodes, watch_history, user_preferences, favorites, staged_imports, and comments

CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(255) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_profiles (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar VARCHAR(500) DEFAULT '',
    color VARCHAR(50) DEFAULT '#a855f7',
    is_kids TINYINT(1) DEFAULT 0,
    pin VARCHAR(255) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_profiles (username),
    UNIQUE KEY uniq_user_profile_name (username, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shows (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    synopsis TEXT,
    rating DOUBLE DEFAULT 0.0,
    year INT NULL,
    studio VARCHAR(255) DEFAULT '',
    director VARCHAR(255) DEFAULT '',
    writer VARCHAR(255) DEFAULT '',
    cast_members LONGTEXT,
    poster_path VARCHAR(500) DEFAULT '',
    backdrop_path VARCHAR(500) DEFAULT '',
    media_type VARCHAR(50) NOT NULL DEFAULT 'anime',
    backdrop_loops LONGTEXT,
    genres VARCHAR(500) DEFAULT '',
    trailer_key VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    age_rating VARCHAR(50) DEFAULT 'TV-14',
    status VARCHAR(50) DEFAULT 'finished'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS episodes (
    id VARCHAR(255) PRIMARY KEY,
    show_id VARCHAR(255) NOT NULL,
    season_number INT NOT NULL,
    episode_number INT NOT NULL,
    title VARCHAR(255) DEFAULT '',
    synopsis TEXT,
    filepath VARCHAR(500) NOT NULL,
    duration DOUBLE DEFAULT 0,
    size BIGINT DEFAULT 0,
    video_codec VARCHAR(100) DEFAULT '',
    resolution VARCHAR(100) DEFAULT '',
    fps DOUBLE DEFAULT 0,
    audio_tracks LONGTEXT,
    subtitle_tracks LONGTEXT,
    thumbnail_path VARCHAR(500) DEFAULT '',
    intro_start INT NULL,
    intro_end INT NULL,
    outro_start INT NULL,
    chapters LONGTEXT NULL,
    INDEX idx_episodes_show (show_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_preferences (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    auto_skip_intro TINYINT(1) DEFAULT 0,
    auto_play_next TINYINT(1) DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS watch_history (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    episode_id VARCHAR(255) NOT NULL,
    progress_seconds DOUBLE NOT NULL DEFAULT 0,
    duration DOUBLE NOT NULL DEFAULT 0,
    completed TINYINT(1) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name, episode_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS favorites (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    show_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name, show_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staged_imports (
    id VARCHAR(255) PRIMARY KEY,
    original_filename VARCHAR(500) NOT NULL,
    filepath VARCHAR(500) NOT NULL,
    media_type VARCHAR(50) DEFAULT 'anime',
    clean_title VARCHAR(255) DEFAULT '',
    season INT DEFAULT 1,
    episode INT DEFAULT 1,
    filesize BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(255) PRIMARY KEY,
    show_id VARCHAR(255) NOT NULL,
    episode_id VARCHAR(255) DEFAULT '',
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_comments_show (show_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
