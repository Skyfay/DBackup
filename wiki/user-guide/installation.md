# Installation

This guide covers all installation methods for DBackup.

## Docker Compose (Recommended)

Docker Compose is the recommended way to run DBackup in production.

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+

::: tip Multi-Architecture Support
DBackup images are available for **AMD64** (x86_64) and **ARM64** (aarch64) architectures.

Supports: Intel/AMD servers, Raspberry Pi 4+, Apple Silicon (M1/M2/M3), AWS Graviton
:::

### Basic Setup

Create a `docker-compose.yml` file:

```yaml
services:
  dbackup:
    image: registry.gitlab.com/skyfay/dbackup:beta
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/app/db/prod.db
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=http://localhost:3000
    volumes:
      - ./backups:/backups
      - ./db:/app/db
      - ./storage:/app/storage
```

### Generate Secrets

Before starting, generate the required secrets:

```bash
# Generate ENCRYPTION_KEY (32 bytes as hex = 64 characters)
openssl rand -hex 32

# Generate BETTER_AUTH_SECRET
openssl rand -base64 32
```

Create a `.env` file with your secrets:

```bash
ENCRYPTION_KEY=your-64-character-hex-key-here
BETTER_AUTH_SECRET=your-base64-secret-here
```

### Start the Application

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
  registry.gitlab.com/skyfay/dbackup:beta
```

## Environment Variables

| Variable | Required | Description |
| :--- | :---: | :--- |
| `DATABASE_URL` | ✅ | SQLite database path. Use `file:/app/db/prod.db` for Docker. |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex string (64 chars) for encrypting credentials at rest. |
| `BETTER_AUTH_SECRET` | ✅ | Base64 secret for authentication sessions. |
| `BETTER_AUTH_URL` | ✅ | Public URL of your application (for OAuth callbacks). |

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
