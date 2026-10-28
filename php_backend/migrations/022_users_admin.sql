-- KuraStream Migration 022: account administration
-- `disabled` lets an administrator lock an account out without deleting its data (sessions stop working at once,
-- see AuthMiddleware::sessionPayload). `last_login_at` shows who is still using the server.
ALTER TABLE users
    ADD COLUMN disabled TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN last_login_at DATETIME NULL DEFAULT NULL;
