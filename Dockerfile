# KuraStream application image: PHP-FPM (two pools, see deploy/php-fpm) + the background worker.
# nginx has its own image (docker/nginx.Dockerfile). Everything is wired together by docker-compose.yml.
FROM php:8.5-fpm-bookworm

# ffmpeg for scans/remux/subtitles, mariadb-client for the database backups the worker makes
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libcurl4-openssl-dev libonig-dev mariadb-client \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_mysql mbstring curl opcache

# Unprivileged application user. Its numeric id should match the owner of ./library on the host (the app writes
# posters and imported episodes there): docker compose build --build-arg APP_UID=$(id -u) ...  (KURA_UID in .env)
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd -g ${APP_GID} kurastream && useradd -u ${APP_UID} -g kurastream -d /app -s /usr/sbin/nologin kurastream

WORKDIR /app
COPY --chown=kurastream:kurastream . .

# PHP settings, and the two FPM pools rendered from the same templates the Debian installer uses.
# The pools listen on TCP (9000 = api, 9001 = stream) inside the compose network only.
RUN cp docker/php.ini $PHP_INI_DIR/conf.d/zz-kurastream.ini \
    && rm -f /usr/local/etc/php-fpm.d/*.conf \
    && cp docker/php-fpm-global.conf /usr/local/etc/php-fpm.d/00-global.conf \
    && export KURA_USER=kurastream KURA_GROUP=kurastream KURA_WEB_USER=kurastream KURA_WEB_GROUP=kurastream \
              KURA_API_LISTEN=9000 KURA_STREAM_LISTEN=9001 KURA_PHP_ERROR_LOG=/proc/self/fd/2 \
    && bash scripts/render_deploy.sh deploy/php-fpm/kurastream-api.conf.template > /usr/local/etc/php-fpm.d/10-api.conf \
    && bash scripts/render_deploy.sh deploy/php-fpm/kurastream-stream.conf.template > /usr/local/etc/php-fpm.d/20-stream.conf \
    && chmod +x docker/entrypoint.sh \
    && mkdir -p /app/library /var/cache/kurastream/subtitles /backups /tmp/kura_transcode_slots \
    && chown -R kurastream:kurastream /app/library /var/cache/kurastream /backups /tmp/kura_transcode_slots

ENV SUBTITLE_CACHE_DIR=/var/cache/kurastream/subtitles \
    BACKUP_DIR=/backups \
    MEDIA_LIBRARY_PATH=/app/library

EXPOSE 9000 9001
ENTRYPOINT ["/app/docker/entrypoint.sh"]
# The FPM master runs as root and drops each pool to the kurastream user; the worker overrides this command and
# runs as kurastream directly (compose: user + command).
CMD ["php-fpm", "--nodaemonize"]
