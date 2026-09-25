-- KuraStream Migration 001: Initial Schema
-- Baseline tables for users, shows, episodes, profiles, history, and comments

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shows (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    type VARCHAR(50) DEFAULT 'anime',
    status VARCHAR(50) DEFAULT 'finished',
    overview TEXT,
    poster_image VARCHAR(500),
    cover_image VARCHAR(500),
    rating FLOAT DEFAULT 0.0,
    year INT DEFAULT 0,
    genres TEXT,
    is_adult TINYINT(1) DEFAULT 0,
    rating_mpaa VARCHAR(50) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shows_type (type),
    INDEX idx_shows_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS episodes (
    id VARCHAR(255) PRIMARY KEY,
    show_id VARCHAR(255) NOT NULL,
    season_number INT DEFAULT 1,
    episode_number INT DEFAULT 1,
    title VARCHAR(500),
    filepath VARCHAR(1000) NOT NULL,
    duration FLOAT DEFAULT 0.0,
    video_codec VARCHAR(50),
    audio_codec VARCHAR(50),
    audio_tracks TEXT,
    subtitle_tracks TEXT,
    timestamps TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_episodes_show (show_id),
    INDEX idx_episodes_season_ep (show_id, season_number, episode_number)
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
    INDEX idx_user_profiles (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS watch_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    episode_id VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    progress FLOAT DEFAULT 0.0,
    duration FLOAT DEFAULT 0.0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_ep_prof (user_id, episode_id, profile_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(255) PRIMARY KEY,
    show_id VARCHAR(255) NOT NULL,
    episode_id VARCHAR(255) DEFAULT '',
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_comments_show (show_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staged_imports (
    id VARCHAR(255) PRIMARY KEY,
    filepath VARCHAR(1000) NOT NULL,
    original_filename VARCHAR(500) NOT NULL,
    clean_title VARCHAR(500),
    season_number INT DEFAULT 1,
    episode_number INT DEFAULT 1,
    media_type VARCHAR(50) DEFAULT 'anime',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
