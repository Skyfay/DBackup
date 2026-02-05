# Environment Variables

Complete reference for all environment variables in DBackup.

→ **[Installation Guide](/user-guide/installation)** for Docker setup and quick start.

## Required Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting sensitive data (passwords, API keys) | `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | Session encryption secret for authentication | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | **Primary** URL where users access DBackup (for auth redirects) | `https://backup.example.com` |

## Optional Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `TRUSTED_ORIGINS` | Additional URLs for accessing DBackup (comma-separated) | - |
| `DATABASE_URL` | SQLite database file path | `file:/app/db/dbackup.db` |
| `PORT` | Internal port the server listens on | `3000` |
| `TZ` | Server timezone (for logs and cron scheduling) | `UTC` |
| `TMPDIR` | Temporary directory for backup processing | `/tmp` |
| `LOG_LEVEL` | Logging verbosity level | `info` |

### Notes

- **BETTER_AUTH_URL** is the primary URL used for authentication redirects (e.g., after login)
- **TRUSTED_ORIGINS** allows access from multiple URLs. Useful when DBackup is accessible via both IP and domain:
  ```bash
  TRUSTED_ORIGINS="https://192.168.1.10:3000,http://localhost:3000"
  ```
- **PORT** changes the internal port. When using custom ports, set both `PORT` and update your port mapping accordingly
- **DATABASE_URL** has a sensible default and typically doesn't need to be set
- **TMPDIR** is useful for mounting larger storage for temporary backup files (e.g., NFS)
- **TZ** only affects server-side logs. User-facing dates use the timezone from user profile settings
- **LOG_LEVEL** controls logging verbosity:
  - `debug` - All logs including detailed debugging information
  - `info` - Normal operation logs (default, recommended for production)
  - `warn` - Only warnings and errors
  - `error` - Only errors

## Generating Secrets

### Encryption Key

```bash
openssl rand -hex 32
```

::: warning
Store this key securely. Losing it means losing access to all encrypted data (database passwords, API keys stored in DBackup).
:::

### Auth Secret

```bash
openssl rand -base64 32
```

## Security Best Practices

1. **Never commit secrets** - Use `.env` files excluded from git
2. **Rotate secrets periodically** - Especially in production
3. **Use strong random values** - Always use `openssl rand`
4. **Restrict file permissions** - `.env` should be `chmod 600`
5. **Backup your ENCRYPTION_KEY** - Without it, encrypted data cannot be recovered
