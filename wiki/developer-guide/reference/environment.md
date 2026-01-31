# Environment Variables

Complete reference for all environment variables in DBackup.

## Required Variables

### Core Application

| Variable | Description | Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | SQLite database file path | `file:./prisma/data.db` |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting sensitive data | `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | Session encryption secret | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public URL of your DBackup instance | `http://localhost:3000` |

## Optional Variables

### Server Configuration

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Port to run the server on | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `HOSTNAME` | Hostname to bind to | `0.0.0.0` |

### Email (SMTP)

For password reset and notifications:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | `your@email.com` |
| `SMTP_PASSWORD` | SMTP password | `app-password` |
| `SMTP_FROM` | Sender email address | `dbackup@example.com` |

### Logging

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LOG_LEVEL` | Minimum log level | `info` |
| `LOG_TO_FILE` | Enable file logging | `true` |
| `LOG_DIR` | Directory for log files | `./logs` |
| `LOG_MAX_FILES` | Max log files to keep | `30` |

## Generating Secrets

### Encryption Key

Generate a secure 32-byte encryption key:

```bash
openssl rand -hex 32
```

::: warning
Store this key securely. Losing it means losing access to all encrypted data.
:::

### Auth Secret

Generate a secure auth secret:

```bash
openssl rand -base64 32
```

## Docker Configuration

When running with Docker, set environment variables via:

### Docker Run

```bash
docker run -d \
  -e DATABASE_URL="file:/data/dbackup.db" \
  -e ENCRYPTION_KEY="your-32-byte-hex-key" \
  -e BETTER_AUTH_SECRET="your-auth-secret" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  skyfay/dbackup:latest
```

### Docker Compose

```yaml
services:
  dbackup:
    image: skyfay/dbackup:latest
    environment:
      DATABASE_URL: "file:/data/dbackup.db"
      ENCRYPTION_KEY: "${ENCRYPTION_KEY}"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
      BETTER_AUTH_URL: "http://localhost:3000"
```

Use a `.env` file alongside your `docker-compose.yml`:

```bash
# .env
ENCRYPTION_KEY=your-32-byte-hex-key
BETTER_AUTH_SECRET=your-auth-secret
```

## Security Best Practices

1. **Never commit secrets** - Use `.env` files excluded from git
2. **Rotate secrets periodically** - Especially in production
3. **Use strong random values** - Always use `openssl rand`
4. **Restrict file permissions** - `.env` should be `chmod 600`

## Validating Configuration

Check if all required variables are set:

```bash
# In development
pnpm dev
# Will show warnings for missing variables

# In Docker
docker logs dbackup
# Check for configuration errors
```
