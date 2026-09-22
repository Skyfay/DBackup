# DBackup

Self-hosted web app for automating database and file backups with encryption, compression, and retention policies. Built with **Next.js 16 (App Router)**, **TypeScript**, **Prisma** (SQLite), and **Shadcn UI**.

Supported sources include MySQL, PostgreSQL, MongoDB, MariaDB, SQLite, MSSQL, Redis, and Valkey. The adapter lists grow frequently. Never treat a hardcoded adapter list in any doc as exhaustive - run `ls src/lib/adapters/{database,storage,notification}/` for the authoritative list before making claims about supported adapters.

## Guide map

Claude Code loads the nearest `CLAUDE.md` when you touch files in a directory. Read the matching guide before working in that area:

| Working on | Guide |
| :--- | :--- |
| Services, Server Actions, API routes, runner pipeline | [src/CLAUDE.md](src/CLAUDE.md) |
| UI components and the design system | [src/components/CLAUDE.md](src/components/CLAUDE.md) |
| Dashboard pages and the look of the UI redesign | [src/app/dashboard/CLAUDE.md](src/app/dashboard/CLAUDE.md) |
| Database, storage, or notification adapters | [src/lib/adapters/CLAUDE.md](src/lib/adapters/CLAUDE.md) |
| Wiki pages and the changelog | [docs/CLAUDE.md](docs/CLAUDE.md) |
| Unit and integration tests | [tests/CLAUDE.md](tests/CLAUDE.md) |

## Non-negotiable rules

1. **Package manager is `pnpm`.** Never `npm install` or `yarn`. Prisma CLI calls go through `npx prisma ...`.
2. **Never use `console.log` / `console.error` / `console.warn`.** Use the logger from `@/lib/logging/logger`. This holds in Client Components too.
3. **Every change updates `docs/changelog.md`** in the same response, except AI tooling changes. See [Changelog workflow](#changelog-workflow).
4. **Typography**: no em dashes, no semicolons. Use a hyphen where a dash is needed, and end sentences with a period. Applies to code comments, docs, and commit messages.
5. **Language**: all code, comments, and documentation in English.
6. **Never run `prisma migrate dev` while `pnpm dev` is running**, and never use `prisma db push`. See [Prisma migrations](#prisma-migrations).
7. **Every Server Action and API route starts with a permission check.** See [src/CLAUDE.md](src/CLAUDE.md).
8. **Never run `git commit`, `git push`, or `git merge`.** The maintainer commits everything himself. Finish the work, run `pnpm validate`, leave the files in the working tree, and report what changed. This holds even when a plan, a task list, or your own earlier message says "one commit per step" - a plan you wrote is not permission. Never add a `Co-Authored-By` trailer for an AI tool. If a commit was already created by mistake, undo it with `git reset --soft HEAD~1` so the work stays staged, and never force-push to fix it without asking first.

## Architecture (4 layers)

```
src/app/          Route definitions and Server Actions - NO business logic
src/services/     All business logic, organized by domain          <- core
src/lib/adapters/ Plugin system for databases, storage, notifications
src/lib/runner/   Step-based backup execution pipeline
```

Data flows one direction: `page.tsx` (Server Component) fetches through a Service, then passes props to a Client Component. Server Actions are thin wrappers: auth check, Zod validation, service call, revalidate.

A Server Action or API route that contains business logic is a bug. Move it into `src/services/`.

## Commands

```bash
pnpm dev                  # Dev server - auto-applies pending migrations on startup
pnpm run build            # Production build - run before committing
pnpm validate             # Lint + typecheck + build (scripts/validate.sh)
pnpm type                 # tsc --noEmit only
pnpm test                 # Unit tests (vitest)
pnpm test:integration     # Integration tests against real DB containers
pnpm test:ui              # Spin up test DBs + seed local DB for manual testing
pnpm run database:reset   # Reset dev DB from scratch via all migrations
pnpm changelog:next       # Create a `## vNEXT` changelog placeholder
```

Docs site and marketing site are separate workspaces: `pnpm docs:dev` (VitePress) and `pnpm website:dev`.

### Prisma migrations

`pnpm dev` runs `prisma migrate deploy` on startup, so the local DB is always current after pulling. No manual step needed.

**Schema changes:**
1. Stop the dev server (Ctrl+C in the node terminal).
2. `npx prisma migrate dev --name <migration-name>`
3. Restart `pnpm dev`.

Running `migrate dev` against a live dev server can trigger an interactive DB reset, which fights the SQLite file lock and crashes the Node process - often taking VS Code with it. `prisma db push` applies schema changes without a migration file, which desyncs `_prisma_migrations` from the real schema and breaks `database:deploy` in production and for other developers.

## Changelog workflow

Every change - feature, bug fix, refactor, docs, CI - gets an entry in `docs/changelog.md` in the same response. Do not defer it.

**Exception: AI tooling changes never get a changelog entry.** The changelog is published on the docs site for people who run DBackup. Anything that only configures the assistant is invisible to them:

- `CLAUDE.md` files anywhere in the tree
- `.claude/` in full - agents, skills, commands, settings, launch config
- `.gitignore` rules that only exist to track those files

The test is who the line is for. A reader upgrading their instance never needs to know a prompt file changed. Code that ships in the product still counts even when it exists to keep the assistant honest - a lint guard under `tests/` changes the build for every contributor, so it belongs in `### 🧪 Tests`.

**Off `main`, first ask whether the change needs an entry at all.** A fix or behavior change to something already released does. A step in building the unreleased feature the branch exists for does not, and neither does a bug that only ever existed on that branch, because the feature gets one entry rather than one per step. Check it against `git log main..HEAD` instead of assuming: if the code being fixed arrived in one of those commits, nobody has ever run it.

**Every entry is at most two sentences** and stays shallow. Say what the change is, not why it was made, how it works, or what it took to build. Anything needing a third sentence belongs in that feature's guide.

**Inside an entry there is no `;`, no ` - ` and no `- `.** Stricter than the typography rule above, which allows a hyphen as a dash. A sentence reaching for one of them is doing too much work, so split it or cut it. The `- ` opening the line is the list marker and stays.

**Find the active version**: either a `## vNEXT` block at the top, or the topmost `## vX.Y.Z` block marked `*Release: In Progress*`. If neither exists, run `pnpm changelog:next` first.

**Section order** (skip sections with no entries, never reorder):

| # | Change type | Section |
| :--- | :--- | :--- |
| 1 | New feature, adapter, or page | `### ✨ Features` |
| 2 | Bug fix | `### 🐛 Bug Fixes` |
| 3 | Security fix | `### 🔒 Security` |
| 4 | Performance, UX, code quality | `### 🎨 Improvements` |
| 5 | Behavior change (non-breaking) | `### 🔄 Changed` |
| 6 | Deleted feature or code | `### 🗑️ Removed` |
| 7 | New or updated docs article | `### 📝 Documentation` |
| 8 | Test changes | `### 🧪 Tests` |
| 9 | GitHub Actions, Dockerfile, scripts | `### 🔧 CI/CD` |
| 10 | Docker image info (always last) | `### 🐳 Docker` |

Entry format and full rules live in [docs/CLAUDE.md](docs/CLAUDE.md).

## File conventions

- **Naming**: `kebab-case` (`backup-service.ts`, `user-table.tsx`).
- **Exports**: named exports preferred, no barrel files in `src/components/`.
- **Path alias**: `@/` maps to `src/`.
- **Max file size**: roughly 300 lines, then split. The runner pipeline in `src/lib/runner/steps/` is the reference for how to split.

## Quick reference

| Concern | Location |
| :--- | :--- |
| DB schema | [prisma/schema.prisma](prisma/schema.prisma) |
| Types and interfaces | [src/lib/core/](src/lib/core/) |
| Permissions | [src/lib/auth/permissions.ts](src/lib/auth/permissions.ts) |
| Access control | [src/lib/auth/access-control.ts](src/lib/auth/access-control.ts) |
| Adapters | [src/lib/adapters/](src/lib/adapters/) |
| Services | [src/services/](src/services/) |
| Server Actions | [src/app/actions/](src/app/actions/) |
| Scheduler (cron) | [src/lib/server/scheduler.ts](src/lib/server/scheduler.ts) |
| Crypto (encrypt/decrypt) | [src/lib/crypto/index.ts](src/lib/crypto/index.ts) |
| Crypto (streams) | [src/lib/crypto/stream.ts](src/lib/crypto/stream.ts) |
| Logger | [src/lib/logging/logger.ts](src/lib/logging/logger.ts) |
| Error classes | [src/lib/logging/errors.ts](src/lib/logging/errors.ts) |
| Shadcn primitives | [src/components/ui/](src/components/ui/) |
| Test containers | [docker-compose.test.yml](docker-compose.test.yml) |

## Environment variables

- `ENCRYPTION_KEY` - system key for encrypting secrets at rest. Required.
- `LOG_LEVEL` - `debug` | `info` (default) | `warn` | `error`.
- `SQLITE_WAL_MODE` - `true` (default) | `false`. WAL is on by default for the Prisma SQLite DB. See `src/lib/prisma.ts`.
- `DISABLE_EMAIL_LOGIN` - `true` | `false` (default). Rejects browser email sign-in and sign-up. Server-side `auth.api.*` calls stay open so admin user creation and password resets keep working. See `src/lib/auth/env-flags.ts`.
- `OIDC_AUTO_REDIRECT` - `SsoProvider.providerId` to redirect to instead of rendering the login page. Format checked in `env-validation.ts`, existence in `startup-checks.ts`.
