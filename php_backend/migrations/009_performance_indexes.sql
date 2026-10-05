-- KuraStream Migration 009: Indexes for the hottest read paths
-- /api/shows/{id}: episodes of a show ordered by season/episode (avoids a filesort per request)
ALTER TABLE episodes
    ADD INDEX idx_episodes_show_order (show_id, season_number, episode_number);

-- /api/history and Continue Watching: a profile's history newest first
ALTER TABLE watch_history
    ADD INDEX idx_watch_history_recent (username, profile_name, updated_at);
