# Service Layer

The Service Layer contains all business logic in DBackup. Server Actions and API routes delegate to services-they never contain business logic themselves.

## Overview

```
src/services/
├── audit-service.ts           # Writes audit log entries (flat, no subdirectory)
├── audit/                     # The Audit log tab: list, filters, details, timeline, CSV
├── dashboard-service.ts       # Dashboard aggregations (flat, no subdirectory)
├── auth/
│   ├── api-key-service.ts     # API key CRUD and validation
│   ├── auth-service.ts        # Session helpers
│   └── credential-service.ts # Credential profile management
├── backup/
│   ├── backup-service.ts      # Triggers runJob()
│   ├── encryption-service.ts  # Encryption profile management
│   ├── integrity-service.ts   # Periodic backup integrity checks
│   └── retention-service.ts   # GFS retention algorithm
├── config/
│   ├── database-copy.ts       # The copy of the database the config backup uploads
│   ├── restore-flow.ts        # Checks a config backup, then restores it
│   ├── config-service.ts      # Facade of the JSON files of older versions
│   └── import.ts              # Import of those JSON files
├── jobs/
│   └── job-service.ts         # CRUD for backup jobs
├── notifications/
│   ├── notification-log-service.ts    # Notification log recording & queries
│   └── system-notification-service.ts # Sends system-level notifications
├── restore/
│   ├── pipeline.ts            # Download, decrypt, decompress, restore pipeline
│   ├── preflight.ts           # Pre-restore permission and version checks
│   ├── restore-service.ts     # Orchestrates the restore flow
│   ├── smart-recovery.ts      # Auto-matches encryption profiles
│   └── types.ts               # RestoreInput, RestoreResult interfaces
├── sso/
│   ├── oidc-provider-service.ts # SSO provider CRUD
│   ├── oidc-registry.ts         # The provider types the dialogs offer
│   ├── oidc-discovery.ts        # Reads the endpoints of a provider from its fields
│   └── sso-providers-model.ts   # The Sign-in tab, never the client secret
├── storage/
│   ├── storage-alert-service.ts # Per-destination usage and missing-backup alerts
│   ├── storage-service.ts       # Storage listing and deletion
│   └── verification-service.ts  # Post-upload checksum verification
├── system/
│   ├── certificate-service.ts   # TLS certificate management
│   ├── db-version-service.ts    # Tracks DB engine versions
│   ├── healthcheck-service.ts   # Adapter connectivity monitoring
│   ├── settings-model.ts        # The Settings page model, every part read at once
│   ├── system-settings-service.ts # General, Sign-in and Privacy, read with defaults and saved whole
│   ├── system-task-definitions.ts # Ids, defaults and words of the system tasks, what each follows
│   ├── system-task-service.ts   # Task settings, runs and their last run
│   ├── system-task-runs.ts      # What each task does, with a short result
│   ├── system-task-settings.ts  # The System tasks part: rows, Edit, Run now
│   └── update-service.ts        # New version detection
├── trash/
│   ├── trash-snapshot.ts      # keepInTrash: the snapshot a delete keeps, with what belongs to the record
│   ├── trash-restore.ts       # Brings a snapshot back under its own id, dropping links to what is gone
│   └── trash-service.ts       # Recently deleted: list, restore, purge and the cleanup by Data retention
├── templates/
│   ├── naming-template-service.ts    # File naming pattern templates
│   ├── retention-policy-service.ts   # Reusable retention policy CRUD
│   └── schedule-preset-service.ts    # Schedule preset CRUD
└── user/
    └── user-service.ts          # User CRUD and profile management
```

## Architecture Principle

**Server Actions are thin wrappers:**

```typescript
// src/app/actions/job.ts
"use server";

export async function createJob(data: JobInput) {
  // 1. Check permissions
  await checkPermission(PERMISSIONS.JOBS.WRITE);

  // 2. Validate input
  const validated = JobSchema.parse(data);

  // 3. Delegate to service
  const result = await JobService.create(validated);

  // 4. Revalidate cache
  revalidatePath("/dashboard/jobs");

  return result;
}
```

## Key Services

### JobService

Manages backup job configuration.

```typescript
// src/services/job-service.ts

// Shared include for all job queries (multi-destination)
const jobInclude = {
  source: true,
  destinations: {
    include: { config: true },
    orderBy: { priority: "asc" as const },
  },
  notifications: true,
};

// Input type for create/update
interface DestinationInput {
  configId: string;
  priority: number;
  retention: string; // JSON string of RetentionConfig
}

export const JobService = {
  async getAll() {
    return prisma.job.findMany({ include: jobInclude });
  },

  async create(data: {
    name: string;
    sourceId: string;
    destinations: DestinationInput[];
    // ...other job fields
  }) {
    return prisma.job.create({
      data: {
        name: data.name,
        sourceId: data.sourceId,
        // Nested create for all destinations
        destinations: {
          create: data.destinations.map((d) => ({
            configId: d.configId,
            priority: d.priority,
            retention: d.retention,
          })),
        },
        // ...other fields
      },
      include: jobInclude,
    });
  },

  async update(id: string, data: {
    destinations?: DestinationInput[];
    // ...other job fields
  }) {
    // Transaction: delete all existing destinations, then recreate
    return prisma.$transaction(async (tx) => {
      if (data.destinations) {
        await tx.jobDestination.deleteMany({ where: { jobId: id } });
        await tx.jobDestination.createMany({
          data: data.destinations.map((d) => ({
            jobId: id,
            configId: d.configId,
            priority: d.priority,
            retention: d.retention,
          })),
        });
      }

      return tx.job.update({
        where: { id },
        data: { name: data.name /* ...other fields */ },
        include: jobInclude,
      });
    });
  },

  async delete(id: string) {
    // JobDestination rows cascade-delete automatically
    return prisma.job.delete({ where: { id } });
  }
};
```

> **Why delete + recreate?** SQLite doesn't support `upsert` on composite keys well. The transaction-based `deleteMany` + `createMany` is the cleanest approach for managing the join table on updates.

### BackupService

Triggers backup execution via the queue system.

```typescript
// src/services/backup-service.ts
import { runJob } from "@/lib/runner";

export class BackupService {
  async executeJob(jobId: string) {
    // runJob creates a Pending execution and triggers processQueue()
    return runJob(jobId);
  }
}

export const backupService = new BackupService();
```

The `runJob` function in [src/lib/runner.ts](src/lib/runner.ts):
1. Creates an `Execution` record with status `"Pending"`
2. Triggers `processQueue()` from `src/lib/execution/queue-manager.ts`
3. Returns immediately with the `executionId`

### RestoreService

Orchestrates database restoration.

```typescript
// src/services/restore-service.ts
export const RestoreService = {
  async restore(input: RestoreInput) {
    // 1. Pre-flight checks
    const checks = await this.prepareRestore(input);
    if (!checks.success) throw new Error(checks.error);

    // 2. Create execution record
    const execution = await prisma.execution.create({
      data: {
        type: "Restore",
        status: "Running"
      }
    });

    // 3. Run async (background)
    this.runRestoreProcess(execution.id, input);

    return execution;
  }
};
```

### RetentionService

Implements retention with SIMPLE and SMART (GFS) modes.

```typescript
// src/services/retention-service.ts
export class RetentionService {
  static calculateRetention(
    files: FileInfo[],
    policy: RetentionConfiguration
  ): { keep: FileInfo[]; delete: FileInfo[] } {
    if (!policy || policy.mode === 'NONE') {
      return { keep: files, delete: [] };
    }

    // Locked files are always kept (not counted in policy)
    const lockedFiles = files.filter(f => f.locked);
    const processingFiles = files.filter(f => !f.locked);

    if (policy.mode === 'SIMPLE' && policy.simple) {
      // Keep the N most recent backups
      this.applySimplePolicy(processingFiles, policy.simple.keepCount);
    } else if (policy.mode === 'SMART' && policy.smart) {
      // GFS algorithm: daily, weekly, monthly, yearly
      this.applySmartPolicy(processingFiles, policy.smart);
    }

    return { keep: [...keptFiles, ...lockedFiles], delete: deletedFiles };
  }
}
```

**Retention Modes:**
- `NONE`: Keep all backups
- `SIMPLE`: Keep the last N backups
- `SMART`: GFS algorithm with daily/weekly/monthly/yearly buckets

### EncryptionService

Manages encryption profiles and key generation.

```typescript
// src/services/encryption-service.ts
export const EncryptionService = {
  async createProfile(name: string) {
    // Generate 32-byte random key
    const rawKey = crypto.randomBytes(32);

    // Encrypt with system ENCRYPTION_KEY
    const encryptedKey = encrypt(rawKey.toString("hex"));

    return prisma.encryptionProfile.create({
      data: { name, key: encryptedKey }
    });
  },

  async getDecryptedKey(profileId: string) {
    const profile = await prisma.encryptionProfile.findUnique({
      where: { id: profileId }
    });

    return decrypt(profile.key);
  }
};
```

### IntegrityService

Verifies SHA-256 checksums of all backups across all storage destinations.

```typescript
// src/services/integrity-service.ts
export class IntegrityService {
  async runFullIntegrityCheck(): Promise<IntegrityCheckResult> {
    // 1. Load all storage configs
    // 2. For each storage: list all job folders
    // 3. For each backup: download, verify checksum from .meta.json
    // 4. Report results
  }
}

interface IntegrityCheckResult {
  totalFiles: number;    // Total backup files found
  verified: number;      // Files with checksums in metadata
  passed: number;        // Checksums matched
  failed: number;        // Checksums mismatched (corruption detected)
  skipped: number;       // No checksum in metadata (older backups)
  errors: string[];      // Error messages for failed operations
}
```

**Integration:** Registered as a system task (`system.integrity_check`) in `system-task-service.ts`. Runs weekly (Sunday 4 AM), disabled by default. Can be triggered manually via Settings → System tasks → Run now.

### NotificationLogService

Records and queries notification delivery history. Every notification sent through the system (per-job and system-wide) is logged for auditing and debugging.

```typescript
// src/services/notifications/notification-log-service.ts
export async function recordNotificationLog(entry: NotificationLogEntry): Promise<void> {
  // Fire-and-forget: catches all errors to never block callers
  await prisma.notificationLog.create({ data: entry });
}

export async function getNotificationLogs(query: {
  page?: number;
  pageSize?: number;
  adapterId?: string;
  eventType?: string;
  status?: string;
}): Promise<{ data: NotificationLog[]; total: number }> {
  // Paginated query with optional filters
}

export async function getNotificationLogById(id: string): Promise<NotificationLog | null> {
  return prisma.notificationLog.findUnique({ where: { id } });
}
```

**Key Design Decisions:**
- `recordNotificationLog()` is fire-and-forget - it catches and swallows errors to never block notification delivery
- Called from two dispatch points: `04-completion.ts` (per-job) and `system-notification-service.ts` (system events)
- Stores adapter-specific rendered payloads (Discord embed, Slack blocks, email HTML) for preview rendering on the History page
- Records are cleaned up by the "Clean Old Data" system task based on `notification.logRetentionDays` SystemSetting

## Response Format

Services return a consistent format:

```typescript
interface ServiceResult<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
```

Example usage:

```typescript
async function createJob(data: JobInput): Promise<ServiceResult<Job>> {
  try {
    const job = await prisma.job.create({ data });
    return { success: true, data: job };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
```

## Error Handling

Services catch errors and return structured responses:

```typescript
export const JobService = {
  async delete(id: string): Promise<ServiceResult<void>> {
    try {
      // Check for running executions
      const running = await prisma.execution.findFirst({
        where: { jobId: id, status: "Running" }
      });

      if (running) {
        return {
          success: false,
          error: "Cannot delete job with running execution"
        };
      }

      await prisma.job.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: "Failed to delete job"
      };
    }
  }
};
```

## Testing Services

Services are easy to unit test:

```typescript
// tests/services/retention-service.test.ts
describe("RetentionService", () => {
  it("keeps daily backups", async () => {
    const files = generateTestFiles(30);
    const config = { daily: 7, weekly: 4, monthly: 3 };

    const result = await RetentionService.applyRetention(files, config);

    expect(result.keep.length).toBeLessThanOrEqual(14); // 7+4+3
    expect(result.delete.length).toBeGreaterThan(0);
  });
});
```

## Best Practices

### 1. Keep Services Focused

Each service handles one domain:

- `JobService` - Job CRUD only
- `BackupService` - Backup execution only
- Don't mix concerns

### Recently Deleted

A delete of an encryption key, a credential profile, a connection, a job or a user keeps a snapshot of the record in `DeletedRecord` before it deletes it, both in one transaction. The delete functions of those services take `DeleteOptions`: `permanently` skips the snapshot, `by` names who deleted.

```typescript
await prisma.$transaction(async (tx) => {
    if (!options.permanently) await keepInTrash(tx, "job", id, options.by);
    await tx.job.delete({ where: { id } });
});
```

- The snapshot holds the rows as they were stored, secrets still encrypted with `ENCRYPTION_KEY`, and everything that belongs to the record: the destinations, folders, channels and run ids of a job, the accounts, second factor, passkeys, API keys, preferences and picture of a user, the picture in base64, the version history of a connection.
- Each row keeps the permission of its kind, and `superAdminOnly` for the account of a SuperAdmin. `listTrash` only lists rows the viewer may handle. Restoring, purging and `permanently` need `TRASH_ADMIN_PERMISSION` (`settings:write`) on top, checked by the actions in `src/app/actions/settings/trash.ts` and by every delete action and route. Undo needs only the right of the kind, for the viewer's own delete of the last 5 minutes.
- `restoreSnapshot` creates the rows again under their old ids in one transaction. A link to a record that is gone meanwhile is dropped with a note, a taken name throws `ConflictError` and the caller asks for another.
- A new kind of record adds its kind to `TRASH_KINDS`, a snapshot in `trash-snapshot.ts` and a restore in `trash-restore.ts`. A new table that cascades from a kept record belongs in its snapshot, or the restore loses it.

### 2. Use Transactions

For multi-step operations:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.job.delete({ where: { id } });
  await tx.execution.deleteMany({ where: { jobId: id } });
});
```

### 3. Validate Early

Validate input at the service boundary:

```typescript
async create(data: unknown) {
  const validated = JobSchema.parse(data);
  return prisma.job.create({ data: validated });
}
```

### 4. Log Important Operations

```typescript
console.log(`[JobService] Created job: ${job.id}`);
```

## Related Documentation

- [Adapter System](/developer-guide/core/adapters)
- [Runner Pipeline](/developer-guide/core/runner)
- [Permission System](/developer-guide/advanced/permissions)
