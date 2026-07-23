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
    image: skyfay/dbackup:latest
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=https://localhost:3000
      # - DISABLE_HTTPS=true  # Use plain HTTP - required behind a reverse proxy
      # - TZ=Europe/Zurich  # Optional: Server timezone
    volumes:
      - ./data:/data              # All persistent data (db, storage, certs)
      - ./backups:/backups        # Optional: used for local backups
```

```bash [Docker Run]
docker run -d \
  --name dbackup \
  --restart always \
  -p 3000:3000 \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL="https://localhost:3000" \
  -v "$(pwd)/data:/data" \
  -v "$(pwd)/backups:/backups" \
  skyfay/dbackup:latest
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

Access the application at [https://localhost:3000](https://localhost:3000) (accept the self-signed certificate on first visit).

## Environment Variables

| Variable | Required | Description |
| :--- | :---: | :--- |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex string (64 chars) for encrypting credentials at rest. |
| `BETTER_AUTH_SECRET` | ✅ | Base64 secret for authentication sessions. |
| `BETTER_AUTH_URL` | ✅ | **Primary** URL where users access DBackup (for auth redirects). |
| `TRUSTED_ORIGINS` | ❌ | Additional access URLs, comma-separated (see below). |
| `PORT` | ❌ | Internal server port. Default: `3000` |
| `DATABASE_URL` | ❌ | SQLite path. Default: `file:/data/db/dbackup.db` |
| `SQLITE_WAL_MODE` | ❌ | Set to `false` to disable WAL mode. Default: `true` |
| `TZ` | ❌ | Server timezone for logs. Default: `UTC` |
| `TMPDIR` | ❌ | Temp directory for large backups. Default: `/tmp` |
| `LOG_LEVEL` | ❌ | Logging verbosity: `debug`, `info`, `warn`, `error`. Default: `info` |
| `DISABLE_HTTPS` | ❌ | Set to `true` to use plain HTTP. Default: `false` (HTTPS). **Set this when running behind a reverse proxy** - see [Reverse Proxy Setup](#reverse-proxy-setup) |
| `PUID` | ❌ | User ID the container runs as. Default: `1001` |
| `PGID` | ❌ | Group ID the container runs as. Default: `1001` |

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

## Docker Secrets (`_FILE` convention)

DBackup supports the `_FILE` convention for `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. Instead of passing the secret value directly as an environment variable, you point to a file path - DBackup reads the contents at startup.

This is the standard approach for **Docker Swarm secrets** and any file-based secrets manager (Vault Agent, Kubernetes secrets mounted as files).

| Environment variable | Effect |
| :--- | :--- |
| `ENCRYPTION_KEY_FILE=/run/secrets/enc_key` | Reads `ENCRYPTION_KEY` from the given file |
| `BETTER_AUTH_SECRET_FILE=/run/secrets/auth_secret` | Reads `BETTER_AUTH_SECRET` from the given file |

::: tip
If both `ENCRYPTION_KEY` and `ENCRYPTION_KEY_FILE` are set, the `_FILE` value takes precedence.
:::

### Docker Swarm example

```bash
# Create the secrets once
echo -n "$(openssl rand -hex 32)" | docker secret create encryption_key -
echo -n "$(openssl rand -base64 32)" | docker secret create auth_secret -
```

```yaml
# docker-compose.yml (Swarm mode)
services:
  dbackup:
    image: skyfay/dbackup:latest
    environment:
      - ENCRYPTION_KEY_FILE=/run/secrets/encryption_key
      - BETTER_AUTH_SECRET_FILE=/run/secrets/auth_secret
      - BETTER_AUTH_URL=https://backup.example.com
    secrets:
      - encryption_key
      - auth_secret
    volumes:
      - ./data:/data

secrets:
  encryption_key:
    external: true
  auth_secret:
    external: true
```

### Docker Compose (non-Swarm) example

```bash
# Create secret files with restricted permissions
mkdir -p ./secrets
openssl rand -hex 32 > ./secrets/encryption_key.txt
openssl rand -base64 32 > ./secrets/auth_secret.txt
chmod 600 ./secrets/*.txt
```

```yaml
# docker-compose.yml
services:
  dbackup:
    image: skyfay/dbackup:latest
    environment:
      - ENCRYPTION_KEY_FILE=/run/secrets/encryption_key
      - BETTER_AUTH_SECRET_FILE=/run/secrets/auth_secret
      - BETTER_AUTH_URL=https://localhost:3000
    secrets:
      - encryption_key
      - auth_secret
    volumes:
      - ./data:/data

secrets:
  encryption_key:
    file: ./secrets/encryption_key.txt
  auth_secret:
    file: ./secrets/auth_secret.txt
```

## Volume Mounts

| Mount Point | Required | Purpose |
| :--- | :---: | :--- |
| `/data` | ✅ | All persistent data (database, uploads, certificates) |
| `/backups` | ❌ | Optional: used for local backups |

::: info SQLite WAL mode
DBackup runs its internal SQLite database in [WAL (Write-Ahead Logging)](https://www.sqlite.org/wal.html) mode by default for better read/write concurrency. This creates two extra files next to the database, `dbackup.db-wal` and `dbackup.db-shm`, inside `/data/db`. They are normal and required while the app is running - do not delete them manually. Back up or copy the whole `db` folder together (not just the `.db` file) to avoid losing uncommitted writes. Set `SQLITE_WAL_MODE=false` to disable WAL mode if your storage backend doesn't support it (e.g. some network shares/NFS mounts).
:::

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

When stopping the container, DBackup **waits for all running backup/restore jobs to finish** before shutting down - no data is lost, regardless of how long the backup takes:

```bash
docker stop dbackup          # Sends SIGTERM → waits for running backups to finish
docker compose down           # Same graceful behavior
```

- **Running jobs** are always completed before the process exits
- **Pending jobs** in the queue are cancelled and marked as `Failed`
- The scheduler is stopped immediately (no new cron triggers)
- A second `Ctrl+C` / `docker kill` forces immediate exit for emergencies

::: warning Docker Stop Timeout
By default, Docker sends a `SIGKILL` **10 seconds** after `docker stop` - this forcefully kills the process regardless of what it's doing. Since `SIGKILL` cannot be caught by any application, you **must** increase the timeout if your backups take longer than 10 seconds.

**Docker Compose** (recommended - add to your `docker-compose.yml`):
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

::: warning Set `DISABLE_HTTPS=true` behind a proxy
By default DBackup terminates TLS itself and serves **HTTPS** on port 3000 with a
self-signed certificate. Behind a reverse proxy that is almost never what you want: the
proxy already terminates TLS, and it will refuse the self-signed certificate on the way to
the container - typically as a `502 Bad Gateway`, an SSL handshake error, or an endlessly
loading page with nothing useful in the DBackup log.

Set `DISABLE_HTTPS=true` so DBackup serves plain HTTP, and let the proxy handle
certificates. The examples below all assume this:

```yaml
environment:
  - DISABLE_HTTPS=true
```

Leave it unset only if you point the browser straight at the container, or if your proxy is
configured to talk HTTPS upstream and to accept a self-signed certificate (`proxy_pass
https://...` plus `proxy_ssl_verify off` in nginx, `serversTransport.insecureSkipVerify` in
Traefik).
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
git clone https://github.com/Skyfay/DBackup.git
cd DBackup

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

If volume files are owned by a different user, set `PUID`/`PGID` to match your host user:
```bash
# Find your host user's UID/GID
id
# uid=1000(user) gid=1000(user)

# Set in docker-compose.yml
environment:
  - PUID=1000
  - PGID=1000
```
