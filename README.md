# DBackup

<p align="center">
  <strong>Self-hosted database backup automation with encryption, compression, and smart retention.</strong>
</p>

<p align="center">
  <a href="https://dbackup.app">Documentation</a> •
  <a href="https://dbackup.app/user-guide/getting-started">Quick Start</a> •
  <a href="https://dbackup.app/changelog">Changelog</a> •
  <a href="https://dbackup.app/roadmap">Roadmap</a>
</p>

> **Note**: This project is primarily developed on GitLab. This GitHub repository is a mirror.
> **Main Repository**: [https://gitlab.com/Skyfay/dbackup](https://gitlab.com/Skyfay/dbackup)

![Dashboard Preview](docs/images/overview.png)

## ✨ Features

- **Multi-Database Support** — MySQL, PostgreSQL, MongoDB, SQLite, Microsoft SQL Server
- **Bank-Grade Security** — AES-256-GCM encryption with key rotation and offline recovery kits
- **Flexible Storage** — Local filesystem, S3-compatible (AWS, MinIO, R2), SFTP
- **Smart Retention** — Grandfather-Father-Son rotation policies
- **Live Monitoring** — Real-time progress tracking with detailed logs
- **SSO & RBAC** — OpenID Connect support and granular permission system
- **Notifications** — Discord and Email alerts on backup success/failure

## 🚀 Quick Start

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
