<div align="center">
  <img src="wiki/public/logo.svg" alt="DBackup Logo" width="120">
</div>

<h1 align="center">DBackup</h1>

<p align="center">
  <strong>Self-hosted database backup automation with encryption, compression, and smart retention.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=white" alt="MySQL">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white" alt="Redis">
  <img src="https://custom-icon-badges.demolab.com/badge/Microsoft%20SQL%20Server-CC2927?logo=mssqlserver-white&logoColor=white" alt="MSSQL">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License">
  <img src="https://img.shields.io/docker/pulls/skyfay/dbackup?logo=docker&logoColor=white" alt="Docker Pulls">
  <img src="https://img.shields.io/badge/docker-multi--arch-2496ED?logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/self--hosted-yes-brightgreen" alt="Self-hosted">
  <img src="https://img.shields.io/badge/open_source-%E2%9D%A4%EF%B8%8F-red" alt="Open Source">
</p>

<p align="center">
  <a href="https://dbackup.app">Documentation</a> •
  <a href="https://dbackup.app/user-guide/getting-started">Quick Start</a> •
  <a href="https://dbackup.app/changelog">Changelog</a> •
  <a href="https://dbackup.app/roadmap">Roadmap</a>
</p>


### What is DBackup?

DBackup is a comprehensive, self-hosted backup solution designed to automate and secure your database backups. It provides enterprise-grade encryption (AES-256-GCM), flexible storage options, and intelligent retention policies to ensure your data is always protected and recoverable.

Whether you're running a single MySQL database or managing multiple PostgreSQL, MongoDB, and SQL Server instances, DBackup offers a unified interface with real-time monitoring, granular access control, and seamless restore capabilities.


> **Note**: This project is primarily developed on GitLab. This GitHub repository is a mirror.
> **Main Repository**: [https://gitlab.com/Skyfay/dbackup](https://gitlab.com/Skyfay/dbackup)

![Dashboard Preview](wiki/public/overview.png)

## ✨ Features

- **Multi-Database Support** — MySQL, PostgreSQL, MongoDB, SQLite, Microsoft SQL Server, Redis
- **Enterprise-Grade Security** — AES-256-GCM encryption with key rotation and offline recovery kits
- **Flexible Storage** — Local filesystem, S3-compatible (AWS, MinIO, R2), SFTP
- **Smart Retention** — Grandfather-Father-Son rotation policies
- **Live Monitoring** — Real-time progress tracking with detailed logs
- **SSO & RBAC** — OpenID Connect support and granular permission system
- **Notifications** — Discord and Email alerts on backup success/failure

## 🚀 Quick Start

**Supported Platforms**: AMD64 (x86_64) • ARM64 (aarch64)

```yaml
# docker-compose.yml
services:
  dbackup:
    image: skyfay/dbackup:beta
    container_name: dbackup
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=       # openssl rand -hex 32
      - BETTER_AUTH_URL=http://localhost:3000
      - BETTER_AUTH_SECRET=   # openssl rand -base64 32
    volumes:
      - ./backups:/backups
      - ./db:/app/db
      - ./storage:/app/storage
```

```bash
docker-compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and create your admin account.

📖 **Full installation guide**: [dbackup.app/user-guide/getting-started](https://dbackup.app/user-guide/getting-started)

## 🗄️ Supported Databases

| Database | Versions |
| :--- | :--- |
| PostgreSQL | 12 – 18 |
| MySQL | 5.7, 8, 9 |
| MariaDB | 10, 11 |
| MongoDB | 4 – 8 |
| SQLite | 3.x (Local & SSH) |
| Microsoft SQL Server | 2017, 2019, 2022 |

## 📚 Documentation

Full documentation is available at **[dbackup.app](https://dbackup.app)**:

- [User Guide](https://dbackup.app/user-guide/) — Installation, configuration, usage
- [Developer Guide](https://dbackup.app/developer-guide/) — Architecture, adapters, contributing
- [Changelog](https://dbackup.app/changelog) — Release history
- [Roadmap](https://dbackup.app/roadmap) — Planned features

## 🛠️ Development

```bash
# Clone & install
git clone https://gitlab.com/Skyfay/dbackup.git && cd dbackup
pnpm install

# Configure environment
cp .env.example .env  # Edit with your secrets

# Initialize database
npx prisma db push

# Start dev server
pnpm dev
```

For testing infrastructure and contribution guidelines, see the [Developer Guide](https://dbackup.app/developer-guide/).

## 🤖 AI Development Transparency

This project is developed with the assistance of advanced AI coding agents. While AI accelerates development, we adhere to strict engineering standards:

- **Human Review** — All AI-generated code undergoes manual review for logic and security
- **Security-First** — Rigorous access controls (RBAC), encryption standards (AES-256-GCM), and audits
- **Testing Culture** — Comprehensive unit and integration test suite (Vitest)
- **Modern Practices** — Current best practices for Next.js, TypeScript, and Docker

## 📝 License

[GNU General Public License v3.0](LICENSE)
