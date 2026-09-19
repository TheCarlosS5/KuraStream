FROM php:8.4-cli-bookworm

# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libcurl4-openssl-dev libonig-dev \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_mysql mbstring curl

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Set environment defaults
ENV PORT=3000

# Start server
CMD ["sh", "-c", "php -r 'require \"php_backend/db.php\"; Database::initializeSchema();' && exec php -S 0.0.0.0:${PORT} php_backend/router.php"]
