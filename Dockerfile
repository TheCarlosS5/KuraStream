FROM node:22-bookworm-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (only production if package.json has dependencies)
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["node", "--env-file=.env", "backend/server.js"]
