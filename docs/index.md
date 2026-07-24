---
layout: home

hero:
  name: "DBackup"
  text: "Database & File Backup Automation"
  tagline: Self-hosted solution for automating database and file backups with encryption, compression, and smart retention policies.
  actions:
    - theme: brand
      text: User Guide
      link: /user-guide/getting-started
    - theme: alt
      text: Developer Guide
      link: /developer-guide/
    - theme: alt
      text: API Reference
      link: https://api.dbackup.app

features:
  - icon: 🗄️
    title: Multi-Database Support
    details: Supports MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, Valkey, Microsoft SQL Server, and Firebird (beta).
  - icon: 📁
    title: File & Folder Backups
    details: Back up directories from any storage adapter alongside your databases in one job. Folder tree picker, reusable exclude presets, and VSS shadow copies on SMB sources.
  - icon: 🧩
    title: Incremental Backups
    details: Directory sources can store only what changed since the last run. Each chain lives in its own folder and is retained and deleted as a unit, so a snapshot can never lose the archives it depends on.
  - icon: 🔒
    title: Backup Encryption
    details: AES-256-GCM encryption for backup files with managed Encryption Profiles, key rotation, and offline Recovery Kits for manual decryption without DBackup.
  - icon: 🔓
    title: No Vendor Lock-In
    details: Database backups are standard dumps, file backups are plain TAR archives - no proprietary format. Unencrypted, tar -xf is enough. Encrypted, one standalone Node.js script and your Recovery Kit are.
  - icon: 📦
    title: Compression
    details: Built-in GZIP and Brotli compression to reduce backup size and storage costs.
  - icon: ☁️
    title: Flexible Storage
    details: 13+ storage adapters including S3, Google Drive, Dropbox, OneDrive, SFTP, Rsync, WebDAV, SMB, FTP, and local filesystem - usable as backup destinations or as directory sources.
  - icon: 🔀
    title: Multi-Destination Jobs
    details: Each backup job can target multiple storage destinations simultaneously for redundancy or off-site copies.
  - icon: 📅
    title: Scheduling & Retention
    details: Cron-based job scheduling with reusable Retention Policy Templates (GFS), Naming Templates with date/time tokens, and Schedule Presets for consistent job configuration.
  - icon: 🔔
    title: Notifications
    details: 9 notification adapters including Discord, Slack, Teams, Telegram, Gotify, ntfy, Webhook, SMS, and Email (SMTP).
  - icon: 🔄
    title: Restore
    details: Restore a whole backup, a single database, a folder, or one file out of a 100 GB archive without downloading it. Supports database remapping and standalone offline recovery.
  - icon: 👥
    title: Multi-User & RBAC
    details: Granular permission system with user groups, SSO/OIDC support (Authentik, PocketID, Keycloak, Generic), and audit logging.
  - icon: 🔗
    title: API & Webhooks
    details: Trigger backups via REST API with fine-grained API keys. Includes ready-made cURL, Bash, and Ansible examples.
  - icon: 📊
    title: Dashboard & Analytics
    details: Interactive charts, real-time progress tracking, 12-month Backup Calendar heatmap, storage usage history, and auto-refreshing activity feeds.
  - icon: 🗂️
    title: Database Explorer
    details: Browse databases, tables, and live data directly from DBackup. Server-side pagination, full-text search, schema inspection, deep-link URLs, and database version history tracking - for all 8 database engines.
  - icon: 🔍
    title: Storage Explorer
    details: Browse backup files across all destinations, inspect metadata, download files, or generate direct download links.
  - icon: 🚨
    title: Storage Monitoring & Alerts
    details: Per-destination monitoring with configurable alerts for usage spikes, storage limit warnings, and missing backups within a defined time window.
  - icon: ✅
    title: Backup Integrity
    details: Post-upload SHA-256/MD5 checksum verification after every backup, plus scheduled full integrity scans across all stored backups with Jobs mode or full storage scan.
  - icon: 🔑
    title: Credential Vault
    details: Centralized encrypted storage for SSH keys, API tokens, OAuth credentials, SMTP accounts, and passwords. Reuse across adapters without re-entering secrets per job.
  - icon: 🐳
    title: Docker
    details: Multi-arch images (AMD64/ARM64), built-in health checks, graceful shutdown, and SHA-256 image verification.
---


## Quick Start

Get DBackup running in minutes with Docker:

::: code-group

```bash [Docker Run]
docker run -d --name dbackup -p 3000:3000 \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL="https://localhost:3000" \
  -v "$(pwd)/data:/data" \
  -v "$(pwd)/backups:/backups" \
  skyfay/dbackup:latest
```

```yaml [Docker Compose]
services:
  dbackup:
    image: skyfay/dbackup:latest
    container_name: dbackup
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=  # openssl rand -hex 32
      - BETTER_AUTH_URL=https://localhost:3000
      - BETTER_AUTH_SECRET=  # openssl rand -base64 32
    volumes:
      - ./data:/data              # All persistent data (db, storage, certs)
      - ./backups:/backups        # Optional: used for local backups
```

:::


Then open [https://localhost:3000](https://localhost:3000) and create your first admin account (accept the self-signed certificate on first visit).

→ **[Full Installation Guide](/user-guide/installation)** for Docker Compose, volumes, and production setup.

## Supported Integrations

:::tabs
== 🗄️ Databases

| Database | Versions | Connection Modes | Restore |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 | Direct, SSH | Yes |
| **MySQL** | 5.7, 8.x, 9.x | Direct, SSH | Yes |
| **MariaDB** | 10.x, 11.x | Direct, SSH | Yes |
| **MongoDB** | 4.x, 5.x, 6.x, 7.x, 8.x | Direct, SSH | Yes |
| **Redis** | 2.8+ | Direct, SSH | Guided |
| **Valkey** | 7.2+ | Direct, SSH | Guided |
| **SQLite** | 3.x | Local, SSH | Yes |
| **Microsoft SQL Server** | 2017, 2019, 2022, Azure SQL Edge | Direct (+ SSH file transfer) | Yes |
| **Firebird** (Beta) | 3.x, 4.x, 5.x | Direct, SSH | Yes (pre-configured aliases) |

== 📁 Directory Sources

Every storage adapter can also be a **directory source**. What differs is how a restore behaves - adapters that serve byte ranges fetch just the file you asked for:

| Adapter | Browse folders | Restore one file without fetching the whole archive |
| :--- | :---: | :---: |
| **Local Filesystem** | ✅ | ✅ |
| **SFTP** | ✅ | ✅ |
| **Rsync (SSH)** | ✅ | ✅ |
| **FTP / FTPS** | ✅ | ✅ |
| **WebDAV** | ✅ | ✅ |
| **Amazon S3 / S3-compatible** | ✅ | ✅ |
| **Google Drive** | ✅ | ✅ |
| **Dropbox** | ✅ | ✅ |
| **Microsoft OneDrive** | ✅ | ✅ |
| **SMB / Samba** | ✅ | ❌ (fetches the archive once) |

→ [File & Folder Backups](/user-guide/features/file-backups) for setup and the full comparison.

== ☁️ Storage

| Destination | Details |
| :--- | :--- |
| **Local Filesystem** | Store backups directly on the server |
| **Amazon S3** | Native AWS S3 with storage class support (Standard, IA, Glacier, Deep Archive) |
| **S3 Compatible** | Any S3-compatible storage (MinIO, Wasabi, etc.) |
| **Cloudflare R2** | Cloudflare R2 Object Storage |
| **Hetzner Object Storage** | Hetzner S3 storage (fsn1, nbg1, hel1, ash) |
| **Google Drive** | Google Drive via OAuth2 |
| **Dropbox** | Dropbox via OAuth2 with chunked upload support |
| **Microsoft OneDrive** | OneDrive via Microsoft Graph API / OAuth2 |
| **SFTP** | SSH/SFTP with password, private key, or SSH agent auth |
| **FTP / FTPS** | Classic FTP with optional TLS |
| **WebDAV** | WebDAV servers (Nextcloud, ownCloud, etc.) |
| **SMB (Samba)** | Windows/Samba network shares (SMB2, SMB3) |
| **Rsync** | File transfer via rsync over SSH |

== 🔔 Notifications

| Channel | Details |
| :--- | :--- |
| **Discord** | Webhook-based notifications with rich embeds |
| **Slack** | Incoming webhook notifications with Block Kit formatting |
| **Microsoft Teams** | Adaptive Card notifications via Power Automate webhooks |
| **Gotify** | Self-hosted push notifications with priority levels |
| **ntfy** | Topic-based push notifications (self-hosted or ntfy.sh) |
| **Generic Webhook** | JSON payloads to any HTTP endpoint (PagerDuty, etc.) |
| **Telegram** | Bot API push notifications to chats, groups, and channels |
| **SMS (Twilio)** | SMS text message alerts via Twilio API |
| **Email (SMTP)** | SMTP with SSL/STARTTLS support, multiple recipients |

:::

## Your Backups, Your Control

DBackup is designed as a convenience layer, not a dependency.

**Database backups** are a **standard dump** (SQL, BSON, RDB, etc.), the same format you'd get from running `pg_dump`, `mysqldump`, or `mongodump` yourself. Even encrypted, they use **open AES-256-GCM** with a simple sidecar `.meta.json` file for the IV and auth tag. If DBackup is ever unavailable, you can still:

1. **Decrypt** any backup with the included standalone Node.js script (zero external dependencies)
2. **Decompress** automatically (GZIP or Brotli is handled by the same script)
3. **Import** the resulting dump directly with your database's native CLI tool

**File backups** are a **plain TAR archive**. Unencrypted, `tar -xf backup.tar` is the whole recovery procedure. Encrypted, the layout is specified byte by byte in the [Archive Format reference](/developer-guide/reference/archive-format), and the Recovery Kit's `restore_archive.js` is an independent implementation of that document - it lists and extracts single files with nothing but Node.js.

The **[Recovery Kit](/user-guide/security/recovery-kit)** (downloadable from Vault) bundles everything you need: your encryption key, both scripts, and platform-specific helpers for Windows, Linux, and macOS.

::: tip
Download your Recovery Kit after creating an Encryption Profile and store it offline (USB drive, password manager, printed). It's your safety net if DBackup or the server it runs on is no longer accessible.
:::

### The promise has a price

Incremental backups store **whole changed files** and reference unchanged ones in earlier archives of the same chain. They do not use a content-addressed chunk store the way restic, Borg or Kopia do.

That costs storage: a renamed file is stored again, a one-byte change in a 10 GB file re-stores 10 GB, and nothing is deduplicated across jobs or chains. What it buys is that every archive stays a file you can open by hand, deleting a backup is deleting files rather than garbage collection, and a chain is a folder you can copy in any file browser.

If your data is mostly large binaries with small internal changes, a chunk-based tool is the better fit and we would rather say so. See [the reasoning in full](https://dbackup.app/blog/no-global-deduplication), or [Backup Modes](/user-guide/features/backup-modes) for what this means in practice.

## Architecture at a Glance

DBackup is built with modern technologies:

- **Frontend**: Next.js 16 (App Router), React, Shadcn UI
- **Backend**: Next.js Server Actions, Prisma ORM
- **Database**: SQLite for application state
- **Streaming**: Native Node.js streams for efficient encryption/compression

The plugin-based adapter architecture makes it easy to add new databases, storage providers, or notification channels.

## Community & Support

- 💬 **Discord**: Join our community at [https://dc.skyfay.ch](https://dc.skyfay.ch)
- 📝 **Documentation**: Full guides and API reference in this wiki
- 🔗 **API Reference**: Interactive API docs at [api.dbackup.app](https://api.dbackup.app) or in-app at `/docs/api`
- 🐛 **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/Skyfay/DBackup/issues)
- 📧 **Support**: General questions and support via [support@dbackup.app](mailto:support@dbackup.app)
- 🔒 **Security**: Report vulnerabilities responsibly via [security@dbackup.app](mailto:security@dbackup.app) (please do **not** open public issues for security reports)

## 🤖 AI Development Transparency

### Architecture & Concept

The system architecture, infrastructure design, strict technology stack selection, and feature specifications for DBackup were entirely conceptualized and directed by a human System Engineer to solve real-world infrastructure challenges.

### Implementation

The application code was generated by AI coding agents following detailed architectural specifications and coding guidelines. All features were manually tested for correctness, stability, and real-world reliability. Automated unit tests (Vitest) and static security audits complement the manual QA process.

### Open for Review

DBackup is thoroughly tested and used in production, but a formal manual security audit by an external developer has not yet been completed. If you are a software developer or cybersecurity professional, your expertise is highly welcome! We invite the open-source community to review the code, submit PRs, and help us elevate DBackup to a fully verified, enterprise-ready standard.

> **Security Disclosure**: If you discover a security vulnerability, please **do not** open a public GitHub issue. Instead, report it responsibly via email to **[security@dbackup.app](mailto:security@dbackup.app)**.