# Database Backup Manager

> **⚠️ Work in Progress**: This project is currently under active development. There is no stable release available yet. Use at your own risk.
> Check out [TODO](docs/todo/features.md) to see the roadmap and pending tasks.

> **Note**: This project is primarily developed on GitLab. This GitHub repository is a mirror.
> **Main Repository**: [https://gitlab.com/Skyfay/database-backup-manager](https://gitlab.com/Skyfay/database-backup-manager)

A robust, self-hosted solution for automating database backups. Manage sources, destinations, and backup schedules through a modern web interface.

![Dashboard Preview](docs/images/overview.png)

## 🚀 Features

- **Multi-Database Support**: Backup **MySQL**, **PostgreSQL**, and **MongoDB**. (Local SQLite & MSSQL coming soon)
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
- **Health Check**: Health check for databases and storage destinations.
- **Modern Dashboard**: Built with Next.js 16, Shadcn UI, and Tailwind CSS.
## 🗄️ Supported Databases

| Database | Supported Versions |
| :--- | :--- |
| **PostgreSQL** | 12, 13, 14, 15, 16, 17, 18 |
| **MySQL** | 5.7, 8, 9 |
| **MariaDB** | 10, 11 |
| **MongoDB** | 4, 5, 6, 7, 8 |

> For detailed technical information about client versions and extensive compatibility notes, please refer to our [Supported Database Versions Documentation](docs/development/supported-database-versions.md).
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

## �📝 License

[GNU GENERAL PUBLIC LICENSE](LICENSE)
