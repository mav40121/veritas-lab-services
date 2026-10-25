# VeritaAssure production Dockerfile
# Chromium dependencies are installed in a cached layer so builds
# never time out waiting on Ubuntu mirror downloads.

# Base image from AWS's public mirror of Docker Official Images (same image as
# docker.io/library/node:22-slim; Node 20 left support April 2026). 2026-10-09: two Railway builds of #1571 failed
# with "429 Too Many Requests" pulling node:20-slim from Docker Hub.
FROM public.ecr.aws/docker/library/node:22-slim AS base

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

# Litestream: continuous backup of the SQLite database to R2 (server/continuousBackup.ts). Pinned release,
# checksum-verified from the release's checksums.txt; its own layer so it is cached between builds.
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256=a191a0928884d1820fab1f866ede1d0d5811c323d0587bf863a43481a82a7668
RUN wget -q -O /tmp/litestream.deb "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.deb" \
  && echo "${LITESTREAM_SHA256}  /tmp/litestream.deb" | sha256sum -c - \
  && dpkg -i /tmp/litestream.deb \
  && rm /tmp/litestream.deb \
  && litestream version

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
