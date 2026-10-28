#!/bin/sh
# Applies pending database migrations (idempotent, guarded by a database lock), then starts the given command.
set -e
cd /app
if ! php -r 'require "php_backend/db.php"; $r = Database::initializeSchema(); fwrite(STDERR, "migrations: " . json_encode($r) . PHP_EOL); exit(!empty($r["success"]) ? 0 : 1);'; then
    echo "WARNING: the database schema could not be initialized; /api/health will report it." >&2
fi
exec "$@"
