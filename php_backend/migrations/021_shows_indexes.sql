-- KuraStream Migration 021: indexes for the catalogue queries
-- findShowByFolderOrTitle now matches exact titles (index lookup) instead of LOWER(title) scans, and the catalogue
-- list filters by media type and status.
ALTER TABLE shows
    ADD INDEX idx_shows_title (title(191)),
    ADD INDEX idx_shows_type_status (media_type, status);
