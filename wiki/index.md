---
layout: home

hero:
  name: "DBackup"
  text: "Database Backup Automation"
  tagline: Self-hosted solution for automating database backups with encryption, compression, and smart retention policies.
  actions:
    - theme: brand
      text: User Guide
      link: /user-guide/getting-started
    - theme: alt
      text: Developer Guide
      link: /developer-guide/

features:
  - icon: 🗄️
    title: Multi-Database Support
    details: Backup MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, and Microsoft SQL Server with a unified interface.
  - icon: 🔒
    title: Enterprise-Grade Security
    details: AES-256-GCM encryption for backups with Encryption Vault, key rotation, and offline Recovery Kits.
  - icon: 📦
    title: Smart Compression
    details: Built-in GZIP and Brotli compression to minimize storage costs and transfer times.
  - icon: ☁️
    title: Flexible Storage
    details: 13+ built-in storage adapters including cloud, self-hosted, and network destinations. See full list below.
  - icon: 📅
    title: Automated Scheduling
    details: Cron-based job scheduling with GVS (Grandfather-Father-Son) retention policies for intelligent rotation.
  - icon: 🔔
    title: Notifications
    details: Get instant alerts when backups complete or fail. See supported channels below.
  - icon: 🔄
    title: One-Click Restore
    details: Browse backup history, download files, or restore databases directly from the web UI.
  - icon: 👥
    title: Multi-User & RBAC
    details: Granular permission system with user groups, SSO/OIDC support, and audit logging.
---

## Quick Start

Get DBackup running in minutes with Docker:

::: code-group

```bash [Docker Run]
docker run -d --name dbackup -p 3000:3000 \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  -v "$(pwd)/db:/app/db" \
  -v "$(pwd)/backups:/backups" \
  -v "$(pwd)/storage:/app/storage" \
  skyfay/dbackup:beta
```

```yaml [Docker Compose]
services:
  dbackup:
    image: skyfay/dbackup:beta
    container_name: dbackup
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=  # openssl rand -hex 32
      - BETTER_AUTH_URL=http://localhost:3000
      - BETTER_AUTH_SECRET=  # openssl rand -base64 32
    volumes:
      - ./backups:/backups      # Local backup storage
      - ./db:/app/db            # SQLite database
      - ./storage:/app/storage  # Uploads & avatars
```

:::


Then open [http://localhost:3000](http://localhost:3000) and create your first admin account.

→ **[Full Installation Guide](/user-guide/installation)** for Docker Compose, volumes, and production setup.

## Supported Databases

| Database | Versions |
| :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 |
| **MySQL** | 5.7, 8.x, 9.x |
| **MariaDB** | 10.x, 11.x |
| **MongoDB** | 4.x, 5.x, 6.x, 7.x, 8.x |
| **Redis** | 6.x, 7.x, 8.x |
| **SQLite** | 3.x (Local & SSH) |
| **Microsoft SQL Server** | 2017, 2019, 2022, Azure SQL Edge |

## Supported Destinations

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

## Supported Notifications

| Channel | Details |
| :--- | :--- |
| **Discord** | Webhook-based notifications with custom username & avatar |
| **Email (SMTP)** | SMTP with SSL/STARTTLS support, multiple recipients |

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
- 🐛 **Issues**: Report bugs or request features on [GitLab Issues](https://gitlab.com/skyfay/dbackup/-/issues)