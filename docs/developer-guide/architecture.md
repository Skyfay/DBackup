# Architecture

DBackup follows a strictly layered architecture to decouple the UI from business logic and enable extensibility through adapters.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│                    React + Shadcn UI                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      App Router Layer                            │
│               Next.js 16 App Router (src/app)                   │
│                                                                  │
│   Pages (SSR)  │  Server Actions  │  API Routes                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer                               │
│                    (src/services)                                │
│                                                                  │
│  JobService  │  BackupService  │  RestoreService  │  UserService│
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌───────────────────┐ ┌───────────────┐ ┌───────────────┐
│  Database Layer   │ │ Adapter Layer │ │ Runner Layer  │
│  Prisma + SQLite  │ │  (src/lib/    │ │  (src/lib/    │
│                   │ │   adapters)   │ │    runner)    │
└───────────────────┘ └───────────────┘ └───────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Database │   │ Storage  │   │ Notif.   │
        │ Adapters │   │ Adapters │   │ Adapters │
        └──────────┘   └──────────┘   └──────────┘
              │               │               │
         ┌────┴────┐         │               │
         ▼         ▼         ▼               ▼
   ┌──────────┐ ┌──────┐ ┌──────────┐ ┌──────────┐
   │  Direct  │ │ SSH  │ │    S3    │ │ Discord  │
   │  (TCP)   │ │(Exec)│ │   SFTP   │ │  Email   │
   │          │ │      │ │  Local   │ │          │
   │  MySQL   │ │MySQL │ └──────────┘ └──────────┘
   │PostgreSQL│ │PG    │
   │ MongoDB  │ │Mongo │
   └──────────┘ └──────┘
```

### Transport Layer

A database adapter describes **what** runs. An `ExecutionHost` from `src/lib/transport/` decides **how** and **where**:

- **Direct**: CLI tools run on the DBackup server and reach the database over TCP
- **SSH**: CLI tools run on the target server, their output is streamed back over the SSH connection

SSH mode is remote execution, not a tunnel: `mysqldump` runs on the database server. The one exception is MSSQL, which tunnels its TDS connection because a `.bak` file has to be written by SQL Server itself.

Adapters have a single code path and never branch on the transport. A `TransportResolver` turns the stored config into a `TransportSpec` once, `withHost()` creates the host and disposes it, and one host is shared across a whole job run. See [Database Adapters](/developer-guide/adapters/database#transport-architecture-src-lib-transport) for the interface and the rules for writing an adapter against it.

## Four-Layer Architecture

### 1. App Router Layer (`src/app`)

Contains **route definitions only** - no business logic.

```
src/app/
├── dashboard/
│   ├── page.tsx          # Dashboard home
│   ├── sources/
│   │   └── page.tsx      # Sources listing
│   ├── jobs/
│   │   └── page.tsx      # Jobs listing
│   └── ...
├── actions/
│   ├── source.ts         # Server Actions
│   ├── job.ts
│   └── ...
└── api/
    └── ...               # API routes (if needed)
```

**Rules:**
- Pages fetch data via Services
- Pass data to Client Components as props
- No direct database access

### 2. Server Actions (`src/app/actions`)

Thin wrappers that handle:
1. Authentication check
2. Permission verification
3. Input validation (Zod)
4. Service layer delegation
5. Cache revalidation

```typescript
// src/app/actions/source.ts
"use server";

export async function createSource(data: SourceInput) {
  // 1. Permission check
  await checkPermission(PERMISSIONS.SOURCES.WRITE);

  // 2. Validate input
  const validated = SourceSchema.parse(data);

  // 3. Delegate to service
  const result = await SourceService.create(validated);

  // 4. Revalidate cache
  revalidatePath("/dashboard/sources");

  return result;
}
```

### 3. Service Layer (`src/services`)

**All business logic lives here.**

```
src/services/
├── jobs/              # job-service.ts
├── backup/            # backup-service.ts, retention-service.ts, encryption-service.ts, integrity-service.ts
├── restore/           # restore-service.ts, preflight.ts, pipeline.ts, smart-recovery.ts
├── auth/              # auth-service.ts, api-key-service.ts, credential-service.ts
├── sso/               # oidc-provider-service.ts, oidc-registry.ts
├── storage/           # storage-service.ts, verification-service.ts, storage-alert-service.ts
├── notifications/     # notification-log-service.ts, system-notification-service.ts
├── system/            # healthcheck-service.ts, system-task-service.ts, update-service.ts
├── config/            # config-service.ts, export.ts, import.ts
├── templates/         # naming-template-service.ts, retention-policy-service.ts
├── user/              # user-service.ts
├── dashboard-service.ts
└── audit-service.ts
```

Services:
- Contain domain logic
- Handle transactions
- Coordinate between adapters
- Are easily unit-testable

### 4. Adapter Layer (`src/lib/adapters`)

Plugin architecture for external integrations.

```
src/lib/adapters/
├── definitions/         # Zod schemas (database.ts, storage.ts, notification.ts, shared.ts)
├── index.ts             # Registration
├── database/            # mysql, postgresql, mongodb, mariadb, sqlite, mssql, redis
├── storage/             # local, s3, sftp, ftp, smb, webdav, rsync, dropbox, gdrive, onedrive
├── notification/        # discord, email, slack, teams, telegram, ntfy, gotify, twilio, webhook
└── oidc/                # authentik, pocket-id, keycloak, generic
```

**Adapter Interfaces:**

```typescript
interface DatabaseAdapter {
  dump(config, path): Promise<BackupResult>;
  restore(config, path): Promise<BackupResult>;
  test(config): Promise<TestResult>;   // full write/delete verification
  ping?(config): Promise<void>;        // lightweight check, no test file; used by health checks
  getDatabases?(config): Promise<string[]>;
}

interface StorageAdapter {
  upload(config, local, remote): Promise<void>;
  download(config, remote, local): Promise<void>;
  list(config, path): Promise<FileInfo[]>;
  delete(config, path): Promise<void>;
  ping?(config): Promise<void>;        // lightweight check; falls back to test() if not implemented
}

interface NotificationAdapter {
  send(config, message, context): Promise<void>;
}
```

## Runner Pipeline (`src/lib/runner`)

Executes backups through discrete steps:

```
┌────────────┐   ┌────────────┐   ┌────────────┐
│ Initialize │──▶│    Dump    │──▶│   Upload   │
│            │   │            │   │            │
│ • Create   │   │ • Execute  │   │ • Checksum │
│   execution│   │   dump     │   │ • Upload   │
│ • Resolve  │   │ • Compress │   │   file     │
│   adapters │   │ • Encrypt  │   │ • Verify   │
└────────────┘   └────────────┘   └────────────┘
                                        │
┌────────────┐   ┌────────────┐         │
│ Completion │◀──│ Retention  │◀────────┘
│            │   │            │
│ • Cleanup  │   │ • Apply    │
│ • Notify   │   │   GFS      │
│ • Finalize │   │ • Delete   │
└────────────┘   └────────────┘
```

## Queue System

Manages concurrent backup execution:

```typescript
// src/lib/execution/queue-manager.ts
class QueueManager {
  private queue: string[] = [];
  private running = 0;

  async enqueue(executionId: string) {
    this.queue.push(executionId);
    await this.processQueue();
  }

  private async processQueue() {
    const maxConcurrent = await this.getMaxConcurrent();

    while (this.queue.length > 0 && this.running < maxConcurrent) {
      const id = this.queue.shift()!;
      this.running++;

      performExecution(id).finally(() => {
        this.running--;
        this.processQueue();
      });
    }
  }
}
```

## Data Flow Example

**Creating a backup job:**

```
UI: User clicks "Create Job"
         │
         ▼
Server Action: createJob(formData)
         │
         ├── checkPermission(JOBS.WRITE)
         ├── JobSchema.parse(formData)
         └── JobService.create(validated)
                  │
                  ├── prisma.job.create()
                  └── scheduler.scheduleJob(job)
```

**Running a backup:**

```
Scheduler: Cron triggers job
         │
         ▼
BackupService.runJob(jobId)
         │
         ├── Create Execution (Pending)
         └── QueueManager.enqueue(executionId)
                  │
                  ▼
Runner Pipeline:
         │
         ├── stepInitialize()
         │      └── Resolve adapters, decrypt config
         │
         ├── stepDump()
         │      └── MySQLAdapter.dump() → temp file
         │
         ├── stepUpload()
         │      └── S3Adapter.upload() → remote storage
         │
         ├── stepCompletion()
         │      └── Cleanup, notify, update status
         │
         └── stepRetention()
                └── Apply GFS, delete old backups
```

## Security Architecture

### Encryption Layers

```
Layer 1: System Encryption (ENCRYPTION_KEY)
         │
         └── Encrypts: DB passwords, API keys, master keys

Layer 2: Backup Encryption (Profiles)
         │
         └── Encrypts: Backup files in storage
```

### RBAC Flow

```
Request → Auth Check → Permission Check → Action
              │               │
              └── Session ────┴── User → Group → Permissions[]
```

## Data Integrity

### Checksum Verification

DBackup uses SHA-256 checksums for end-to-end data integrity verification:

```
Backup Pipeline:
  Final File → SHA-256 Hash → Store in .meta.json
       │
       ▼
  Upload to Storage → Verify Hash (local storage only) ✓
                      Remote storage uses transport-level integrity

Restore Pipeline:
  Download from Storage → Verify Hash → Decrypt → Decompress → Restore
                               │
                          Abort if mismatch ✗

Periodic Integrity Check:
  All Storage Destinations → All Backups → Download → Verify Hash
                                                          │
                                               Report: passed/failed/skipped
```

**Key Components:**
- `src/lib/crypto/checksum.ts` - SHA-256 utility (stream-based, memory-efficient)
- `src/services/backup/integrity-service.ts` - Periodic full verification
- System task `INTEGRITY_CHECK` - Weekly schedule (disabled by default)

## System Tasks

9 built-in background tasks run on configurable cron schedules (Settings > System Tasks):

| Task | Default Schedule | Enabled by Default |
|------|-----------------|-------------------|
| `HEALTH_CHECK` | Every minute | Yes |
| `UPDATE_DB_VERSIONS` | Hourly | Yes |
| `REFRESH_STORAGE_STATS` | Hourly | Yes |
| `WARMUP_STORAGE_CACHE` | Hourly | Yes |
| `CHECK_FOR_UPDATES` | Daily midnight | Yes |
| `CLEAN_OLD_LOGS` | Daily midnight | Yes |
| `SYNC_PERMISSIONS` | Daily midnight | Yes |
| `CONFIG_BACKUP` | Daily 3 AM | No |
| `INTEGRITY_CHECK` | Weekly Sunday 4 AM | No |

**Infrastructure:** `src/services/system/system-task-service.ts` + `src/lib/runner/system-task-runner.ts`

`CLEAN_OLD_LOGS` applies every setting from `src/lib/core/data-retention.ts` through `src/services/system/data-retention-service.ts`. While VACUUM or a database download runs (`src/services/system/database-service.ts`), the flag in `src/lib/server/database-maintenance.ts` makes the queue hold back pending jobs, restores refuse to start and system tasks skip their run.

## Health Check System

Every minute, the `HEALTH_CHECK` task pings all configured adapters and records results in `HealthCheckLog` (ONLINE / DEGRADED / OFFLINE + latency). Offline notifications are deduplicated with a 24 h cooldown.

- Uses `ping()` if implemented, otherwise falls back to `test()`
- Max 5 concurrent checks
- `src/services/system/healthcheck-service.ts`

## Logging & Error Handling

DBackup uses a centralized logging system for consistent debugging and monitoring.

### System Logger

```typescript
import { logger } from "@/lib/logging/logger";

const log = logger.child({ service: "MyService" });
log.info("Operation started", { id: "123" });
log.error("Operation failed", { id: "123" }, error);
```

### Custom Errors

```typescript
import { AdapterError, wrapError } from "@/lib/logging/errors";

try {
  await riskyOperation();
} catch (e) {
  throw new AdapterError("mysql", "Connection failed");
}
```

**Error Hierarchy:**
- `DBackupError` (base)
- `AdapterError`, `ConnectionError`, `ConfigurationError`
- `BackupError`, `RestoreError`, `EncryptionError`
- `PermissionError`, `AuthenticationError`

See [Logging System](/developer-guide/core/logging) for full documentation.

## Key Design Decisions

### Why SQLite?

- Single-file database
- No external dependencies
- Easy backup/restore
- Sufficient for single-instance deployment

### Why Adapters?

- Easy to add new database/storage support
- Isolated, testable units
- Clean separation of concerns

### Why Service Layer?

- Testable business logic
- Reusable across actions/API
- Clear domain boundaries

### Why Pipeline Pattern?

- Easy to debug (step-by-step)
- Easy to extend (add steps)
- Consistent context flow

## Related Documentation

- [Service Layer](/developer-guide/core/services)
- [Adapter System](/developer-guide/core/adapters)
- [Runner Pipeline](/developer-guide/core/runner)
- [Logging System](/developer-guide/core/logging)
- [Database Schema](/developer-guide/reference/schema)
