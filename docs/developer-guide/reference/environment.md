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
| `DATABASE_URL` | SQLite database file path | `file:/data/db/dbackup.db` |
| `SQLITE_WAL_MODE` | Set to `false` to disable SQLite WAL mode | `true` |
| `PORT` | Internal port the server listens on | `3000` |
| `TZ` | Server timezone (for logs and cron scheduling) | `UTC` |
| `TMPDIR` | Temporary directory for backup processing | `/tmp` |
| `LOG_LEVEL` | Logging verbosity level | `info` |
| `DISABLE_HTTPS` | Set to `true` to use plain HTTP instead of HTTPS | `false` |
| `CERTS_DIR` | Directory for TLS certificate and key files | `/data/certs` |
| `DATA_DIR` | Base directory for all persistent data | `/data` |
| `PUID` | User ID the container runs as (for volume permissions) | `1001` |
| `PGID` | Group ID the container runs as (for volume permissions) | `1001` |
| `DBACKUP_AUTO_LOCK` | Set to `1` in the CI image to automatically lock every backup triggered via the API | - |

### Notes

- **BETTER_AUTH_URL** is the primary URL used for authentication redirects (e.g., after login)
- **TRUSTED_ORIGINS** allows access from multiple URLs. Useful when DBackup is accessible via both IP and domain:
  ```bash
  TRUSTED_ORIGINS="https://192.168.1.10:3000,http://localhost:3000"
  ```
- **PORT** changes the internal port. When using custom ports, set both `PORT` and update your port mapping accordingly
- **DATABASE_URL** has a sensible default and typically doesn't need to be set
- **SQLITE_WAL_MODE** enables [WAL (Write-Ahead Logging)](https://www.sqlite.org/wal.html) mode by default so readers and the writer don't block each other. Set to `false` only if `/data` is on a filesystem that doesn't support WAL's shared-memory locking (e.g. some network shares/NFS mounts) - this falls back to SQLite's default rollback journal
- **TMPDIR** is useful for mounting larger storage for temporary backup files (e.g., NFS)
- **TZ** only affects server-side logs. User-facing dates use the timezone from user profile settings
- **PUID/PGID** control which UID/GID the application process runs as. Set these to match your host user (e.g., `PUID=1000 PGID=1000`) to avoid volume permission issues. The entrypoint adjusts the internal user at startup
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

## Startup Validation

DBackup validates all environment variables at startup using Zod schemas (`src/lib/env-validation.ts`).

- **Required variables** (`ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`): Missing or invalid values produce a clear error box in the logs and **abort startup**.
- **Optional variables**: Invalid values (e.g., non-URL in `BETTER_AUTH_URL`, non-numeric `PORT`) are logged as warnings but don't prevent startup.
- **Defaults**: Optional variables have sensible defaults applied automatically if not set.

## Docker Secrets (`_FILE` convention)

DBackup supports the `_FILE` convention for `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`. Set the corresponding `_FILE` variable to a file path and DBackup reads the secret value from that file at startup - the plaintext value never appears in the process environment or `docker inspect` output.

| Variable | `_FILE` equivalent |
| :--- | :--- |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY_FILE` |
| `BETTER_AUTH_SECRET` | `BETTER_AUTH_SECRET_FILE` |

The file content is read by `docker-entrypoint.sh` before the Node.js process starts, so `validateEnvironment()` sees the resolved value and all existing validation rules (length, format) apply identically.

**Error handling:**
- File not readable - container exits with an error message
- File is empty - container exits with an error message
- `_FILE` not set - the corresponding plain env var is used as normal

→ See **[Docker Secrets](/user-guide/installation#docker-secrets-_file-convention)** in the Installation Guide for full setup examples (Docker Swarm and Compose).

## Security Best Practices

1. **Never commit secrets** - Use `.env` files excluded from git
2. **Use Docker Secrets** - Prefer `_FILE` variables over plaintext env vars in production
3. **Rotate secrets periodically** - Especially in production
4. **Use strong random values** - Always use `openssl rand`
5. **Restrict file permissions** - `.env` and secret files should be `chmod 600`
6. **Backup your ENCRYPTION_KEY** - Without it, encrypted data cannot be recovered
