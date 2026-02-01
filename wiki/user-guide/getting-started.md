# Getting Started

Welcome to DBackup! This guide will help you understand the basics and get your first backup running in minutes.

## What is DBackup?

DBackup is a self-hosted web application for automating database backups. It supports multiple database engines, various storage destinations, and provides enterprise-grade security features like AES-256-GCM encryption.

## Key Features

- **Multi-Database Support**: MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Microsoft SQL Server
- **Flexible Storage**: Local filesystem, S3-compatible storage, SFTP
- **Security**: AES-256-GCM encryption, credential encryption at rest
- **Automation**: Cron-based scheduling with smart retention policies
- **Monitoring**: Real-time progress tracking, execution history, notifications

## Prerequisites

- **Docker & Docker Compose** (recommended)
- Or: **Node.js 20+** for local development

## Quick Start with Docker

The fastest way to get started is using Docker Compose:

```yaml
# docker-compose.yml
services:
  dbackup:
    image: registry.gitlab.com/skyfay/dbackup:beta
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/app/db/prod.db
      - ENCRYPTION_KEY=your-64-char-hex-key  # openssl rand -hex 32
      - BETTER_AUTH_SECRET=your-base64-secret # openssl rand -base64 32
      - BETTER_AUTH_URL=http://localhost:3000
    volumes:
      - ./backups:/backups
      - ./db:/app/db
      - ./storage:/app/storage
```

Then run:

```bash
docker-compose up -d
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## First Steps

### 1. Create Admin Account

On first launch, you'll see a login page with a "Sign Up" option. This self-registration is **only available for the first user** and creates the administrator account.

### 2. Add a Storage Destination

Before creating backup jobs, you need at least one storage destination.

1. Navigate to **Destinations** in the sidebar
2. Click **Add Destination**
3. Choose a storage type (e.g., "Local Filesystem")
4. Configure the path (e.g., `/backups`)
5. Click **Test Connection** to verify
6. Save the destination

### 3. Add a Database Source

1. Navigate to **Sources** in the sidebar
2. Click **Add Source**
3. Select your database type (MySQL, PostgreSQL, etc.)
4. Enter connection details (host, port, credentials)
5. Click **Test Connection** to verify
6. Select which databases to backup
7. Save the source

### 4. Create a Backup Job

1. Navigate to **Jobs** in the sidebar
2. Click **Create Job**
3. Select the source and destination
4. Configure schedule (or leave empty for manual only)
5. Optionally enable compression and encryption
6. Save the job

### 5. Run Your First Backup

Click the **Run Now** button on your job to execute it immediately. You can monitor progress in real-time and view the results in the execution history.

## Next Steps

- [Installation Guide](/user-guide/installation) - Detailed setup instructions
- [Database Sources](/user-guide/sources/) - Configure database connections
- [Storage Destinations](/user-guide/destinations/) - Setup backup storage
- [Encryption](/user-guide/security/encryption) - Secure your backups
