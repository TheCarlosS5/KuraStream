-- KuraStream Migration 008: Persist the in-app notifications toggle from the settings view

ALTER TABLE user_preferences
    ADD COLUMN notifications_enabled TINYINT(1) NOT NULL DEFAULT 1;
