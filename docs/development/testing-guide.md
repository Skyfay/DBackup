# Testing & Quality Assurance

This document outlines the testing strategy for the project, focusing on the hybrid environment of local development and Docker-based integration tests.

## 1. Test Environment (`docker-compose.test.yml`)

We use a dedicated Docker Compose file for testing to spin up real instances of our supported databases. We do **not** mock database connections for integration tests; we test against real targets.

**Active Services:**
*   **MySQL 8.0**: Port 3306 (Root password: `rootpassword`)
*   **PostgreSQL 15**: Port 5432 (User: `testuser`, Pass: `testpassword`)
*   **MongoDB 6.0**: Port 27017

### Running the Test Stack
```bash
docker-compose -f docker-compose.test.yml up -d
```
This ensures that when you run `npm run test` or debug the app locally, you have valid targets to connect to as "Sources".

## 2. Test Categories

### A. Unit Tests (`*.test.ts`)
*   **Location**: Co-located with files or in `tests/`.
*   **Scope**: Pure functions, utility helpers (e.g. `src/lib/utils.ts`, `src/lib/crypto.ts`).
*   **Tooling**: Jest / Vitest (Configured separately).

### B. Integration Tests (Adapters)
*   **Scope**: Verify that `mysqldump` or `pg_dump` actually works.
*   **Pre-requisites**:
    1.  The Host machine must have the CLI tools installed (`mysqldump`, `pg_dump`, `mongodump`).
    2.  The `docker-compose.test.yml` stack must be running.

### C. End-to-End (E2E)
*   Currently handled by manual verification using the "Test Job" feature in the UI.

## 3. Development Workflow with "Prisma Studio"

Since we use SQLite for the application state, you can inspect the local database easily.

```bash
npx prisma studio
```
This opens a web interface at `http://localhost:5555` to view `User`, `Job`, `Execution` tables directly.

## 4. Debugging the Runner

The Job Runner (`src/lib/runner.ts`) is the most complex part. To debug it:
1.  Create a "Manual Trigger" job in the UI.
2.  Place breakpoints in `steps/02-dump.ts`.
3.  Trigger the job via the UI.
4.  Watch the backend console logs.

**Tip**: The Runner uses a temporary directory. On macOS/Linux, this is usually `/tmp`. If a backup fails, check if the file exists there before the `cleanup` step removes it.

## 5. Common Testing Pitfalls

*   **"Command not found"**: The Node.js process spawns child processes for dumps. If `mysqldump` is not in your system PATH, the adapter will fail.
    *   *Fix*: Install client tools via Homebrew (`brew install mysql-client libpq mongodb-database-tools`).
*   **Network**: By default, `localhost` in the App connects to `localhost` on the Host. If you run the App *inside* Docker, you must use `host.docker.internal`.
