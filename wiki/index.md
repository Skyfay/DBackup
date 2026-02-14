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
    details: Backup MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, and Microsoft SQL Server with a unified interface.
  - icon: 🔒
    title: Enterprise-Grade Security
    details: AES-256-GCM encryption for backups with Encryption Vault, key rotation, and offline Recovery Kits.
  - icon: 📦
    title: Smart Compression
    details: Built-in GZIP and Brotli compression to minimize storage costs and transfer times.
  - icon: ☁️
    title: Flexible Storage
    details: Store backups on Local Filesystem, WebDAV, SFTP, FTP/S, SMB/CIFS, Rsync, Google Drive or any S3-compatible storage.
  - icon: 📅
    title: Automated Scheduling
    details: Cron-based job scheduling with GVS (Grandfather-Father-Son) retention policies for intelligent rotation.
  - icon: 🔔
    title: Notifications
    details: Get instant alerts via Discord or Email when backups complete or fail.
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