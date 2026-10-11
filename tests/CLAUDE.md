# Testing

Vitest. Unit tests in `tests/unit/`, audit tests in `tests/audit/`. Both run in `pnpm test` and in CI. The tests against the dev lab are in `tests/lab/` and run only with `pnpm test:lab`.

```bash
pnpm test                    # Unit tests (watch mode)
pnpm test:coverage           # Unit tests with coverage
pnpm lab:up                  # Dev lab: test DBs, storage servers and notification receivers
pnpm lab:seed                # Fill the dev DB with the first user and every lab connection and job
pnpm lab:check --run         # Test connection on every lab connection, then every lab job once
pnpm test:lab                # The tests in tests/lab/ against the running lab, with a database of their own
```

Config: `vitest.config.ts`, and `vitest.lab.config.ts` for the lab tests. The dev lab lives in `lab/`, its guide is `docs/developer-guide/reference/dev-lab.md`, the lab tests are described in `docs/developer-guide/reference/testing.md`.

## Lab tests

- Backups and restores go through the real services, runner and restore pipeline, never a database adapter called by hand. A connection test goes through `runAdapterTest`, and a lint guard refuses a database adapter call without a host. Storage adapters need no host, the storage contract calls them directly.
- They compare what a restore wrote with the tools of the engine, in `tests/lab/support/places.ts`. A new engine needs a fingerprint and a drop there.
- A bug they find that is not fixed yet goes into `KNOWN_BUGS` of `round-trip.test.ts`, with one sentence on what fails. Never loosen a fingerprint to make a case pass, unless the difference is one of form and the reason is written next to it.
- Nothing in `lab/src` outside the seed and `check.ts`, and nothing in `tests/lab/support/` that runs before the database is chosen, imports the app. Prisma opens `DATABASE_URL` when its module loads, and `tests/unit/lab/lab-parts.test.ts` checks it.

## Unit tests

- Mock every external call - network, filesystem, child processes, Prisma.
- A test that needs a real SQLite database migrates a temporary one with `prisma migrate deploy` and opens it with `openCopy`, like `tests/unit/services/trash-round-trip.test.ts`. It runs with `// @vitest-environment node`.
- When mocking `fetch`, the mocked response must match the API convention (`{ success: true, data: ... }`). A mock returning a bare object passes the test and lies about production behavior.
- `describe` and `it` blocks name the business case, not the function. `it("rejects a restore onto an older server version")` beats `it("returns false")`.

## What needs a test

- New adapters - `test()`, `dump()` and `restore()` against a mocked transport, and a run of `pnpm test:lab` with the engine or destination in the lab.
- Services with branching business logic - retention (GFS), integrity checks, restore preflight.
- Permission guards on new Server Actions and API routes.
- Bug fixes - a regression test that fails against the old code.

Pure UI rendering and thin Server Action wrappers do not need dedicated tests.

## Conventions

- Test files sit next to their category in `tests/`, not beside the source file. The tests of `lab/` are in `tests/unit/lab/`.
- No real credentials or production endpoints, ever. Not even commented out. The test values of the lab containers are the exception, they live in `lab/src/catalog.ts`.
- Do not assert on log output. Assert on returned values and persisted state.
