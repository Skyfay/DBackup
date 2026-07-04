# Base Image: Node.js 24 on Debian Slim (bookworm)
FROM node:24-slim AS base

# Install system tools for database backups
# mariadb-client (Debian 12)       -> mysql, mysqldump, mariadb, mariadb-dump (libmariadb3 3.3.x supports caching_sha2_password)
# postgresql-client-18 (PGDG)      -> pg_dump, pg_restore, psql (backward compatible with PG 12-18)
# mongodb-database-tools (CDN)     -> mongodump, mongorestore (direct download - APT repo has no arm64 builds for Debian 12;
#                                    MongoDB only ships debian12 x86_64 packages; arm64 uses ubuntu2204 package)
# redis-tools                      -> redis-cli (for Redis backups)
# smbclient                        -> SMB/CIFS storage
# sqlite3                          -> SQLite backups
# gosu                             -> privilege dropping (replaces Alpine su-exec)

# Step 1: Install prerequisites for adding external APT repositories
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Step 2: Configure external APT repositories
RUN \
    # PGDG: PostgreSQL 18 client
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg && \
    echo "deb [signed-by=/etc/apt/trusted.gpg.d/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list

# Step 3: Install backup tools
# mariadb-client on Debian 12 ships with libmariadb3 3.3.x, which supports caching_sha2_password natively.
# It also provides mysql/mysqldump/mysqladmin as compatibility symlinks.
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    mariadb-client \
    postgresql-client-18 \
    redis-tools \
    smbclient \
    lz4 \
    zstd \
    rsync \
    sshpass \
    openssh-client \
    openssl \
    curl \
    zip \
    sqlite3 \
    gosu && \
    # Step 4: MongoDB database tools - direct CDN download for multi-arch support
    # MongoDB ships debian12 packages for x86_64 only; arm64 uses the ubuntu2204 build (compatible on Debian bookworm)
    case "${TARGETARCH:-amd64}" in \
        amd64) MONGO_DEB="mongodb-database-tools-debian12-x86_64-100.16.1.deb" ;; \
        arm64) MONGO_DEB="mongodb-database-tools-ubuntu2204-arm64-100.16.1.deb" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
    esac && \
    curl -fsSL "https://fastdl.mongodb.org/tools/db/${MONGO_DEB}" -o /tmp/mongo-tools.deb && \
    apt-get install -y --no-install-recommends /tmp/mongo-tools.deb && \
    rm /tmp/mongo-tools.deb && \
    rm -rf /var/lib/apt/lists/*

# Step 5: Firebird 5.x client tools (gbak, isql) for the Firebird adapter.
# Debian 12's apt repos only carry a 3.0 client, not 5.x, and the 5.x gbak/isql
# can talk to 3.x/4.x servers over the wire protocol - so download the official
# Firebird release tarball and extract just the client binaries + shared library.
#
# Verified against the actual GitHub release assets (2026-07-04):
# - Release tag (v${FIREBIRD_RELEASE_TAG}) and asset filename version
#   (${FIREBIRD_ASSET_VERSION}) differ - assets embed a build number, e.g.
#   "Firebird-5.0.3.1683-0-linux-x64.tar.gz" for tag "v5.0.3". Bump both when
#   upgrading.
# - The top-level tarball only contains an install.sh + a nested
#   buildroot.tar.gz - the actual bin/lib payload lives at
#   buildroot.tar.gz:./opt/firebird/{bin,lib}, not at the tarball root.
# - gbak/isql depend on libtommath.so.1 and gbak also needs libz.so.1, neither
#   of which ship inside buildroot.tar.gz - installed via apt below.
#   libicuuc/libicui18n are dlopen'd at runtime for extended collations only
#   (soft dependency) - omitted here since backup/restore doesn't need them.
ARG FIREBIRD_RELEASE_TAG=5.0.3
ARG FIREBIRD_ASSET_VERSION=5.0.3.1683-0
RUN apt-get update && apt-get install -y --no-install-recommends \
    libtommath1 \
    zlib1g && \
    rm -rf /var/lib/apt/lists/* && \
    case "${TARGETARCH:-amd64}" in \
        amd64) FB_ARCH="x64" ;; \
        arm64) FB_ARCH="arm64" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/FirebirdSQL/firebird/releases/download/v${FIREBIRD_RELEASE_TAG}/Firebird-${FIREBIRD_ASSET_VERSION}-linux-${FB_ARCH}.tar.gz" -o /tmp/firebird.tar.gz && \
    mkdir -p /tmp/firebird-extract && \
    tar -xzf /tmp/firebird.tar.gz -C /tmp/firebird-extract --strip-components=1 && \
    tar -xzf /tmp/firebird-extract/buildroot.tar.gz -C /tmp/firebird-extract && \
    mkdir -p /opt/firebird/bin /opt/firebird/lib && \
    cp /tmp/firebird-extract/opt/firebird/bin/gbak /opt/firebird/bin/ && \
    cp /tmp/firebird-extract/opt/firebird/bin/isql /opt/firebird/bin/ && \
    cp -a /tmp/firebird-extract/opt/firebird/lib/. /opt/firebird/lib/ && \
    cp /tmp/firebird-extract/opt/firebird/firebird.msg /opt/firebird/ && \
    ln -sf /opt/firebird/bin/gbak /usr/local/bin/gbak && \
    ln -sf /opt/firebird/bin/isql /usr/local/bin/isql && \
    echo "/opt/firebird/lib" > /etc/ld.so.conf.d/firebird.conf && \
    ldconfig && \
    rm -rf /tmp/firebird.tar.gz /tmp/firebird-extract

# Enable corepack for pnpm support and symlink PostgreSQL 18 binaries
# On Debian with PGDG, pg binaries live under /usr/lib/postgresql/18/bin/
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate && \
    ln -sf /usr/lib/postgresql/18/bin/pg_dump /usr/local/bin/pg_dump && \
    ln -sf /usr/lib/postgresql/18/bin/pg_restore /usr/local/bin/pg_restore && \
    ln -sf /usr/lib/postgresql/18/bin/psql /usr/local/bin/psql

# Validate pg_dump version resolves correctly (fail-fast on broken symlinks/packages)
RUN pg_dump --version | grep -q 'PostgreSQL) 18\.' || \
    (echo "ERROR: pg_dump version validation failed! Check PostgreSQL 18 client package." && exit 1)

# 1. Install Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 2. Builder Phase
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Generate Prisma Client, build Next.js app, and compile custom server
# --mount=type=cache persists the Next.js incremental build cache (.next/cache)
# across Docker builds via GitHub Actions cache (type=gha,mode=max in release.yml).
# Next.js reuses webpack/SWC artefacts for unchanged modules, cutting rebuild time significantly.
RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm prisma generate && pnpm run build && npx tsc -p tsconfig.server.json

# 3. Runner Phase (The actual image)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Default environment variables (can be overridden at runtime)
ENV DATABASE_URL="file:/data/db/dbackup.db"
ENV TZ="UTC"
ENV LOG_LEVEL="info"
ENV PUID=1001
ENV PGID=1001

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

# Copy built files (--link for better layer caching)
COPY --from=builder --link --chown=1001:1001 /app/public ./public
COPY --from=builder --link --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --link --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=builder --link --chown=1001:1001 /app/prisma ./prisma

# Create runtime data directory + install Prisma CLI for migrations
# Note: pnpm add -g runs as root, so we must chown /pnpm to the runtime user
# to avoid "Can't write to @prisma/engines" errors at container startup
# Prisma version is read from package.json to stay in sync automatically
COPY --from=builder --link /app/package.json /tmp/package.json
RUN mkdir -p /data/storage/avatars /data/db /data/certs && \
    chown -R 1001:1001 /data && \
    PRISMA_VERSION=$(node -e "console.log(require('/tmp/package.json').devDependencies.prisma.replace(/[\^~>=<]/g,''))") && \
    pnpm add -g prisma@${PRISMA_VERSION} && \
    rm /tmp/package.json && \
    chown -R 1001:1001 /pnpm

# Copy compiled custom HTTPS server (replaces default Next.js server entry point)
COPY --from=builder --link --chown=1001:1001 /app/custom-server.js ./custom-server.js

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Health check: verify app + database are reachable
# Uses --insecure for self-signed certs; falls back to http if DISABLE_HTTPS=true
# PORT env var is respected - defaults to 3000 if not set
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -fk https://localhost:${PORT:-3000}/api/health 2>/dev/null || curl -f http://localhost:${PORT:-3000}/api/health || exit 1

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DISABLE_HTTPS="false"
ENV DATA_DIR="/data"

ENTRYPOINT ["docker-entrypoint.sh"]
