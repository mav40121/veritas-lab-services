# VeritaAssure production Dockerfile
# Chromium dependencies are installed in a cached layer so builds
# never time out waiting on Ubuntu mirror downloads.

FROM node:20-slim AS base

# Install Chromium dependencies (required by Puppeteer)
# This layer is cached and only re-runs if the Dockerfile changes.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for dependency caching
COPY package.json package-lock.json ./

# Install all dependencies (including Puppeteer's Chromium binary)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port (Railway assigns PORT dynamically)
EXPOSE ${PORT:-3000}

# Start the server
CMD ["node", "dist/index.cjs"]
