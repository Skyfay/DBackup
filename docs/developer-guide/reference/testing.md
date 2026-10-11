# Testing Guide

DBackup is tested with [Vitest](https://vitest.dev). The unit tests run without external services, so they run on any machine and in CI. The lab tests run against the servers of the [Dev Lab](/developer-guide/reference/dev-lab).

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
| `tests/lab/` | Tests against the running dev lab, `pnpm test:lab`, see [Against Real Servers](#against-real-servers) |

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

## Against Real Servers

The [Dev Lab](/developer-guide/reference/dev-lab) runs every engine and every self-hostable destination in Docker. Two commands use it:

```bash
pnpm lab:check --run   # Test connection on every lab connection of dev.db, then every lab job once
pnpm test:lab          # The tests in tests/lab/ against the running lab
```

`pnpm test:lab` brings a database of its own, migrated like a fresh install, and writes under the workspace `test-<workspace>` on every destination. It never touches `dev.db` or the backups of a checkout. When the lab does not answer, it stops before the first test and says so.

| File | Proves |
| :--- | :--- |
| `connections.test.ts` | Test connection passes for every source, destination and channel of the lab |
| `storage.test.ts` | Every destination takes an upload under a name with spaces and Unicode, lists it with its size, hands back the same bytes, reads a sidecar and deletes it |
| `round-trip.test.ts` | Every source goes through the real runner, encrypted and compressed, and restores under a new name with the same content. One backup goes to every destination and restores from each, and a folder restores file by file |

The content is compared with the tools of each engine, outside of DBackup: the output of `mysqldump` and `pg_dump`, `dbHash` of MongoDB, row counts and checksums of SQL Server, `isql` for Firebird and `.dump` of SQLite. Redis and Valkey restore by hand, so only their backups are checked.

A bug the tests found that is not fixed yet goes into `KNOWN_BUGS` of `round-trip.test.ts`. Its case passes while it still fails, and fails once the bug is gone, which is when its line goes. `LAB_KEEP=1` leaves the restored databases and the uploaded files in place to look at, and `LAB_LOG_LEVEL=info` shows the log of every run.

The lab tests do not run in CI.

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
