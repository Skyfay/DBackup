# Contributing to DBackup

Contributions are welcome! Before submitting a pull request, please:

1. Check existing issues and discussions to avoid duplicates
2. For significant changes, open an issue first to discuss the approach
3. More information can be found in the [Developer Guide](https://docs.dbackup.app/developer-guide/) for setup instructions

Small fixes (language translations, typos, documentation improvements) can be submitted directly as PRs.

## Branches

| Branch | What it holds |
| :--- | :--- |
| `main` | The released code. Each release merges `dev` into `main` and is tagged `vX.Y.Z` |
| `dev` | Everything that is finished, waiting for the next release |
| Feature branches | One feature or fix each, branched off `dev` |

**Pull requests go into `dev`, never into `main`.** Branch off `dev`, and open the pull request against `dev`. Only the maintainer merges `dev` into `main` for a release.

## Development Setup

### Prerequisites

- Node.js 24, the version CI and the Docker image use
- pnpm 10
- Docker (for integration tests)

### Getting Started

```bash
git clone https://github.com/Skyfay/DBackup.git
cd DBackup
git checkout dev
pnpm install
cp .env.example .env  # Edit with your secrets
pnpm dev              # Applies pending DB migrations automatically on startup
```

This starts the Next.js development server at `http://localhost:3000`.

Start your work on a branch of its own:

```bash
git checkout -b fix/short-description dev
```

Working from a fork, add this repository as `upstream` and branch off `upstream/dev`, so your branch starts from the newest state.

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
pnpm validate           # Lint, type check and unit tests
pnpm test               # Run unit tests (vitest)
pnpm test:integration   # Run integration tests against real DB containers
pnpm lint               # Run linters
pnpm type               # Run TypeScript type checks
```

## Guidelines

### Code

- Write TypeScript, no `any` unless absolutely necessary
- Keep functions small and focused
- No unnecessary abstractions - if it is used once, inline it
- Follow the 4-layer architecture: App Router → Services → Adapters → Runner
- Services live in domain subdirectories under `src/services/` (e.g., `backup/`, `restore/`, `auth/`, `system/`)

### Commits

- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- Keep commits focused on a single change

### Pull Requests

- Open it against `dev`. A pull request against `main` is retargeted or closed
- One feature/fix per PR
- Include tests for new functionality
- Update documentation if relevant
- Write the changelog entry into a file of its own under `changelog/unreleased/`, named after your branch, never into `docs/changelog.md`. The release collects those files, see [changelog/unreleased/README.md](changelog/unreleased/README.md)
- Ensure all CI checks pass. Every pull request into `dev` or `main` runs lint, type check, unit tests and the docs build

## Security

If you discover a security vulnerability, **do not** open a public issue or pull request. See [SECURITY.md](SECURITY.md) for how to report it privately.