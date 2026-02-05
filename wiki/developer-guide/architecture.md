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
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  MySQL   │   │    S3    │   │ Discord  │
        │PostgreSQL│   │   SFTP   │   │  Email   │
        │ MongoDB  │   │  Local   │   │          │
        └──────────┘   └──────────┘   └──────────┘
```

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
├── job-service.ts        # Job CRUD
├── backup-service.ts     # Backup triggering
├── restore-service.ts    # Restore orchestration
├── retention-service.ts  # GVS algorithm
├── encryption-service.ts # Key management
├── user-service.ts       # User management
└── oidc-provider-service.ts
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
├── definitions.ts        # Zod schemas
├── index.ts             # Registration
├── database/
│   ├── mysql.ts
│   ├── postgresql.ts
│   ├── mongodb.ts
│   └── sqlite.ts
├── storage/
│   ├── local.ts
│   ├── s3.ts
│   └── sftp.ts
├── notification/
│   ├── discord.ts
│   └── email.ts
└── oidc/
    ├── authentik.ts
    └── generic.ts
```

**Adapter Interfaces:**

```typescript
interface DatabaseAdapter {
  dump(config, path): Promise<BackupResult>;
  restore(config, path): Promise<BackupResult>;
  test(config): Promise<TestResult>;
  getDatabases?(config): Promise<string[]>;
}

interface StorageAdapter {
  upload(config, local, remote): Promise<void>;
  download(config, remote, local): Promise<void>;
  list(config, path): Promise<FileInfo[]>;
  delete(config, path): Promise<void>;
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
│ • Create   │   │ • Execute  │   │ • Upload   │
│   execution│   │   dump     │   │   file     │
│ • Resolve  │   │ • Compress │   │ • Write    │
│   adapters │   │ • Encrypt  │   │   metadata │
└────────────┘   └────────────┘   └────────────┘
                                        │
┌────────────┐   ┌────────────┐         │
│ Completion │◀──│ Retention  │◀────────┘
│            │   │            │
│ • Cleanup  │   │ • Apply    │
│ • Notify   │   │   GVS      │
│ • Finalize │   │ • Delete   │
└────────────┘   └────────────┘
```

## Queue System

Manages concurrent backup execution:

```typescript
// src/lib/queue-manager.ts
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
                └── Apply GVS, delete old backups
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

## Logging & Error Handling

DBackup uses a centralized logging system for consistent debugging and monitoring.

### System Logger

```typescript
import { logger } from "@/lib/logger";

const log = logger.child({ service: "MyService" });
log.info("Operation started", { id: "123" });
log.error("Operation failed", { id: "123" }, error);
```

### Custom Errors

```typescript
import { AdapterError, wrapError } from "@/lib/errors";

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
