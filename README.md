# DBackup

> **⚠️ Work in Progress**: This project is currently under active development. There is no stable release available yet. Use at your own risk.
> Check out [TODO](docs/todo/features.md) to see the roadmap and pending tasks.

> **Note**: This project is primarily developed on GitLab. This GitHub repository is a mirror.
> **Main Repository**: [https://gitlab.com/Skyfay/database-backup-manager](https://gitlab.com/Skyfay/database-backup-manager)

DBackup is a robust, self-hosted solution for automating database backups. Manage sources, destinations, and backup schedules through a modern web interface.

![Dashboard Preview](docs/images/overview.png)

## 🚀 Features

- **Multi-Database Support**: Backup **MySQL**, **PostgreSQL**, **MongoDB**, **SQLite** (Local & via SSH), and **Microsoft SQL Server**.
- **Bank-Grade Security**:
  - **Encryption Vault**: Secure your backups with **AES-256-GCM** encryption.
  - **Encryption Profiles**: Manage multiple keys and rotate secrets easily.
  - **Recovery Kits**: Download standalone, offline decryption tools to ensure you can always recover your data, even without this application.
- **Storage Optimization**: Built-in **GZIP** and **Brotli** compression to save storage space and bandwidth.
- **Flexible Storage**: Store backups on the **Local Filesystem**, **S3 Storage**, and **SFTP**. (Cloud Providers, SMB/CIFS, and FTP coming soon)
- **Automated Scheduling**: Configure cron-based backup schedules for your jobs.
- **Live Activity Monitoring**: Watch backup and restore processes in real-time with detailed step-by-step logs and visual progress bars.
- **Granular Access Control**: Define custom user groups with precise permissions for every resource and action (RBAC).
- **Notifications**: Get alerts via **Discord** or **Email** when backups succeed or fail.
- **Restore & Management**: Browse backup history, view logs, and restore databases directly from the UI.
- **System Self-Backup**: Automated backup of the application's configuration (Jobs, Users, Credentials) to ensure complete disaster recovery.
- **Health Check**: Health check for databases and storage destinations.
- **Modern Dashboard**: Built with Next.js 16, Shadcn UI, and Tailwind CSS.
## 🗄️ Supported Databases

| Database | Supported Versions |
| :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 |
| **MySQL** | 5.7, 8, 9 |
| **MariaDB** | 10, 11 |
| **MongoDB** | 4, 5, 6, 7, 8 |
| **SQLite** | 3.x (Local & SSH) |
| **Microsoft SQL Server** | 2017, 2019, 2022, Azure SQL Edge |

> For detailed technical information about client versions and extensive compatibility notes, please refer to our [Supported Database Versions Documentation](docs/development/supported-database-versions.md).
## 🐳 Deployment (Docker)

You can easily deploy the application using Docker. The application is in beta, so there may be bugs!

### Docker Compose (Recommended)

View the latest [docker-compose.yml](docker-compose.yml) in the repository.

```yaml
services:
  app:
    image: registry.gitlab.com/skyfay/database-backup-manager:beta
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=file:/app/db/prod.db
      - ENCRYPTION_KEY= # openssl rand -hex 32
      - BETTER_AUTH_URL=http://localhost:3000
      - BETTER_AUTH_SECRET= # openssl rand -base64 32
    volumes:
      # Persist local backups
      - ./backups:/backups # use /backups as local adapter path in the application
      # Persist SQLite DB in a dedicated folder
      - ./app/db:/app/db
      # Persist Uploads/Avatars
      - ./app/storage:/app/storage
```

### Docker Run

Alternatively, you can run the container directly using `docker run`:

```bash
docker run -d \
  --name backup-manager \
  --restart always \
  -p 3000:3000 \
  -e DATABASE_URL="file:/app/db/prod.db" \
  -e ENCRYPTION_KEY="your-32-byte-hex-key" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  -e BETTER_AUTH_SECRET="your-base64-secret" \
  -v "$(pwd)/backups:/backups" \
  -v "$(pwd)/db-data:/app/db" \
  -v "$(pwd)/storage:/app/storage" \
  registry.gitlab.com/skyfay/database-backup-manager:beta
```
## �🛠️ Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org) (App Router)
- **Database**: SQLite (via Prisma ORM) for application state
- **UI Components**: [shadcn/ui](https://ui.shadcn.com)
- **Styling**: Tailwind CSS
- **Scheduler**: Custom Node-based scheduler
- **Streaming**: Native Node.js streams for efficient, low-memory piping of encryption and compression.
## 📦 Getting Started

### Prerequisites

- Node.js (v18+)
- Package manager (`pnpm`)
- Docker (optional, for running test databases)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://gitlab.com/Skyfay/database-backup-manager.git
   cd database-backup-manager
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Configure Environment**
   Set up your `.env` file containing your database configuration and app secrets.
   ```bash
   # Example
   DATABASE_URL="file:./dev.db"

   # Better Auth Configuration
   BETTER_AUTH_SECRET="your-super-secret-key-here"
   BETTER_AUTH_URL="http://localhost:3000" # Set to your domain in production

   # System Encryption Key (AES-256-GCM)
   # Allows encryption of sensitive DB connections and wraps your Backup Vault keys.
   ENCRYPTION_KEY="your-64-char-hex-key-here"
   ```

   > **Tip**: You can generate secure secrets using `openssl`:
   > ```bash
   > # For BETTER_AUTH_SECRET
   > openssl rand -base64 32
   >
   > # For ENCRYPTION_KEY (Required: 32 bytes as hex string)
   > openssl rand -hex 32
   > ```

4. **Initialize Database**
   Push the schema to your local database:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

## 👨‍💻 Development

Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) with your browser to see the dashboard.

> **Note**: You must create the first user account manually via the login screen ("Sign Up"). This self-registration feature is only available for the very first user to establish the administrator account.

## 🐳 Testing Infrastructure

To spin up test instances of MySQL, Postgres, and MongoDB for development:

```bash
docker-compose -f docker-compose.test.yml up -d
```

If you want to add the test containers to the Database use the following command:

```bash
pnpm test:ui
```

## 📦 Release Preparation

Before creating a release tag, verify that the application builds successfully:

Unit tests:
```bash
pnpm run test
```

Type checking:
```bash
pnpm run type-check
```

Linting:
```bash
pnpm run lint
```

Build:
```bash
pnpm run build
```

If you make changes to the database schema (`prisma/schema.prisma`), you must create a new migration before creating a release tag. This ensures that the production database is updated correctly.

```bash
# 1. Update schema.prisma
# 2. Create a new migration (this also generates your local client)
npx prisma migrate dev --name describe_your_changes

# 3. Commit the new migration folder
git add prisma/migrations
git commit -m "chore: add db migration for feature xyz"
```

## � Gallery

### Backup Jobs
![Jobs](docs/images/jobs.png)

### Storage Explorer
![Storage](docs/images/storage-explorer.png)

### Execution History
![History](docs/images/history.png)

### Encryption Vault
![Vault](docs/images/vault.png)

### Group Permissions
![Permissions](docs/images/group-permission.png)

### Configuration
<img src="docs/images/edit-configuration.png" width="400" alt="Configuration" />

### User Profile
![Profile](docs/images/profile.png)

### Light Mode
![Light Mode](docs/images/dashboard-light-theme.png)

### Security Settings
![Security](docs/images/security.png)
## 🤖 AI Development Transparency

This project is developed with the assistance of advanced AI coding agents. While AI is used to accelerate development and generate code structures, we adhere to strict engineering standards to ensure quality and security:

- **Human Review**: All AI-generated code undergoes manual review to verify logic, maintainability, and architectural alignment.
- **Security-First Approach**: We implement rigorous access controls (RBAC), encryption standards (AES-256-GCM), and security audits.
- **Testing Culture**: The reliability of the code is backed by a comprehensive suite of unit and integration tests (Vitest).
- **Modern Practices**: We follow current best practices for the generic tech stack (Next.js, TypeScript, Docker) to avoid "hallucinated" or deprecated patterns.

Users can rely on this software being built with a focus on stability and security, leveraging AI as a productivity tool rather than a replacement for engineering oversight.
## �📝 License

[GNU GENERAL PUBLIC LICENSE](LICENSE)
