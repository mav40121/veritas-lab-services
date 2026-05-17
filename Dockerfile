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

# Install all dependencies (including Puppeteer's Chromium binary).
# Using `npm install` instead of `npm ci` so deploys aren't blocked when
# the operator adds a new dependency to package.json without being able
# to regenerate package-lock.json locally (no local node toolchain). The
# trade-off: minor/patch versions of unrelated transitive deps may drift
# between deploys. Acceptable for this stage; revisit if reproducibility
# becomes a concern.
RUN npm install --no-audit --no-fund

# Copy source code
COPY . .

# Vite bakes VITE_* vars into the client bundle at build time. Railway exposes
# service env vars to Docker builds only via build args, so the Dockerfile must
# ARG them explicitly — otherwise the bundle ships without them and the
# corresponding client features (e.g. Sentry) silently no-op in production.
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# Build the application
RUN npm run build

# Expose port (Railway assigns PORT dynamically)
EXPOSE ${PORT:-3000}

# Start the server
CMD ["node", "dist/index.cjs"]
