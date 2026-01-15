# Base Image: Node.js 20 on Alpine Linux (small & secure)
FROM node:20-alpine AS base

# Install necessary system tools for backups
# mysql-client -> mysqldump
# postgresql-client -> pg_dump
# mongodb-tools -> mongodump
RUN apk add --no-cache \
    mysql-client \
    postgresql-client \
    mongodb-tools \
    openssl \
    zip

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

# Generate Prisma Client and build Next.js app
RUN npx prisma generate
RUN npm run build

# 3. Runner Phase (The actual image)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
