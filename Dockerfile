# Base Image: Node.js 20 on Alpine Linux (small & secure)
FROM node:20-alpine AS base

# Install necessary system tools for backups
# mysql-client -> mysqldump
# postgresql-client -> pg_dump (latest version, currently 18)
# mongodb-tools -> mongodump
# redis -> redis-cli (for Redis backups)
# samba-client -> smbclient (for SMB/CIFS storage)
# Strategic PostgreSQL versions: 14, 16, 18 (covers 12-18 via backward compatibility)
# PostgreSQL Versions Strategy:
# - pg_dump 14 (from Alpine 3.17 repo) -> handles PG 12, 13, 14
# - pg_dump 16 (from Alpine 3.23 repo) -> handles PG 15, 16
# - pg_dump 18 (latest, from Alpine 3.23) -> handles PG 17, 18

RUN echo 'http://dl-cdn.alpinelinux.org/alpine/v3.17/main' >> /etc/apk/repositories && \
    apk update && \
    apk add --no-cache \
    mysql-client \
    postgresql-client \
    postgresql14-client \
    postgresql16-client \
    mongodb-tools \
    redis \
    samba-client \
    openssl \
    zip \
    su-exec

# Create symlinks for strategic PostgreSQL binaries
# Alpine provides postgresql14-client (v3.17), postgresql16-client (v3.23)
# postgresql-client provides latest (18)
RUN mkdir -p /opt/pg14/bin /opt/pg16/bin /opt/pg18/bin && \
    ln -sf /usr/libexec/postgresql14/pg_dump /opt/pg14/bin/pg_dump && \
    ln -sf /usr/libexec/postgresql14/pg_restore /opt/pg14/bin/pg_restore && \
    ln -sf /usr/libexec/postgresql14/psql /opt/pg14/bin/psql && \
    ln -sf /usr/libexec/postgresql16/pg_dump /opt/pg16/bin/pg_dump && \
    ln -sf /usr/libexec/postgresql16/pg_restore /opt/pg16/bin/pg_restore && \
    ln -sf /usr/libexec/postgresql16/psql /opt/pg16/bin/psql && \
    ln -sf /usr/bin/pg_dump /opt/pg18/bin/pg_dump && \
    ln -sf /usr/bin/pg_restore /opt/pg18/bin/pg_restore && \
    ln -sf /usr/bin/psql /opt/pg18/bin/psql || true

# 1. Install Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
# Install pnpm if needed or use corepack
RUN corepack enable && corepack prepare pnpm@latest --activate
# Using --no-frozen-lockfile because of pnpm version mismatch (lockfile ignored by --force)
# We regenerate the lockfile during build
RUN pnpm install --no-frozen-lockfile

# 2. Builder Phase
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Generate Prisma Client and build Next.js app
RUN npx prisma generate
RUN npm run build

# 3. Runner Phase (The actual image)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Default environment variables (can be overridden at runtime)
ENV DATABASE_URL="file:/app/db/dbackup.db"
ENV TZ="UTC"
ENV LOG_LEVEL="info"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built files
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy Prisma Schema for runtime access (if needed) or migrations
COPY --from=builder /app/prisma ./prisma

# Permissions for backup folder (optional, if stored locally)
# Also prepare storage folder for avatars
# Explicitly create db folder for SQLite persistence
RUN mkdir -p /backups /app/storage/avatars /app/db && \
    chown -R nextjs:nodejs /backups /app/storage /app/db

# Install Prisma globally to run migrations at startup
RUN npm install -g prisma@5

# User nextjs removed to allow permission fix at runtime

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Fix permissions for volumes, then switch to nextjs user to run app
CMD ["/bin/sh", "-c", "mkdir -p /app/db /app/storage /backups && chown -R nextjs:nodejs /app/db /app/storage /backups && su-exec nextjs:nodejs /bin/sh -c 'prisma migrate deploy && node server.js'"]
