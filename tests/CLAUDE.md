# Testing

Vitest. Unit tests in `tests/unit/`, audit tests in `tests/audit/`. Both run in `pnpm test` and in CI. The end-to-end tests are in `e2e/`, with their own guide `e2e/CLAUDE.md`.

```bash
pnpm test                    # Unit tests (watch mode)
pnpm test:coverage           # Unit tests with coverage
pnpm lab:status              # What of the dev lab runs, what is missing and what to run next
pnpm lab:up                  # Dev lab: test DBs, storage servers and notification receivers
pnpm lab:seed                # Fill the dev DB with the first user and every lab connection and job
pnpm lab:check --run         # Test connection on every lab connection, then every lab job once
pnpm test:e2e                # The end-to-end tests: the image of this checkout beside the lab
```

Config: `vitest.config.ts`. The dev lab lives in `lab/`, its guide is `docs/developer-guide/reference/dev-lab.md`.

## The lab code

Nothing in `lab/src` outside the seed and `check.ts`, and nothing in `e2e/`, imports the app. Prisma opens `DATABASE_URL` when its module loads, so a static import of the app from a command that runs before `.env` is read opens the wrong database. `tests/unit/lab/lab-parts.test.ts` checks it.

## Unit tests

- Mock every external call - network, filesystem, child processes, Prisma.
- A test that needs a real SQLite database migrates a temporary one with `prisma migrate deploy` and opens it with `openCopy`, like `tests/unit/services/trash-round-trip.test.ts`. It runs with `// @vitest-environment node`.
- When mocking `fetch`, the mocked response must match the API convention (`{ success: true, data: ... }`). A mock returning a bare object passes the test and lies about production behavior.
- `describe` and `it` blocks name the business case, not the function. `it("rejects a restore onto an older server version")` beats `it("returns false")`.

## What needs a test

- New adapters - `test()`, `dump()` and `restore()` against a mocked transport, and an end-to-end family in `e2e/` with the engine or destination in the lab.
- Services with branching business logic - retention (GFS), integrity checks, restore preflight.
- Permission guards on new Server Actions and API routes.
- Bug fixes - a regression test that fails against the old code.

Pure UI rendering and thin Server Action wrappers do not need dedicated tests.

## Conventions

- Test files sit next to their category in `tests/`, not beside the source file. The tests of `lab/` are in `tests/unit/lab/`.
- No real credentials or production endpoints, ever. Not even commented out. The test values of the lab containers are the exception, they live in `lab/src/engines/` and `lab/src/catalog.ts`.
- Do not assert on log output. Assert on returned values and persisted state.
