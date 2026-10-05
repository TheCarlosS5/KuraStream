-- KuraStream Migration 012: where the ending timings came from, tracked apart from the opening
-- An opening corrected by audio and an ending taken from AniSkip are different decisions; one
-- shared source column made the ending of every audio-checked episode impossible to fill.
-- outro_source: manual | chapters | aniskip | aniskip_checked | audio | aniskip_none | none
ALTER TABLE episodes
    ADD COLUMN outro_source VARCHAR(32) NULL DEFAULT NULL,
    ADD COLUMN outro_checked_at TIMESTAMP NULL DEFAULT NULL;
