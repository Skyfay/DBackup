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
# Run unit tests
pnpm test

# Start the dev lab and fill the dev database with it, see Dev Lab
pnpm lab:up && pnpm lab:seed
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

### Releasing

Only the maintainer releases, from an up to date `dev`. `pnpm toolbox` lists every command used here in one menu, each also runs on its own:

1. `pnpm version:bump` checks the changelog fragments and asks GitHub for the CodeQL alerts open on `dev` that `main` does not have. While one is open, it asks whether to go on. Then it picks the next version, writes its block into `docs/changelog.md` and sets the version everywhere. `pnpm codeql:check` runs the CodeQL part on its own.
2. Replace `*Release: In Progress*` with `*Released: <date>*`, commit, push `dev` and open the pull request from `dev` into `main`. Merge it with a merge commit, not a squash, so both branches keep their history. A change that still belongs to the release after the bump gets its fragment as usual, and `pnpm changelog:amend` adds it to the block.
3. `pnpm release:tag` proposes the tag of the version on `main`, with the title from the changelog as its message, and pushes it once you confirm. The tag starts the release workflow. `pnpm release:untag` deletes a tag here and on GitHub, so a release that failed can be tagged again.

The release workflow makes the notes of the GitHub release first, with `pnpm changelog:notes <tag>`, and stops before it builds an image when a tag has none.

### Beta Releases

A beta previews the next release on `dev`, before it goes into `main`. It gets a version of its own, like `4.1.0-beta.1`, but no block in the changelog: the fragments stay in `changelog/unreleased/` until the release, which writes the one block from them as usual. A fix between two betas edits or adds a fragment like any other change.

1. `pnpm version:bump beta` sets the next beta: `4.1.0-beta.1` after `4.0.2`, `4.1.0-beta.2` after it. `pnpm version:bump beta major` starts the betas of the next major version. It checks the fragments and the CodeQL alerts like a release, and sets the version everywhere without touching the changelog. It refuses a beta of a version that is out already and one without fragments.
2. Commit, push `dev`, then `pnpm release:tag dev` tags the version `dev` is at, with a message like `v4.1.0-beta.1 - Beta of v4.1.0`, and pushes it once you confirm. A beta is never tagged on `main`, and `pnpm release:tag` refuses a beta version there.
3. The release workflow runs the end-to-end tests, which a release skips since its pull request into `main` ran them. It publishes the images as `v4.1.0-beta.1` and `beta`, never as `latest` or `v4`, and keeps the CI image and the README on Docker Hub of the last release. The GitHub release is a pre-release whose notes come from the fragments: what is new since the beta before it, then everything since the last release.
4. Once the betas are done, `pnpm version:bump release` (or **Release** in its menu) takes `4.1.0-beta.2` to `4.1.0` and writes the block of the changelog from the fragments. From there the release goes on with step 2 above.

Every suffix counts as a preview, but only `beta.N` is counted up, and the update notice of an instance on a beta offers the newer betas and the release, compared by their numbers. An instance on a release never sees a beta.

A migration that shipped in a beta never changes again, since instances on the beta applied it already. A change to its tables goes into a new migration.

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
