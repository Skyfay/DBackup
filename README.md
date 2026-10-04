<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/DBackup/main/docs/public/logo.svg" alt="DBackup Logo" width="120">
</div>

<h1 align="center">DBackup</h1>

<p align="center">
  <strong>Self-hosted backup automation for databases and files, with encryption, compression, and smart retention.</strong>
</p>

<p align="center">
  <a href="https://github.com/Skyfay/DBackup/actions/workflows/release.yml"><img src="https://github.com/Skyfay/DBackup/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://hub.docker.com/r/skyfay/dbackup"><img src="https://img.shields.io/docker/pulls/skyfay/dbackup?logo=docker&logoColor=white" alt="Docker Pulls"></a>
  <a href="https://codecov.io/gh/Skyfay/DBackup"><img src="https://img.shields.io/codecov/c/github/Skyfay/DBackup?label=coverage" alt="Coverage"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License"></a>
  <a href="https://discord.com/invite/YvgPyky"><img src="https://img.shields.io/discord/580801656707350529?label=Discord&color=%235865f2" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://dbackup.app">Website</a> •
  <a href="https://docs.dbackup.app">Documentation</a> •
  <a href="https://docs.dbackup.app/user-guide/getting-started">Quick Start</a> •
  <a href="https://api.dbackup.app">API Reference</a> •
  <a href="https://docs.dbackup.app/changelog">Changelog</a> •
  <a href="https://dbackup.app/roadmap">Roadmap</a>
</p>

<!-- Premium Sponsors ($500 a month): their logo at the very top, linking to their site. Kept by hand,
     uncomment and fill in, one link per sponsor:
<p align="center">
  <sub>🏆 Premium Sponsors · $500 a month</sub>
  <br>
  <a href="https://example.com"><img src="https://example.com/logo.svg" alt="Company" height="60"></a>
</p>
-->

<div align="center">
  <img src="https://raw.githubusercontent.com/Skyfay/DBackup/main/docs/public/readme-banner.png" alt="The DBackup overview on a desktop and a phone, with the databases it backs up" width="800">
</div>

### What is DBackup?

DBackup backs up your databases and the files that belong to them on a schedule, encrypts them and sends them to the storage you choose. A restore takes a few clicks. It runs as one Docker container and needs no agent on your servers: it connects to a database directly, or runs the backup tools on the server over SSH.

Nothing locks you in. Every database backup is a standard dump and every file backup a plain TAR archive, encrypted with open AES-256-GCM. The format is documented byte by byte, and the Recovery Kit restores a backup with a single Node.js script and your key, without DBackup.

## ✨ Highlights

- **Databases and files in one job** - the dumps and the directories of an application land in one archive and share a restore point
- **10 databases, direct or over SSH** - from MySQL and PostgreSQL to SQL Server, Redis and Firebird
- **13 kinds of storage** - S3 and S3-compatible, cloud drives, SFTP, SMB, WebDAV and more, with several destinations per job
- **Encrypted and open** - AES-256-GCM with managed keys and a Recovery Kit for offline decryption
- **Incremental backups and smart retention** - store only what changed, and keep daily, weekly, monthly and yearly backups
- **Restore what you need** - a whole database, a database under a new name, or a single file from a folder backup
- **Know what happens** - live progress, a history of every run, storage alerts and nine notification channels
- **Built for teams** - SSO through OIDC, groups with fine-grained permissions, 2FA and passkeys, an audit log and a REST API with scoped keys

## 🗄️ Supported

| Database | Versions | Connection | Restore |
| :--- | :--- | :--- | :--- |
| PostgreSQL | 12 to 18 | Direct, SSH | Yes |
| MySQL | 5.7, 8.x, 9.x | Direct, SSH | Yes |
| MariaDB | 10.x, 11.x | Direct, SSH | Yes |
| MongoDB | 4.x to 8.x | Direct, SSH | Yes |
| Redis | 2.8+ | Direct, SSH | Guided |
| Valkey | 7.2+ | Direct, SSH | Guided |
| SQLite | 3.x | Local, SSH | Yes |
| Microsoft SQL Server | 2017, 2019, 2022, Azure SQL Edge | Direct, SSH | Yes |
| Azure SQL Database (beta) | Single database, elastic pool | Direct | Yes, drops the target first |
| Firebird (beta) | 3.x, 4.x, 5.x | Direct, SSH | Yes, through configured aliases |

**Destinations**: local filesystem, Amazon S3 and S3-compatible storage like Cloudflare R2, Hetzner, MinIO or Wasabi, Google Drive, Dropbox, OneDrive, SFTP, FTP/FTPS, WebDAV, SMB and rsync over SSH. Each of them can also be a source for file backups, and so can Docker volumes.

**Notifications**: Discord, Slack, Microsoft Teams, Telegram, Gotify, ntfy, webhooks, SMS through Twilio and email.

Every one of them has a setup guide in the [documentation](https://docs.dbackup.app).

## 🚀 Quick Start

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
    volumes:
      - ./data:/data          # All persistent data
      - ./backups:/backups    # Optional, for local backups
```

```bash
docker compose up -d
```

Open [https://localhost:3000](https://localhost:3000) and create the admin account. The first visit warns about the self-signed certificate. The [installation guide](https://docs.dbackup.app/user-guide/installation) covers every environment variable, reverse proxies and updates. Images are built for AMD64 and ARM64.

## 💖 Sponsors

DBackup is free and open source. [Sponsoring it](https://github.com/sponsors/Skyfay) keeps it that way, and from $15 a month or $100 once your name shows up here by itself.

<!-- Company Sponsors ($150 a month): their logo shown large, linking to their site. Kept by hand,
     uncomment and fill in, one link per sponsor:
<p align="center">
  <strong>🏢 Company Sponsors</strong> · $150 a month
  <br><br>
  <a href="https://example.com"><img src="https://example.com/logo.svg" alt="Company" height="80"></a>
</p>
-->

<p align="center">
  <a href="https://github.com/sponsors/Skyfay">
    <img src="https://raw.githubusercontent.com/Skyfay/DBackup/sponsors/sponsors.svg" alt="The monthly sponsors of DBackup" width="800">
  </a>
</p>

### One-time Sponsors

<!-- Patrons ($500 once): the image below draws them with their avatar. Kay sponsored while this
     tier still came with a logo, so his stays here by hand and the image leaves him out. -->
<p align="center">
  <strong>🏆 Patrons</strong> · $500 once
  <br><br>
  <a href="https://www.ictwebsolution.nl"><img src="https://ictwebsolution.nl/wp-content/uploads/2021/05/Logo-ICTWebSolution.png" alt="ICT WebSolution" height="60"></a>
  <br>
  <a href="https://www.ictwebsolution.nl"><sub>Kay van Aarssen</sub></a>
</p>

<p align="center">
  <a href="https://github.com/sponsors/Skyfay">
    <img src="https://raw.githubusercontent.com/Skyfay/DBackup/sponsors/sponsors-onetime.svg" alt="The one-time sponsors of DBackup" width="800">
  </a>
</p>

## 🛠️ Contributing

Pull requests go into the `dev` branch, never into `main`. [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup and the workflow, and the [Developer Guide](https://docs.dbackup.app/developer-guide/) the architecture, the adapters and the tests.

## 💬 Community & Support

- 💬 **Discord**: [dc.skyfay.ch](https://dc.skyfay.ch)
- 🐛 **Issues**: bugs and feature requests on [GitHub Issues](https://github.com/Skyfay/DBackup/issues)
- 📧 **Support**: [support@dbackup.app](mailto:support@dbackup.app)
- 🔒 **Security**: report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), never in a public issue

## 🤖 AI Development Transparency

The architecture, the technology stack and the feature specifications of DBackup were designed and directed by a human system engineer. The code is written by AI coding agents that follow those specifications and the guidelines of the project. Every feature is tested by hand, backed by unit and integration tests and static security audits.

A manual security audit by an external developer has not been done yet. If you review code or work in security, your findings are very welcome, see [SECURITY.md](SECURITY.md) for how to report them.

## 📝 License

[GNU General Public License v3.0](LICENSE)
