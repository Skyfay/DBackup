# Testing Guide

DBackup is tested with [Vitest](https://vitest.dev) and [Playwright](https://playwright.dev). The unit tests run without external services, so they run on any machine and in CI. The end-to-end tests run against the servers of the [Dev Lab](/developer-guide/reference/dev-lab).

## Running Tests

```bash
pnpm test              # Watch mode
pnpm test:coverage     # One run with a coverage report
pnpm validate          # Lint, type check and the tests, like CI
```

CI runs `pnpm test:coverage` on every pull request (`.github/workflows/validate.yml`) and uploads the report to Codecov. Coverage counts `src/lib/` and `src/services/`. There are no thresholds.

## Where Tests Live

| Folder | Holds |
| :--- | :--- |
| `tests/unit/` | Tests of services, adapters, the runner, routes, components and hooks, sorted like `src/` |
| `tests/unit/lint-guards/` | Rules the code must follow, like no `console.*`, the design system and the changelog fragments |
| `tests/audit/` | Static scans: every Server Action checks a permission, no route sends a decrypted config |
| `e2e/` | The end-to-end tests, `pnpm test:e2e`, see [End-to-End Tests](#end-to-end-tests) |

Test files sit next to their category in `tests/`, never beside the source file.

## Writing a Test

Mock every call that leaves the process: network, filesystem, child processes and Prisma. The helpers in `src/lib/testing/` cover the common cases.

| Helper | For |
| :--- | :--- |
| `prisma-mock.ts` | `prismaMock`, a deep mock of the Prisma client that replaces `@/lib/prisma` |
| `fake-host.ts` | An in-memory execution host, for adapters that run commands locally or over SSH |
| `fake-docker-engine.ts` | An in-memory Docker engine, for the Docker volume source |
| `setup.ts` | Loaded before every test file: jest-dom matchers and browser polyfills |

```typescript
import { describe, it, expect } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { hasRunningJobs } from "@/services/dashboard-service";

describe("the dashboard while a backup runs", () => {
    it("polls while a run is still going", async () => {
        prismaMock.execution.count.mockResolvedValue(1);

        expect(await hasRunningJobs()).toBe(true);
    });
});
```

- Name the business case in `describe` and `it`, not the function.
- A mocked `fetch` answers in the API format, `{ success: true, data: ... }`. A bare object passes the test and hides what production does.
- Assert on returned values and stored state, never on log output.

### Against a Real SQLite Database

Some code only proves itself against real tables, like the configuration backup or Recently deleted. Such a test migrates a temporary database once with `prisma migrate deploy`, copies it for every test and opens the copy with `openCopy` from `@/services/config/database-copy`. It runs in the Node environment:

```typescript
// @vitest-environment node
```

`tests/unit/services/trash-round-trip.test.ts` and `config-database-copy.test.ts` show the whole pattern.

## End-to-End Tests

The end-to-end tests run the Docker image of the checkout the way a user runs it, beside the servers it backs up, and drive it through its pages and its API:

```bash
pnpm test:e2e                          # Build the image, start what is needed, run every project
pnpm test:e2e --project ui             # Only the browser tests
E2E_FAMILIES=mysql,storage pnpm test:e2e   # Only these families
pnpm test:e2e:ui                       # Playwright UI mode
```

DBackup runs as the service `app` of `lab/compose/e2e.yml`, in the Compose project of the [Dev Lab](/developer-guide/reference/dev-lab) on its Docker host, and reaches every server by its service name. A run builds the image, starts the services it needs, loads their test data and starts DBackup from an empty instance. Afterwards it removes DBackup again and leaves the lab running. Without a lab config of your own everything runs on the Docker of this machine, as in CI.

| Project | Covers |
| :--- | :--- |
| `setup` | The first start: the first account through its page, then the rate limits and a Vault key for the other projects |
| `ui` | A destination, a database with a new login and a job set up through their pages, Run now, and the run page until it is done |
| `postgres` | PostgreSQL 12 and 18, and 12 over SSH |
| `mysql` | MySQL 5.7 and 9, MariaDB 10.4 and 11.8, and 5.7 and 10.4 over SSH |
| `mongodb` | MongoDB 4.4 and 8.0 |
| `mssql` | SQL Server 2017 and 2022 |
| `small` | Redis 6 and 8, Valkey 7.2 and 8, Firebird 3 and 5, SQLite over SSH, and a folder |
| `customer` | PostgreSQL, MySQL, Redis and SQLite of a server with the packages of Ubuntu, over its OpenSSH, with the fallback to `mysqldump` |
| `storage` | One backup to every destination, each listing it, restoring it and deleting it, and a test message on every notification channel |

Every database passes Test connection, is backed up encrypted and compressed, restored under a new name on its own server and read back with the tools of its engine, outside of DBackup: the output of `mysqldump` and `pg_dump`, `dbHash` of MongoDB, row counts and checksums of SQL Server, `isql` for Firebird and `.dump` of SQLite. Redis and Valkey restore by hand, so only their backups are checked. A bug the tests found that is not fixed yet is marked with `test.fail()`, so its test passes while it still fails and turns red once the bug is gone.

`E2E_NO_BUILD=1` uses an image built already, `E2E_KEEP=1` leaves DBackup and the restored databases in place, and `E2E_PORT` moves DBackup off port 3300. A service that does not start on a CPU without AVX, like MongoDB 8 in a virtual machine with a generic CPU model, skips its tests on a developer machine and fails them in CI. A failed test keeps its trace, screenshot and video under `e2e/test-results/`, and `e2e/playwright-report/` shows the report.

In CI the workflow `.github/workflows/e2e.yml` runs on every pull request into `dev` and `main`, after an approval through the environment `e2e`, with one job per project on the runner itself. How to write a test is in `e2e/CLAUDE.md`.

For a quick look at a running dev instance, `pnpm lab:check --run` tests every lab connection of `dev.db` and runs every lab job once.

## Debugging

```bash
pnpm test tests/unit/services/retention-service.test.ts   # One file
pnpm test -t "keeps the newest backup"                    # Tests whose name matches
npx prisma studio                                          # Look into the dev database
```

Every run works in a `dbackup-run-*` folder of its own in the temp directory, `TMPDIR` or the system default, and removes it when it ends.

## Related Documentation

- [Project Setup](/developer-guide/setup)
- [Database Adapters](/developer-guide/adapters/database)
- [Storage Adapters](/developer-guide/adapters/storage)
