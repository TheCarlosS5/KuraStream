-- KuraStream Migration 010: Per-season artwork/metadata and where intro timings came from
-- A show stays one catalogue entry; each of its seasons gets its own poster, banner, synopsis and
-- the MyAnimeList entries its episodes belong to (TMDB seasons often span several MAL entries).
CREATE TABLE IF NOT EXISTS show_seasons (
    show_id VARCHAR(255) NOT NULL,
    season_number INT NOT NULL,
    name VARCHAR(255) DEFAULT '',
    title VARCHAR(255) DEFAULT '',
    synopsis TEXT,
    year INT NULL,
    air_date DATE NULL,
    episode_count INT NULL,
    status VARCHAR(50) NULL,
    poster_path VARCHAR(500) DEFAULT '',
    backdrop_path VARCHAR(500) DEFAULT '',
    anilist_id INT NULL,
    mal_id INT NULL,
    mal_map LONGTEXT NULL,
    synced_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (show_id, season_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- intro_source: manual | chapters | aniskip | aniskip_none (looked up, nothing found yet)
ALTER TABLE episodes
    ADD COLUMN intro_source VARCHAR(32) NULL DEFAULT NULL,
    ADD COLUMN intro_checked_at TIMESTAMP NULL DEFAULT NULL;
