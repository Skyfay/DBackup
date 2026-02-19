# Installation

This guide covers all installation methods for DBackup.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+ (recommended)

::: tip Multi-Architecture Support
DBackup images are available for **AMD64** (x86_64) and **ARM64** (aarch64) architectures.

Supports: Intel/AMD servers, Raspberry Pi 4+, Apple Silicon (M1/M2/M3), AWS Graviton
:::

## Docker Installation

::: code-group

```yaml [Docker Compose (Recommended)]
# docker-compose.yml
services:
  dbackup:
    image: skyfay/dbackup:beta
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=http://localhost:3000
      # - TZ=Europe/Zurich  # Optional: Server timezone
    volumes:
      - ./backups:/backups      # Local backup storage
      - ./db:/app/db            # SQLite database
      - ./storage:/app/storage  # Uploads & avatars
```

```bash [Docker Run]
docker run -d \
  --name dbackup \
  --restart always \
  -p 3000:3000 \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  -v "$(pwd)/backups:/backups" \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/storage:/app/storage" \
  skyfay/dbackup:beta
```

:::

### Generate Secrets

Before starting with Docker Compose, generate the required secrets:

```bash
# Generate ENCRYPTION_KEY (32 bytes as hex = 64 characters)
openssl rand -hex 32

# Generate BETTER_AUTH_SECRET
openssl rand -base64 32
```

Create a `.env` file next to your `docker-compose.yml`:

```bash
ENCRYPTION_KEY=your-64-character-hex-key-here
BETTER_AUTH_SECRET=your-base64-secret-here
```

### Start & Access

```bash
docker-compose up -d
```

Access the application at [http://localhost:3000](http://localhost:3000).

## Docker Run

For quick testing, you can use `docker run`:

```bash
docker run -d \
  --name dbackup \
  --restart always \
  -p 3000:3000 \
  -e DATABASE_URL="file:/app/db/prod.db" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  -v "$(pwd)/backups:/backups" \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/storage:/app/storage" \
  skyfay/dbackup:beta
```

## Environment Variables

| Variable | Required | Description |
| :--- | :---: | :--- |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex string (64 chars) for encrypting credentials at rest. |
| `BETTER_AUTH_SECRET` | ✅ | Base64 secret for authentication sessions. |
| `BETTER_AUTH_URL` | ✅ | **Primary** URL where users access DBackup (for auth redirects). |
| `TRUSTED_ORIGINS` | ❌ | Additional access URLs, comma-separated (see below). |
| `PORT` | ❌ | Internal server port. Default: `3000` |
| `DATABASE_URL` | ❌ | SQLite path. Default: `file:/app/db/dbackup.db` |
| `TZ` | ❌ | Server timezone for logs. Default: `UTC` |
| `TMPDIR` | ❌ | Temp directory for large backups. Default: `/tmp` |
| `LOG_LEVEL` | ❌ | Logging verbosity: `debug`, `info`, `warn`, `error`. Default: `info` |

→ **[Full Environment Reference](/developer-guide/reference/environment)** for advanced configuration.

::: tip Multiple Access URLs
If DBackup is accessible via both IP and domain (e.g., reverse proxy), use `TRUSTED_ORIGINS`:
```yaml
environment:
  - BETTER_AUTH_URL=https://backup.example.com       # Primary URL
  - TRUSTED_ORIGINS=https://192.168.1.10:3000,http://localhost:3000
```
:::

::: danger Critical Security Note
**Never lose your `ENCRYPTION_KEY`!** This key encrypts all stored credentials (database passwords, API keys). If lost, you cannot decrypt existing configurations.

Store it securely in a password manager or secrets vault.
:::

## Volume Mounts

| Mount Point | Purpose |
| :--- | :--- |
| `/backups` | Default path for local backup storage |
| `/app/db` | SQLite database persistence |
| `/app/storage` | User uploads (avatars, etc.) |

## Health Check

DBackup includes a built-in Docker health check that verifies both the application and database are running:

```bash
# Check container health status
docker ps
# CONTAINER ID  IMAGE             STATUS                 PORTS
# abc123        skyfay/dbackup    Up 5m (healthy)        0.0.0.0:3000->3000/tcp

# Manual health check
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "healthy",
  "uptime": 300,
  "database": "connected",
  "memory": { "rss": 120, "heapUsed": 65, "heapTotal": 90 },
  "responseTime": 5
}
```

The health check runs every 30 seconds with a 30-second start period. Docker will mark the container as `unhealthy` if 3 consecutive checks fail.

## Graceful Shutdown

When stopping the container, DBackup **waits for all running backup/restore jobs to finish** before shutting down — no data is lost, regardless of how long the backup takes:

```bash
docker stop dbackup          # Sends SIGTERM → waits for running backups to finish
docker compose down           # Same graceful behavior
```

- **Running jobs** are always completed before the process exits
- **Pending jobs** in the queue are cancelled and marked as `Failed`
- The scheduler is stopped immediately (no new cron triggers)
- A second `Ctrl+C` / `docker kill` forces immediate exit for emergencies

::: warning Docker Stop Timeout
By default, Docker sends a `SIGKILL` **10 seconds** after `docker stop` — this forcefully kills the process regardless of what it's doing. Since `SIGKILL` cannot be caught by any application, you **must** increase the timeout if your backups take longer than 10 seconds.

**Docker Compose** (recommended — add to your `docker-compose.yml`):
```yaml
services:
  dbackup:
    stop_grace_period: 10m   # Wait up to 10 minutes for backups to finish
```

**Docker CLI**:
```bash
docker stop --time=600 dbackup   # Wait up to 10 minutes
```

Without this setting, Docker will kill the backup process after 10 seconds, even though DBackup is trying to wait for it.
:::

## Reverse Proxy Setup

::: warning Security Recommendation
**We strongly recommend running DBackup only on a local network or behind a VPN.** Exposing this application to the public internet without additional security measures (IP whitelisting, SSO, fail2ban, etc.) increases the risk of unauthorized access to your database credentials and backups.

If public access is required, ensure you have:
- Strong, unique passwords
- Two-factor authentication via SSO (see [SSO Configuration](/developer-guide/advanced/sso))
- Rate limiting and IP restrictions
- Regular security audits
:::

### Nginx

```nginx
server {
    listen 80;
    server_name backup.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Traefik

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dbackup.rule=Host(`backup.example.com`)"
  - "traefik.http.routers.dbackup.entrypoints=websecure"
  - "traefik.http.routers.dbackup.tls.certresolver=letsencrypt"
  - "traefik.http.services.dbackup.loadbalancer.server.port=3000"
```

## Local Development

For contributing or local development:

```bash
# Clone repository
git clone https://gitlab.com/Skyfay/dbackup.git
cd dbackup

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Initialize database
npx prisma db push
npx prisma generate

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Updating

### Docker Compose

```bash
# Pull latest image
docker-compose pull

# Restart with new image
docker-compose up -d
```

### Backup Before Updating

Always backup your data before updating:

```bash
# Backup database
cp ./db/prod.db ./db/prod.db.backup

# Backup configuration (use System Backup feature)
# Or manually backup the db folder
```

## Troubleshooting

### Container Won't Start

Check logs:
```bash
docker logs dbackup
```

### Database Locked

If you see "database is locked" errors, ensure only one instance is running:
```bash
docker-compose down
docker-compose up -d
```

### Permission Issues

Ensure volume directories have correct permissions:
```bash
sudo chown -R 1000:1000 ./db ./backups ./storage
```
