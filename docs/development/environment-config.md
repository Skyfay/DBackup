# Environment & Configuration Guide

This guide details the environment variables and system requirements needed to run the Database Backup Manager.

## 1. System Requirements

The application acts as an orchestrator. It does not contain the database engines itself, but it **requires the CLI tools** to be installed on the host OS (or the container running the app).

### Required CLI Tools
*   **MySQL**: `mysqldump` (usually part of `mysql-client`)
*   **Postgres**: `pg_dump` (part of `postgresql-client` / `libpq`)
*   **MongoDB**: `mongodump` (part of `mongodb-database-tools`)
*   **Local Storage**: Node.js `fs` access (no extra tools needed)

### Node.js
*   Version: 18+ (Recommended: 20 LTS active)
*   Package Manager: `pnpm` (Project standard) or `npm`.

## 2. Environment Variables (`.env`)

The application is configured via a `.env` file in the root directory.

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| **DATABASE_URL** | Prisma connection string for the **App State** (Settings, Jobs). | `"file:./dev.db"` |
| **NEXTAUTH_URL** | Canonical URL of the site. | `http://localhost:3000` |
| **NEXTAUTH_SECRET** | Secret used to sign session cookies. | `openssl rand -base64 32` |
| **BETTER_AUTH_SECRET** | Fallback secret for Better-Auth specifically. | *(Same as NEXTAUTH_SECRET)* |
| **CRON_TIMEZONE** | Timezone for the scheduler. | `Europe/Berlin` |
| **LOG_LEVEL** | Logging verbosity. | `info` |

## 3. Docker Deployment

When deploying via Docker (production), the image is built using `Dockerfile`.

### Important Notes for Docker
1.  **Multi-Stage Build**: We use a multi-stage build to keep the image small.
2.  **Tool Installation**: The `Dockerfile` **must install** the CLI tools (`mariadb-client`, `postgresql-client`, `mongodb-tools`) into the final runtime image. If you add a new Adapter that requires a CLI tool (e.g. `sqlite3`), you must update the `Dockerfile` to `apt-get install` it.

### Volume Mounts
*   `/app/prisma/dev.db`: Mount this to persist application setttings.
*   `/backups`: Mount this if using Local Storage Adapter to persist backups on the host.

## 4. Security Considerations

*   **Encryption**: All sensitive credentials (DB passwords, S3 keys) stored in the `AdapterConfig` table are **encrypted at rest** using `src/lib/crypto.ts` (AES-256-GCM).
*   **Key Rotation**: Changing the encryption key (if we implemented one manually instead of derived) would render all stored configs unreadable. Currently, the crypto key is derived from fixed constants or env vars – *Plan to move this to `ENCRYPTION_KEY` env var in future.*
