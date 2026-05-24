<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/DBackup/main/docs/public/logo.svg" alt="DBackup Logo" width="120">
</div>

<h1 align="center">DBackup</h1>

<p align="center">
  <strong>Self-hosted database backup automation with encryption, compression, and smart retention.</strong>
</p>

<p align="center">

</p>
<p align="center">
  <img src="https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=white" alt="MySQL">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white" alt="Redis">
  <img src="https://custom-icon-badges.demolab.com/badge/Microsoft%20SQL%20Server-CC2927?logo=mssqlserver-white&logoColor=white" alt="MSSQL">
  <br>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License">
  <img src="https://img.shields.io/docker/pulls/skyfay/dbackup?logo=docker&logoColor=white" alt="Docker Pulls">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/self--hosted-yes-%239B59B6" alt="Self-hosted">
  <img src="https://img.shields.io/badge/open_source-%E2%9D%A4%EF%B8%8F-red" alt="Open Source">
  <br>
  <a href="https://github.com/Skyfay/DBackup/actions/workflows/release.yml"><img src="https://github.com/Skyfay/DBackup/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://codecov.io/gh/Skyfay/DBackup"><img src="https://img.shields.io/codecov/c/github/Skyfay/DBackup?label=coverage" alt="Coverage"></a>
  <a href="https://github.com/Skyfay/DBackup/commits"><img src="https://img.shields.io/github/last-commit/Skyfay/DBackup?color=%234B8BBE" alt="Last Commit"></a>
  <a href="https://discord.com/invite/YvgPyky"><img src="https://img.shields.io/discord/580801656707350529?label=Discord&color=%235865f2" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://dbackup.app">Website</a> •
  <a href="https://docs.dbackup.app">Documentation</a> •
  <a href="https://docs.dbackup.app/user-guide/getting-started">Quick Start</a> •
  <a href="https://api.dbackup.app">API Reference</a> •
  <a href="https://docs.dbackup.app/changelog">Changelog</a> •
  <a href="https://docs.dbackup.app/roadmap">Roadmap</a>
</p>


### What is DBackup?

DBackup is a comprehensive, self-hosted backup solution designed to automate and secure your database backups. It provides AES-256-GCM encryption, flexible storage options, and intelligent retention policies to ensure your data is always protected and recoverable.

Whether you're running a single MySQL database or managing multiple PostgreSQL, MongoDB, and SQL Server instances, DBackup offers a unified interface with real-time monitoring, granular access control, and seamless restore capabilities.

**No vendor lock-in by design** - every backup is a standard database dump (SQL, BSON, RDB, etc.) encrypted with open AES-256-GCM. If DBackup is ever unavailable, you can decrypt and restore your backups with a single Node.js script and the key from your Recovery Kit. No proprietary formats, no dependencies on DBackup itself.

<div align="center">
  <video src="https://github.com/user-attachments/assets/1f6ba8c7-8b66-4b43-a0de-d4c4e0617205" width="800" autoplay muted loop playsinline></video>
</div>

## ✨ Features

### 🗄️ Database Backup

- **7 Database Engines** - MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, and Microsoft SQL Server
- **Selective Database Backup** - Choose exactly which databases to back up per job instead of creating separate sources for each database
- **Multi-Database Jobs** - Back up multiple databases from a single source in one job with a unified TAR archive format
- **AES-256-GCM Encryption** - Encrypt backups with managed Encryption Profiles, key rotation, and downloadable Recovery Kits for offline decryption
- **GZIP & Brotli Compression** - Reduce backup size and storage costs with built-in compression

### ☁️ Storage & Destinations

- **13+ Storage Adapters** - S3, Cloudflare R2, Hetzner, Google Drive, Dropbox, OneDrive, SFTP, FTP, WebDAV, SMB, Rsync, and local filesystem
- **Multi-Destination Jobs** - Upload each backup to multiple storage destinations simultaneously for redundancy or off-site copies
- **Storage Explorer** - Browse backup files across all destinations, inspect metadata, download files, or generate secure direct download links
- **Storage Monitoring & Alerts** - Per-destination alerts for usage spikes, storage limit warnings, and missing backups within a defined time window

### 🔄 Restore & Recovery

- **One-Click Restore** - Restore directly from the Storage Explorer to any configured database target
- **Database Remapping** - Restore databases under different names or map multiple databases to new targets
- **Version Compatibility Check** - Pre-restore validation warns about version mismatches before execution
- **SHA-256 Integrity Verification** - Checksums generated on backup and verified before restore
- **No Vendor Lock-In** - Backups are standard database dumps encrypted with open AES-256-GCM. Decrypt and import manually with just Node.js, no DBackup required
- **Recovery Kit** - Downloadable ZIP with your encryption key and a standalone decryption script for disaster recovery without DBackup

### 📊 Monitoring & Visibility

- **Live Backup Progress** - Real-time progress tracking shows exactly what's happening during backup and restore operations
- **Interactive Dashboard** - Activity charts, job status overview, KPI cards, and auto-refreshing activity feeds
- **Storage Usage History** - Track storage growth over time with area charts and trend indicators
- **Execution History** - Full log of every backup and restore with duration, file size, status, and error details

### 🔔 Notifications

- **9 Notification Channels** - Discord, Slack, Teams, Telegram, Gotify, ntfy, Webhook, SMS (Twilio), and Email (SMTP)
- **Per-Job Notification Settings** - Configure which notification channels fire for each backup job individually
- **System Event Notifications** - Get notified about user logins, account creation, restore results, storage alerts, update availability, and system errors across all channels
- **Repeat Intervals** - Configurable reminder intervals for recurring alerts (storage warnings, update notices)

### ⏰ Scheduling & Retention

- **Cron-based Scheduling** - Flexible job scheduling with a visual Schedule Picker (Simple Mode + Cron Mode)
- **GVS Retention Policies** - Grandfather-Father-Son rotation with per-destination retention settings
- **Automated Config Backups** - Self-backup of the entire DBackup configuration to any storage adapter

### 👥 Access Control & Security

- **SSO / OIDC** - OpenID Connect with pre-built adapters for Authentik, PocketID, Keycloak, and a generic OIDC option
- **RBAC** - User groups with granular permissions, protected SuperAdmin group, and audit logging
- **2FA / Passkeys** - Two-factor authentication and WebAuthn passkey support
- **Configurable Rate Limits** - Per-category rate limiting (Auth, API Read, API Write) adjustable from the Settings UI

### 🔗 API & Automation

- **REST API** - Trigger backups, poll executions, manage adapters, and explore storage via API
- **Fine-grained API Keys** - Scoped permissions and expiration dates for CI/CD pipelines and scripts
- **Ready-made Examples** - cURL, Bash, and Ansible examples included in the API docs

### 🎨 Designed for Simplicity

- **Intuitive UI** - Clean, modern interface that makes complex backup workflows feel simple
- **Quick Setup Wizard** - Guided 7-step first-run setup to get your first backup running in minutes
- **Highly Configurable** - Session lifetimes, rate limits, retention periods, notification preferences, system tasks, and more
- **Docker Ready** - Multi-arch images (AMD64/ARM64), health checks, graceful shutdown, and configurable PUID/PGID

## 🚀 Quick Start

**Supported Platforms**: AMD64 (x86_64) • ARM64 (aarch64)

```yaml
# docker-compose.yml
services:
  dbackup:
    image: skyfay/dbackup:latest
    container_name: dbackup
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=       # openssl rand -hex 32
      - BETTER_AUTH_URL=https://localhost:3000
      - BETTER_AUTH_SECRET=   # openssl rand -base64 32
      # All additional environment variables: https://docs.dbackup.app/user-guide/installation#environment-variables
    volumes:
      - ./data:/data              # All persistent data (db, storage, certs)
      - ./backups:/backups        # Optional: used for local backups
```

```bash
docker-compose up -d
```

Open [https://localhost:3000](https://localhost:3000) and create your admin account (accept the self-signed certificate warning on first visit).

📖 **Full installation guide**: [docs.dbackup.app/user-guide/getting-started](https://docs.dbackup.app/user-guide/getting-started)

## 🗄️ Supported Databases

| Database | Versions | Connection Modes |
| :--- | :--- | :--- |
| PostgreSQL | 12 – 18 | Direct, SSH |
| MySQL | 5.7, 8, 9 | Direct, SSH |
| MariaDB | 10, 11 | Direct, SSH |
| MongoDB | 4 – 8 | Direct, SSH |
| Redis | 6.x, 7.x, 8.x | Direct, SSH |
| SQLite | 3.x | Local, SSH |
| Microsoft SQL Server | 2017, 2019, 2022 | Direct (+ SSH for file transfer) |

## ☁️ Supported Destinations

| Destination | Details |
| :--- | :--- |
| Local Filesystem | Store backups directly on the server |
| Amazon S3 | Native AWS S3 with storage class support (Standard, IA, Glacier, Deep Archive) |
| S3 Compatible | Any S3-compatible storage (MinIO, Wasabi, etc.) |
| Cloudflare R2 | Cloudflare R2 Object Storage |
| Hetzner Object Storage | Hetzner S3 storage (fsn1, nbg1, hel1, ash) |
| Google Drive | Google Drive via OAuth2 |
| Dropbox | Dropbox via OAuth2 with chunked upload support |
| Microsoft OneDrive | OneDrive via Microsoft Graph API / OAuth2 |
| SFTP | SSH/SFTP with password, private key, or SSH agent auth |
| FTP / FTPS | Classic FTP with optional TLS |
| WebDAV | WebDAV servers (Nextcloud, ownCloud, etc.) |
| SMB (Samba) | Windows/Samba network shares (SMB2, SMB3) |
| Rsync | File transfer via rsync over SSH |

## 🔔 Supported Notifications

| Channel | Details |
| :--- | :--- |
| Discord | Webhook-based notifications with rich embeds |
| Slack | Incoming webhook notifications with Block Kit formatting |
| Microsoft Teams | Adaptive Card notifications via Power Automate webhooks |
| Gotify | Self-hosted push notifications with priority levels |
| ntfy | Topic-based push notifications (self-hosted or ntfy.sh) |
| Generic Webhook | JSON payloads to any HTTP endpoint (PagerDuty, etc.) |
| Telegram | Bot API push notifications to chats, groups, and channels |
| SMS (Twilio) | SMS text message alerts via Twilio API |
| Email (SMTP) | SMTP with SSL/STARTTLS support, multiple recipients |

## 📚 Documentation

Full documentation is available at **[docs.dbackup.app](https://docs.dbackup.app)**:

- [User Guide](https://docs.dbackup.app/user-guide/getting-started) - Installation, configuration, usage
- [API Reference](https://api.dbackup.app) - Interactive REST API documentation
- [Developer Guide](https://docs.dbackup.app/developer-guide/) - Architecture, adapters, contributing
- [Changelog](https://docs.dbackup.app/changelog) - Release history
- [Roadmap](https://docs.dbackup.app/roadmap) - Planned features

## 🛠️ Development

```bash
# Clone & install
git clone https://github.com/Skyfay/DBackup.git && cd DBackup
pnpm install

# Configure environment
cp .env.example .env  # Edit with your secrets

# Initialize database
npx prisma db push

# Start dev server
pnpm dev
```

For contribution guidelines, see the [CONTRIBUTING.md](CONTRIBUTING.md).

## 💬 Community & Support

- 💬 **Discord**: Join our community at [https://dc.skyfay.ch](https://dc.skyfay.ch)
- 📝 **Documentation**: Full guides and API reference at [docs.dbackup.app](https://docs.dbackup.app)
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

## 📝 License

[GNU General Public License v3.0](LICENSE)
