# Testing Guide

Comprehensive guide to testing DBackup, including unit tests, integration tests, and manual testing procedures.

## Test Infrastructure

### Test Stack

```yaml
# docker-compose.test.yml (simplified example)
services:
  mysql-57:
    image: mysql:5.7
    ports:
      - "33357:3306"
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword

  mysql-8:
    image: mysql:8.0
    ports:
      - "33380:3306"
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword

  postgres-15:
    image: postgres:15-alpine
    ports:
      - "54415:5432"
    environment:
      POSTGRES_USER: testuser
      POSTGRES_PASSWORD: testpassword

  mongodb:
    image: mongo:6.0
    ports:
      - "27017:27017"
```

### Start Test Databases

```bash
docker-compose -f docker-compose.test.yml up -d
```

### Test Credentials

| Database | Host | Port | User | Password |
| :--- | :--- | :--- | :--- | :--- |
| MySQL 5.7 | localhost | 33357 | root | rootpassword |
| MySQL 8.0 | localhost | 33380 | root | rootpassword |
| MySQL 9.1 | localhost | 33390 | root | rootpassword |
| MariaDB 10 | localhost | 33310 | root | rootpassword |
| MariaDB 11 | localhost | 33311 | root | rootpassword |
| PostgreSQL 12-17 | localhost | 54412-54417 | testuser | testpassword |
| MongoDB | localhost | 27017 | - | - |

## Test Categories

### Unit Tests

Test pure functions and isolated logic.

**Location**: `tests/unit/` or co-located with source files

**Run**:
```bash
pnpm test
```

**Example** (Retention):
```typescript
// tests/unit/retention-service.test.ts
import { describe, it, expect } from "vitest";
import { RetentionService } from "@/services/backup/retention-service";

describe("RetentionService", () => {
  describe("calculateRetention", () => {
    it("keeps correct number of daily backups", () => {
      const files = generateTestFiles(30);
      const config = {
        mode: "SMART",
        smart: { daily: 7, weekly: 0, monthly: 0, yearly: 0 },
      };

      const result = RetentionService.calculateRetention(files, config);

      expect(result.keep.length).toBe(7);
      expect(result.delete.length).toBe(23);
    });

    it("never deletes locked files", () => {
      const files = [
        { name: "backup-1", locked: true, modifiedAt: new Date() },
        { name: "backup-2", locked: false, modifiedAt: new Date() },
      ];
      const config = { mode: "SIMPLE", simple: { keepCount: 1 } };

      const result = RetentionService.calculateRetention(files, config);

      expect(result.keep.map(f => f.name)).toContain("backup-1");
    });
  });
});
```

**Example** (Checksum):
```typescript
// tests/unit/lib/checksum.test.ts
import { describe, it, expect } from "vitest";
import { calculateChecksum, calculateFileChecksum, verifyFileChecksum } from "@/lib/crypto/checksum";
import fs from "fs/promises";

describe("calculateChecksum", () => {
  it("returns consistent SHA-256 hash", () => {
    const hash1 = calculateChecksum("hello world");
    const hash2 = calculateChecksum("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
  });

  it("produces different hashes for different inputs", () => {
    expect(calculateChecksum("hello")).not.toBe(calculateChecksum("world"));
  });
});

describe("verifyFileChecksum", () => {
  it("detects file modification", async () => {
    const tmpPath = "/tmp/test-checksum-verify.txt";
    await fs.writeFile(tmpPath, "original content");
    const hash = await calculateFileChecksum(tmpPath);

    // Modify file
    await fs.writeFile(tmpPath, "modified content");
    const result = await verifyFileChecksum(tmpPath, hash);

    expect(result.valid).toBe(false);
    await fs.unlink(tmpPath);
  });
});
```

Test adapters against real database instances.

**Location**: `tests/integration/`

**Prerequisites**:
1. Docker containers running
2. CLI tools installed (`mysqldump`, `pg_dump`, etc.)

**Run**:
```bash
pnpm test:integration
```

#### SSH mode

`ssh-mode.test.ts` runs the same operations through the `ssh-host` container, a Debian image with sshd and the database client tools. Each source addresses its database by **compose service name**, which resolves only from inside that container - so a passing test proves the command really ran on the remote host. Those tests need no local CLI tools at all, since the tools live on the target.

The key pair is generated into `.ssh-test/` by `scripts/ensure-ssh-test-key.sh`, which both `pnpm test:integration` and `pnpm test:env:up` call. It is gitignored, so no private key enters the repository. The file skips cleanly when the container is not reachable.

Two engines are covered by an older version than the direct tests use, because a client cannot read a server newer than itself: MySQL 5.7 (MySQL 9 dropped `mysql_native_password`) and PostgreSQL 12 (Debian ships `pg_dump` 15). MongoDB and Firebird are not covered, their tools are not in Debian's repositories.

For those, and for testing against a real distribution's package set, use the Multipass VM (`pnpm test:vm:up`). The container proves the transport mechanics; the VM proves it works on a real system.

**Example**:
```typescript
// tests/integration/adapters/mysql.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySQLAdapter } from "@/lib/adapters/database/mysql";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execAsync = promisify(exec);

describe("MySQLAdapter Integration", () => {
  const config = {
    host: "localhost",
    port: 3306,
    username: "root",
    password: "rootpassword",
    database: "test_db",
  };

  beforeAll(async () => {
    // Create test database
    await execAsync(
      `mysql -h${config.host} -P${config.port} ` +
      `-u${config.username} -p${config.password} ` +
      `-e "CREATE DATABASE IF NOT EXISTS test_db"`
    );

    // Insert test data
    await execAsync(
      `mysql -h${config.host} -P${config.port} ` +
      `-u${config.username} -p${config.password} test_db ` +
      `-e "CREATE TABLE IF NOT EXISTS users (id INT, name VARCHAR(100))"`
    );
  });

  afterAll(async () => {
    // Cleanup
    await execAsync(
      `mysql -h${config.host} -P${config.port} ` +
      `-u${config.username} -p${config.password} ` +
      `-e "DROP DATABASE IF EXISTS test_db"`
    );
  });

  it("should test connection", async () => {
    const result = await MySQLAdapter.test(config);
    expect(result.success).toBe(true);
  });

  it("should dump database", async () => {
    const backupPath = "/tmp/test-mysql-backup.sql";

    const result = await MySQLAdapter.dump(config, backupPath);

    expect(result.success).toBe(true);
    expect(result.size).toBeGreaterThan(0);

    const content = await fs.readFile(backupPath, "utf-8");
    expect(content).toContain("CREATE TABLE");

    await fs.unlink(backupPath);
  });

  it("should list databases", async () => {
    const databases = await MySQLAdapter.getDatabases(config);

    expect(databases).toContain("test_db");
    expect(databases).not.toContain("information_schema");
  });
});
```

### E2E Tests

End-to-end tests through the UI.

**Manual Process**:
1. Start dev server: `pnpm dev`
2. Create test source/destination
3. Create and run test job
4. Verify backup in Backups page
5. Test restore functionality

**Automated** (future):
```bash
pnpm test:e2e  # Playwright tests
```

## Test Utilities

### Generate Test Data

```bash
# Seed test databases with data
pnpm test:ui
```

This script:
1. Creates test databases in MySQL/PostgreSQL/MongoDB
2. Inserts sample data
3. Seeds the local DBackup database with pre-configured sources

### Stress Testing

Generate large datasets:

```bash
# Generate 1GB of test data
./scripts/generate-stress-data.sh mysql 1000000

# Test backup performance
time pnpm test:integration -- --grep "large database"
```

## Testing Adapters

### Database Adapter Tests

```typescript
// Template for database adapter tests
describe("DatabaseAdapter", () => {
  const testCases = [
    { name: "MySQL 8.0", config: mysqlConfig },
    { name: "PostgreSQL 15", config: postgresConfig },
    { name: "MongoDB 6.0", config: mongoConfig },
  ];

  testCases.forEach(({ name, config }) => {
    describe(name, () => {
      it("tests connection", async () => {
        const result = await adapter.test(config);
        expect(result.success).toBe(true);
      });

      it("dumps database", async () => {
        const result = await adapter.dump(config, "/tmp/backup");
        expect(result.success).toBe(true);
      });

      it("restores database", async () => {
        // Dump first
        await adapter.dump(config, "/tmp/backup");

        // Restore to different database
        const result = await adapter.restore(
          { ...config, database: "test_restore" },
          "/tmp/backup"
        );
        expect(result.success).toBe(true);
      });
    });
  });
});
```

### Storage Adapter Tests

```typescript
describe("StorageAdapter", () => {
  const testFile = "/tmp/test-file.txt";
  const remotePath = "test/file.txt";

  beforeAll(async () => {
    await fs.writeFile(testFile, "test content");
  });

  it("uploads file", async () => {
    await adapter.upload(config, testFile, remotePath);

    const files = await adapter.list(config, "test");
    expect(files.map(f => f.name)).toContain("file.txt");
  });

  it("downloads file", async () => {
    const downloadPath = "/tmp/downloaded.txt";
    await adapter.download(config, remotePath, downloadPath);

    const content = await fs.readFile(downloadPath, "utf-8");
    expect(content).toBe("test content");
  });

  it("deletes file", async () => {
    await adapter.delete(config, remotePath);

    const files = await adapter.list(config, "test");
    expect(files.map(f => f.name)).not.toContain("file.txt");
  });
});
```

## Debugging Tests

### Vitest UI

```bash
pnpm test --ui
```

Opens interactive test runner at `http://localhost:51204`.

### Debug Mode

```bash
# Run specific test with debugging
DEBUG=* pnpm test -- --grep "MySQL"
```

### Prisma Studio

Inspect database during tests:

```bash
npx prisma studio
```

### Runner Debugging

1. Set breakpoints in VS Code
2. Create manual trigger job in UI
3. Trigger job execution
4. Step through runner code

**Tip**: Temp files are in `/tmp`. Check there if backup fails before cleanup.

## Common Issues

### CLI Tools Not Found

```
Error: Command not found: mysqldump
```

**Fix** (macOS):
```bash
brew install mysql-client
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
```

**Fix** (Ubuntu):
```bash
sudo apt install mysql-client
```

### Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**Fix**: Ensure Docker containers are running:
```bash
docker ps
docker-compose -f docker-compose.test.yml up -d
```

### Permission Denied

```
Error: Access denied for user 'root'@'172.17.0.1'
```

**Fix**: Check container logs and credentials:
```bash
docker logs dbackup-mysql-test
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: rootpassword
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s

      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: testuser
          POSTGRES_PASSWORD: testpassword
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install

      - name: Install CLI tools
        run: |
          sudo apt-get update
          sudo apt-get install -y mysql-client postgresql-client

      - name: Run unit tests
        run: pnpm test

      - name: Run integration tests
        run: pnpm test:integration
```

## Test Coverage

Generate coverage report:

```bash
pnpm test -- --coverage
```

Coverage thresholds in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
```

## Related Documentation

- [Project Setup](/developer-guide/setup)
- [Database Adapters](/developer-guide/adapters/database)
- [Storage Adapters](/developer-guide/adapters/storage)
