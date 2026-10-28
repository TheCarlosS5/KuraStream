# nginx in front of PHP-FPM: serves the web app and media files, hands /api/* to the FPM pools.
# The library is bind-mounted read-only by docker-compose.yml.

# Stage 1: the production build of the web app (hashed, minified bundles in frontend/dist)
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend frontend
COPY scripts/build.mjs scripts/build.mjs
RUN node scripts/build.mjs

# Stage 2: nginx
FROM nginx:1.27-alpine
COPY deploy/nginx/kurastream.conf.template /etc/nginx/templates/default.conf.template
COPY deploy /app/deploy
COPY --from=web /src/frontend /app/frontend
# Only KURA_* variables are substituted into the template (nginx's own $variables stay as they are).
ENV NGINX_ENVSUBST_FILTER=^KURA_ \
    KURA_PORT=80 \
    KURA_APP_DIR=/app \
    KURA_LIBRARY_DIR=/app/library \
    KURA_API_UPSTREAM=app:9000 \
    KURA_STREAM_UPSTREAM=app:9001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1
