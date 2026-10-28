-- KuraStream Migration 017: pixel format and bit depth of the video stream
-- Hi10P (10-bit H.264) is common in fansubs and is passed through by a plain stream copy, but browsers and most
-- phones cannot decode it. Knowing the bit depth lets the server transcode exactly those files.
ALTER TABLE episodes
    ADD COLUMN pix_fmt VARCHAR(32) NULL DEFAULT NULL,
    ADD COLUMN bit_depth TINYINT NULL DEFAULT NULL;
