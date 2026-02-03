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

- Node.js 20+
- pnpm
- Docker (for testing)

### Setup

```bash
# Clone repository
git clone https://gitlab.com/Skyfay/dbackup.git
cd dbackup

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Initialize database
npx prisma db push
npx prisma generate

# Start development server
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
- **Permission checks everywhere** - RBAC enforcement

## Contributing

### Code Style

- TypeScript strict mode
- ESLint configuration
- Prettier formatting
- kebab-case file names

### PR Guidelines

1. Create feature branch
2. Write tests for new features
3. Update documentation
4. Run `pnpm run build` before submitting

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
- [Download Tokens](/developer-guide/core/download-tokens) - Temporary download links for wget/curl
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
