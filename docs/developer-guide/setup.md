# Project Setup

Complete guide to setting up DBackup for development.

## Prerequisites

### Required

- **Node.js** 20 or higher
- **pnpm** (package manager)
- **Git**

### For Testing

- **Docker** and **Docker Compose**
- **Database CLI tools**:
  - `mysql` / `mysqldump` (MySQL/MariaDB)
  - `psql` / `pg_dump` (PostgreSQL)
  - `mongodump` / `mongorestore` (MongoDB)
  - `gbak` / `isql` (Firebird) - see [`scripts/setup-dev-macos.sh`](https://github.com/Skyfay/DBackup/blob/main/scripts/setup-dev-macos.sh) for a scripted macOS install (no Homebrew formula exists)

### macOS Installation

```bash
# Install Node.js via Homebrew
brew install node

# Install pnpm
npm install -g pnpm

# Install database CLI tools
brew install mysql-client libpq mongodb-database-tools

# Add to PATH (add to ~/.zshrc)
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
```

### Ubuntu/Debian Installation

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install database CLI tools
sudo apt-get install mysql-client postgresql-client mongodb-database-tools
```

## Clone and Install

```bash
# Clone repository
git clone https://github.com/Skyfay/DBackup.git
cd DBackup

# Install dependencies
pnpm install
```

## Environment Configuration

```bash
# Copy example configuration
cp .env.example .env
```

Edit `.env` with your settings:

```ini
# Database
DATABASE_URL="file:./data/database.db"

# Encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY="your-32-byte-hex-key"

# Authentication
BETTER_AUTH_SECRET="your-auth-secret"
BETTER_AUTH_URL="http://localhost:3000"

# Optional: Timezone
TZ="Europe/Berlin"
```

### Generate Encryption Key

```bash
# macOS/Linux
openssl rand -hex 32
```

## Database Setup

The dev server handles migrations automatically. `pnpm dev` runs `prisma migrate deploy` on every startup, so the local database is always in sync with the schema - no manual step needed after pulling changes.

```bash
# Start the dev server — migrations apply automatically
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

::: danger Never use `prisma db push`
`prisma db push` applies schema changes without creating a migration file. This causes the local `_prisma_migrations` table to diverge from the actual schema, breaking `database:deploy` in production and for every other developer. Always use `prisma migrate dev` to create a proper migration instead.
:::

::: warning Schema changes require a stopped dev server
Never run `prisma migrate dev` while `pnpm dev` is running. The dev server holds an open SQLite connection. `migrate dev` can trigger an interactive DB reset (on schema drift), which conflicts with the file lock and crashes the Node process.

**Safe workflow for schema changes:**
1. Stop the dev server (`Ctrl+C`)
2. `npx prisma migrate dev --name <migration-name>`
3. Restart `pnpm dev` - the new migration applies automatically on startup
:::

## Test Database Setup

For integration testing, start the test database containers:

```bash
# Start test databases
docker-compose -f docker-compose.test.yml up -d
```

This starts:
- **MySQL 8.0** on port 3306
- **PostgreSQL 15** on port 5432
- **MongoDB 6.0** on port 27017

### Test Database Credentials

| Database | Host | Port | User | Password |
| :--- | :--- | :--- | :--- | :--- |
| MySQL | localhost | 3306 | root | rootpassword |
| PostgreSQL | localhost | 5432 | testuser | testpassword |
| MongoDB | localhost | 27017 | - | - |

## Running Tests

```bash
# Run unit tests
pnpm test

# Run integration tests (requires test containers)
pnpm test:integration

# Seed test data for UI testing
pnpm test:ui
```

## Useful Commands

### Prisma

```bash
# Open database GUI
npx prisma studio

# Create a new migration (stop pnpm dev first!)
npx prisma migrate dev --name <description>

# Reset dev database from scratch (drops + recreates via all migrations)
pnpm run database:reset
```

::: warning
Always stop `pnpm dev` before running `prisma migrate dev`. See [Database Setup](#database-setup) for the full safe workflow.
:::

### Development

```bash
# Start development server
pnpm dev

# Build for production
pnpm run build

# Start production server
pnpm start

# Lint code
pnpm lint
```

## IDE Setup

### VS Code

Recommended extensions:
- ESLint
- Prettier
- Prisma
- Tailwind CSS IntelliSense

### Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Database Connection Issues

```bash
# Check if containers are running
docker ps

# View container logs
docker logs dbackup-mysql-test
```

### CLI Tools Not Found

Ensure database CLI tools are in your PATH:

```bash
# Verify installation
which mysqldump
which pg_dump
which mongodump
```

## Next Steps

- [Architecture](/developer-guide/architecture) - Understand the system design
- [Service Layer](/developer-guide/core/services) - Learn about business logic
- [Adapter System](/developer-guide/core/adapters) - How to extend DBackup
