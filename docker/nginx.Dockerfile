# nginx in front of PHP-FPM: serves the web app and media files, hands /api/* to the FPM pools.
# The library is bind-mounted read-only by docker-compose.yml.
FROM nginx:1.27-alpine
COPY deploy/nginx/kurastream.conf.template /etc/nginx/templates/default.conf.template
COPY deploy /app/deploy
COPY frontend /app/frontend
# Only KURA_* variables are substituted into the template (nginx's own $variables stay as they are).
ENV NGINX_ENVSUBST_FILTER=^KURA_ \
    KURA_PORT=80 \
    KURA_APP_DIR=/app \
    KURA_LIBRARY_DIR=/app/library \
    KURA_API_UPSTREAM=app:9000 \
    KURA_STREAM_UPSTREAM=app:9001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1
