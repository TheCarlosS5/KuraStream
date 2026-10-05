-- KuraStream Migration 011: end of the ending credits
-- Many anime have a scene after the ending; knowing where the credits stop lets the players skip
-- just the credits instead of jumping to the next episode over that scene.
ALTER TABLE episodes
    ADD COLUMN outro_end INT NULL DEFAULT NULL;
