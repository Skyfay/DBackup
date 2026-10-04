# Developer Guide

Welcome to the DBackup Developer Guide. This section covers architecture, contribution guidelines, and how to extend the application.

## Overview

DBackup is built with:

- **Frontend**: Next.js 16 (App Router), React, TypeScript
- **UI Components**: [Shadcn UI](https://ui.shadcn.com)
- **Styling**: Tailwind CSS
- **Database**: SQLite via Prisma ORM
- **Authentication**: better-auth

## Project Structure

```
src/
├── app/              # Next.js App Router
│   ├── actions/      # Server Actions
│   ├── api/          # API routes
│   └── dashboard/    # Dashboard pages
├── components/       # React components
├── lib/
│   ├── adapters/     # Database, Storage, Notification adapters
│   ├── core/         # Interfaces and types
│   └── runner/       # Backup execution pipeline
└── services/         # Business logic layer
```

## Quick Start

### Prerequisites

- Node.js 24
- pnpm 10
- Docker (for testing)

### Setup

```bash
# Clone repository
git clone https://github.com/Skyfay/DBackup.git
cd DBackup

# Work from dev, which holds everything finished since the last release
git checkout dev

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start development server, which applies the database migrations first
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Testing

```bash
# Start test databases
docker-compose -f docker-compose.test.yml up -d

# Run unit tests
pnpm test

# Run integration tests
pnpm test:integration

# Seed test data for UI testing
pnpm test:ui
```

## Architecture Principles

### Four-Layer Architecture

1. **App Router** (`src/app`) - Route definitions only
2. **Service Layer** (`src/services`) - Business logic
3. **Adapter System** (`src/lib/adapters`) - External integrations
4. **Runner Pipeline** (`src/lib/runner`) - Backup execution

### Key Rules

- **Server Actions delegate to Services** - No business logic in actions
- **Adapters are pluggable** - Follow interface contracts
- **Streaming architecture** - Efficient memory usage
- **SSH exec over tunneling** - Database tools run remotely via SSH, output streams back
- **Permission checks everywhere** - RBAC enforcement

## Contributing

### Branches and Pull Requests

| Branch | What it holds |
| :--- | :--- |
| `main` | The released code. Each release merges `dev` into `main` and is tagged `vX.Y.Z` |
| `dev` | Everything that is finished, waiting for the next release |
| Feature branches | One feature or fix each, branched off `dev` |

Pull requests go into `dev`, never into `main`. Only the maintainer merges `dev` into `main` for a release.

```bash
git checkout dev
git pull
git checkout -b feat/short-description
# ... commit your work
git push -u origin feat/short-description
# then open the pull request with dev as its base
```

Every pull request into `dev` or `main` runs lint, type check, unit tests and the docs build.

### Code Style

- TypeScript strict mode
- ESLint configuration
- kebab-case file names

### PR Guidelines

1. Create a feature branch off `dev`
2. Write tests for new features
3. Update documentation
4. Run `pnpm validate` and `pnpm run build` before submitting
5. Open the pull request against `dev`

Security vulnerabilities are never reported in a pull request or an issue. See [SECURITY.md](https://github.com/Skyfay/DBackup/blob/main/SECURITY.md).

### Commit Messages

Follow conventional commits:
```
feat: add MongoDB adapter
fix: correct retention calculation
docs: update API documentation
```

## Key Documentation

- [Architecture](/developer-guide/architecture) - System design details
- [Adapter System](/developer-guide/core/adapters) - How adapters work
- [Runner Pipeline](/developer-guide/core/runner) - Backup execution flow
- [Icon System](/developer-guide/core/icons) - Iconify icon mapping for adapters
- [Logging System](/developer-guide/core/logging) - System logger, custom errors, execution logs
- [Download Tokens](/developer-guide/core/download-tokens) - Temporary download links for wget/curl
- [Checksum & Integrity](/developer-guide/core/runner#checksum-verification) - SHA-256 verification throughout the backup lifecycle
- [Testing Guide](/developer-guide/reference/testing) - Writing tests

## Package Manager

Always use `pnpm`:
```bash
pnpm install
pnpm add package-name
pnpm test
```

## Environment Variables

See **[Environment Reference](/developer-guide/reference/environment)** for all variables and **[Installation Guide](/user-guide/installation)** for Docker setup.
