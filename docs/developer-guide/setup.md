# Project Setup

Complete guide to setting up DBackup for development.

## Prerequisites

### Required

- **Node.js** 24, the version CI and the Docker image use, pinned in `.node-version`
- **pnpm** 10
- **Git**

### For Testing

- **Docker** and **Docker Compose**
- **Database CLI tools**:
  - `mysql` / `mysqldump` (MySQL/MariaDB)
  - `psql` / `pg_dump` (PostgreSQL)
  - `mongodump` / `mongorestore` (MongoDB)
  - `gbak` / `isql` (Firebird)
  - `sqlpackage` (Azure SQL Database)

Use the setup script for your platform rather than installing these by hand. Several of them have non-obvious requirements that a plain `brew install` gets wrong.

### macOS Installation

```bash
# Node 24 through fnm, the version in .node-version
brew install fnm
eval "$(fnm env --use-on-cd)"
fnm install 24
fnm default 24
npm install -g pnpm

# Installs every CLI tool the adapters need, and prints the PATH lines to add
./scripts/setup-dev-macos.sh
```

A plain `brew install node` would give you the newest Node instead, which is not the one CI and the image use. Add these lines to `~/.zshrc`. The first one lets fnm switch to the version in `.node-version` whenever you enter the project. The script prints the second one too, but it is easy to skip past:

```bash
eval "$(fnm env --use-on-cd)"
export PATH="/opt/homebrew/opt/mysql-client/bin:/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:/opt/homebrew/firebird-client/bin:$PATH"
```

SqlPackage needs no entry of its own. The script installs it into `$(brew --prefix)/bin`, which is already on `PATH`, and wraps it so it finds the .NET runtime without a `DOTNET_ROOT` variable.

::: warning Do not install `libpq` for PostgreSQL
`libpq` ships a `pg_dump` compiled without LZ4 and ZSTD support. If its directory comes first on `PATH`, PostgreSQL backups with native compression fail. Install the full `postgresql@XX` packages instead, which the script does.
:::

::: tip Restart the dev server after changing PATH
A running `pnpm dev` inherited its environment at launch, and an editor-launched terminal often carries a different one than your login shell. If an adapter reports a missing CLI tool that works in your terminal, this is almost always why.
:::

### Ubuntu/Debian Installation

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm

# Installs every CLI tool, including SqlPackage, and prints a summary of what resolved
sudo ./scripts/setup-dev-debian.sh
```

## Clone and Install

```bash
# Clone repository
git clone https://github.com/Skyfay/DBackup.git
cd DBackup

# Work from dev, which holds everything finished since the last release
git checkout dev

# Install dependencies
pnpm install
```

New work happens on a branch off `dev`, and its pull request goes back into `dev`, never into `main`. See [Branches and pull requests](/developer-guide/#branches-and-pull-requests).

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
