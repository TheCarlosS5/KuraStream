FROM php:8.4-cli-bookworm

# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libcurl4-openssl-dev libonig-dev \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_mysql mbstring curl

# Set working directory
WORKDIR /app

# Create unprivileged application user
RUN groupadd -r kurastream && useradd -r -g kurastream -d /app -s /sbin/nologin kurastream

# Copy application files
COPY --chown=kurastream:kurastream . .

# Ensure storage directories exist with correct permissions
RUN mkdir -p /app/library /tmp/kura_ratelimits /tmp/kura_subs_cache /tmp/kura_transcode_slots \
    && chown -R kurastream:kurastream /app /tmp/kura_* 2>/dev/null || true \
    && cp /app/php.ini $PHP_INI_DIR/conf.d/kurastream.ini

USER kurastream

# Expose server port
EXPOSE 3000

# Set environment defaults
ENV PORT=3000

# Start server
CMD ["sh", "-c", "php -r 'require \"php_backend/db.php\"; Database::initializeSchema();' && exec php -S 0.0.0.0:${PORT} php_backend/router.php"]
