# Contributing to DBackup

Contributions are welcome! Before submitting a pull request, please:

1. Check existing issues and discussions to avoid duplicates
2. For significant changes, open an issue first to discuss the approach
3. More information can be found in the [Developer Guide](https://docs.dbackup.app/developer-guide/) for setup instructions

Small fixes (language translations, typos, documentation improvements) can be submitted directly as PRs.

## Development Setup

### Prerequisites

- Node.js 20 LTS or later
- pnpm 9 or later
- Docker (for integration tests)

### Getting Started

```bash
git clone https://github.com/skyfay/dbackup.git
cd dbackup
pnpm install
npx prisma db push
cp .env.example .env  # Edit with your secrets
pnpm dev
```

This starts the Next.js development server at `http://localhost:3000`.

### Project Structure

```
src/
  app/         # Next.js App Router (pages, Server Actions, API routes)
  components/  # Shared UI components (Shadcn UI)
  lib/         # Core logic: adapters, runner pipeline, auth, crypto
  services/    # Business logic layer
  hooks/       # React hooks
prisma/        # Database schema and migrations (SQLite)
tests/         # Unit and integration tests
docs/          # VitePress documentation
```

### Commands

```bash
pnpm dev                # Start development server
pnpm build              # Production build
pnpm validate           # Run all tests (unit, lint, typecheck)
pnpm test               # Run unit tests (vitest)
pnpm test:integration   # Run integration tests against real DB containers
pnpm lint               # Run linters
pnpm typecheck          # Run TypeScript type checks
```

## Guidelines

### Code

- Write TypeScript, no `any` unless absolutely necessary
- Keep functions small and focused
- No unnecessary abstractions - if it is used once, inline it
- Follow the 4-layer architecture: App Router → Services → Adapters → Runner

### Commits

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- Keep commits focused on a single change

### Pull Requests

- One feature/fix per PR
- Include tests for new functionality
- Update documentation if relevant
- Ensure all CI checks pass

## Security

If you discover a security vulnerability, **do not** open a public issue. Instead, please report it responsibly by contacting the maintainer directly.