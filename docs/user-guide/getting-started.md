# Getting Started

Welcome to DBackup! This guide will help you understand the basics and get your first backup running in minutes.

## What is DBackup?

DBackup is a self-hosted web application for automating database backups. It supports multiple database engines, various storage destinations, encryption, compression, and flexible retention policies.

## Key Features

- **Multi-Database Support**: MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, Valkey, Microsoft SQL Server, Firebird (beta)
- **Flexible Storage**: 13+ adapters including local filesystem, S3, Google Drive, SFTP, and more
- **Multi-Destination Jobs**: A single job can upload to multiple storage destinations simultaneously
- **Backup Encryption**: AES-256-GCM encryption with an Encryption Vault, key rotation, and offline Recovery Kits
- **Compression**: Built-in GZIP and Brotli compression
- **Scheduling & Retention**: Cron-based scheduling with GFS (Grandfather-Father-Son) retention policies
- **Notifications**: 9+ adapters including Discord, Slack, Teams, Telegram, Email, and more
- **Storage Monitoring**: Per-destination alerts for usage spikes, storage limit warnings, and missing backups
- **Restore**: Browse backup history, verify checksums, and restore directly to a database including database remapping

## Prerequisites

- **Docker & Docker Compose** (recommended)
- Or: **Node.js 20+** for local development

## Installation

Follow the **[Installation Guide](/user-guide/installation)** to set up DBackup with Docker Compose or Docker Run.

## Next Steps

- [First Steps](/user-guide/first-steps) - Log in and set up your first backup
- [Database Sources](/user-guide/sources/) - Configure database connections
- [Storage Destinations](/user-guide/destinations/) - Setup backup storage
- [Encryption](/user-guide/security/encryption) - Secure your backups
- [Scheduling](/user-guide/jobs/scheduling) - Automate your backups
