-- KuraStream Migration 007: Multimedia User Preferences
-- Adds preferred audio and subtitle languages, audio boost level, and equalizer preset

ALTER TABLE user_preferences
    ADD COLUMN preferred_audio_language VARCHAR(50) NOT NULL DEFAULT 'jpn',
    ADD COLUMN preferred_subtitle_language VARCHAR(50) NOT NULL DEFAULT 'spa',
    ADD COLUMN audio_boost INT NOT NULL DEFAULT 100,
    ADD COLUMN audio_preset VARCHAR(50) NOT NULL DEFAULT 'flat';
