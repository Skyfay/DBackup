---
applyTo: "**/*"
---

# Database Backup Manager - AI Assistant Guidelines

## Project Overview
Self-hosted web app for automating database backups (MySQL, PostgreSQL, MongoDB, MariaDB, SQLite, MSSQL, Redis, Valkey, and more) with encryption, compression, and retention policies. Built with **Next.js 16 (App Router)**, **TypeScript**, **Prisma** (SQLite), and **Shadcn UI**.

Database, storage, and notification adapter lists grow frequently. Do not treat any hardcoded adapter list in these instructions as exhaustive - run `ls src/lib/adapters/{database,storage,notification}/` to get the current, authoritative list before making claims about supported adapters.

## Language & Commands
- **Code/Comments**: English
- **Package Manager**: Always use `pnpm` (e.g., `pnpm dev`, `pnpm add`, `pnpm test`)
- **Typography**: Never use em dashes (`-`). Use a hyphen (`-`) instead where needed. Never use (`;`) - use a period (`.`) to end sentences in comments and documentation.

## Architecture (4 Layers)

### 1. App Router (`src/app`)
- **Route definitions ONLY** - no business logic
- `page.tsx`: Fetch via Services → pass to Client Components
- `actions/*.ts`: Server Actions - thin wrappers (Auth → Zod Validation → Service call → Revalidate)

```typescript
// src/app/actions/jobs.ts - canonical Server Action shape
"use server";

export async function updateJob(id: string, input: UpdateJobInput) {
  await checkPermission(PERMISSIONS.JOBS.WRITE); // 1. Auth
  const data = UpdateJobSchema.parse(input);      // 2. Zod validation
  const job = await jobService.update(id, data);  // 3. Service call (all logic lives there)
  revalidatePath("/jobs");                        // 4. Revalidate
  return { success: true, data: job };
}
```

### 2. Service Layer (`src/services`) ⭐ CORE
All business logic lives here, organized by domain:
```
src/services/
  jobs/          → job-service.ts (CRUD for backup jobs)
  backup/        → backup-service.ts (triggers runJob()), retention-service.ts (GFS), encryption-service.ts, integrity-service.ts
  restore/       → restore-service.ts, preflight.ts, pipeline.ts, smart-recovery.ts, types.ts
  auth/          → auth-service.ts, api-key-service.ts, credential-service.ts
  sso/           → oidc-provider-service.ts, oidc-registry.ts
  storage/       → storage-service.ts, verification-service.ts, storage-alert-service.ts
  notifications/ → notification-log-service.ts, system-notification-service.ts
  system/        → healthcheck-service.ts, system-task-service.ts, update-service.ts, db-version-service.ts, certificate-service.ts
  config/        → config-service.ts, export.ts, import.ts, parse.ts, restore-pipeline.ts
  templates/     → naming-template-service.ts, notification-template-service.ts, retention-policy-service.ts, schedule-preset-service.ts
  user/          → user-service.ts
  dashboard-service.ts (flat, no subdirectory)
  audit-service.ts     (flat, no subdirectory)
```

### 3. Adapter System (`src/lib/adapters`)
Plugin architecture for databases, storage, and notifications:
```typescript
// src/lib/core/interfaces.ts - Adapter contracts
DatabaseAdapter  → dump(), restore(), test(), ping(), getDatabases()
StorageAdapter   → upload(), download(), list(), delete(), ping()
NotificationAdapter → send()

// src/lib/core/registry.ts - Central registration
registry.register(MySQLAdapter);
registry.get("mysql") // Retrieve by ID
```

**Adding a new adapter** - a full adapter touches ~8-11 files, not just the adapter class. Missing any of these is the most common source of "half-registered adapter" bugs:

1. `src/lib/adapters/{database|storage|notification}/<name>.ts` (or `<name>/index.ts` if the adapter needs sub-modules) - implement the interface (`dump`/`restore`/`test` for database, `upload`/`download`/`list`/`delete` for storage, `send` for notification)
2. `src/lib/adapters/definitions/{database|storage|notification}.ts` - add the Zod config schema (`NewAdapterSchema`)
3. `src/lib/adapters/definitions/index.ts` - add an entry to `ADAPTER_DEFINITIONS` (`id`, `type`, `name`, `configSchema`, `group` for storage)
4. `src/lib/adapters/index.ts` - import the adapter class and call `registry.register(...)` in `registerAdapters()`
5. `src/lib/core/credential-requirements.ts` - if the adapter uses a credential profile, add an entry to `ADAPTER_CREDENTIAL_REQUIREMENTS[id]`
6. `src/components/adapter/utils.ts` - add the adapter to `ADAPTER_ICON_MAP` (and `ADAPTER_COLOR_MAP` if applicable), otherwise it renders with a generic fallback icon in the UI
7. `src/components/adapter/form-constants.ts` - add field keys to the relevant `*_CONNECTION_KEYS`/`*_CONFIG_KEYS` and `PLACEHOLDERS` if the adapter needs custom form field grouping/placeholders
8. Database adapters only: `src/lib/backup-extensions.ts` - add the dump file extension and description
9. Tests (if the adapter is testable in CI): `docker-compose.test.yml` (service definition) and `tests/integration/test-configs.ts` (`testDatabases`/`CLI_REQUIREMENTS`)
10. Docs (per `docs.instructions.md` template): a new page under `docs/user-guide/{sources|destinations|notifications}/<name>.md`, plus a row in the relevant `docs/developer-guide/adapters/*.md` table

**Adapter connectivity methods:**
- `test()` – full write/delete verification (~15 s timeout). Used for manual connection tests.
- `ping()` – lightweight connectivity check, no test file written. Used by the health check system. Falls back to `test()` if not implemented.

### 4. Backup Pipeline (`src/lib/runner`)
Step-based execution (Queue Manager → Runner → Steps):
```
01-initialize.ts → Fetch Job, resolve adapters
02-dump.ts       → Execute database dump + compression/encryption
03-upload.ts     → Upload to storage destination (sets Partial status on partial failure)
04-completion.ts → Cleanup temp files, finalize
05-retention.ts  → Apply retention policy (delete old backups)
```
Context flows through `RunnerContext` (see `src/lib/runner/types.ts`).

### Multi-DB TAR Format
All database adapters use a unified TAR archive for multi-database backups:
- **Utilities**: `src/lib/adapters/database/common/tar-utils.ts`
- **Types**: `src/lib/adapters/database/common/types.ts` (TarManifest, DatabaseEntry)
- Single-DB backups remain direct dump files (no TAR wrapper)
- TAR contains `manifest.json` + individual dump files per database

## Execution Status Types

Backup and restore executions can have the following statuses:
- `Pending` – queued, not yet started
- `Running` – currently executing
- `Success` – all destinations succeeded
- `Partial` – some destinations succeeded, some failed (set in `03-upload.ts`)
- `Failed` – dump failed or all uploads failed
- `Cancelled` – user-cancelled

## Security (RBAC)

**Mandatory** permission check at top of every Server Action/API Route:
```typescript
// src/app/actions/user.ts
await checkPermission(PERMISSIONS.USERS.WRITE);
```
Permissions defined in [src/lib/auth/permissions.ts](src/lib/auth/permissions.ts). Access control via [src/lib/auth/access-control.ts](src/lib/auth/access-control.ts).

## Key Patterns

### Zod Validation
Adapter configs are defined in `src/lib/adapters/definitions/` (split by category):
- `definitions/database.ts` – MySQLSchema, PostgresSchema, MongoSchema, etc.
- `definitions/storage.ts` – S3Schema, SFTPSchema, LocalSchema, etc.
- `definitions/notification.ts` – DiscordSchema, EmailSchema, etc.
- `definitions/shared.ts` – shared field helpers

```typescript
// src/lib/adapters/definitions/database.ts
export const MySQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(3306),
  // ...
});
```

### API Response Format
```typescript
return { success: boolean, message?: string, data?: any, error?: string }
```

### Dates
- **Storage**: Always UTC (ISO 8601)
- **Library**: `date-fns` / `date-fns-tz`
- **Display**: Use the `useDateFormatter` hook from `src/hooks/use-date-formatter.ts`. Respects user timezone preference.
- **Backend utilities**: `src/lib/utils.ts` exports `formatBytes`, `formatDuration`, `compareVersions` (no date formatting).

## Developer Workflows

```bash
pnpm dev                  # Start dev server - auto-applies pending migrations on startup
pnpm test                 # Unit tests (vitest)
pnpm test:integration     # Integration tests against real DB containers
pnpm test:ui              # Spin up 16 test DBs + seed local DB for manual testing
pnpm run build            # Production build (validate before commit)
npx prisma migrate dev    # Create a new DB migration (stop dev server first)
pnpm run database:reset   # Reset dev DB from scratch (drops + recreates via all migrations)
```

**Test Infrastructure**: See [docker-compose.test.yml](docker-compose.test.yml) for MySQL/PG/Mongo containers.

### Prisma Migrations - IMPORTANT

`pnpm dev` automatically runs `prisma migrate deploy` on startup, so the local DB is always up to date with all pending migrations. No manual step needed after pulling changes that include new migrations.

**Never run `prisma migrate dev` while `pnpm dev` is running.** The dev server holds an open SQLite connection. `migrate dev` can trigger an interactive DB reset (on drift), which conflicts with the file lock and crashes the Node process - and often VS Code with it.

**Never use `prisma db push`.** It applies schema changes without creating a migration file, causing the local `_prisma_migrations` table to diverge from the actual schema. This breaks `database:deploy` in production and for other developers. Always create a proper migration.

**Safe workflow for schema changes:**
1. Stop the dev server first (Ctrl+C in the node terminal)
2. Run `npx prisma migrate dev --name <migration-name>`
3. Restart `pnpm dev` - migrations apply automatically on startup

**Reset dev DB from scratch:** `pnpm run database:reset` (runs `prisma migrate reset` - drops and recreates from all migrations).

## Queue System (`src/lib/execution/queue-manager.ts`)

Backups run asynchronously via a **FIFO queue** with configurable concurrency:

```
runJob(jobId) → Creates Execution (status: "Pending") → processQueue()
                                                            ↓
                        Checks SystemSetting "maxConcurrentJobs" (default: 1)
                                                            ↓
                        Starts next pending job if slots available
```

**Key Points:**
- `processQueue()` is triggered after each job enqueue and after each completion
- Jobs execute via `performExecution()` in [src/lib/runner.ts](src/lib/runner.ts)
- Concurrency limit stored in `SystemSetting` table (key: `maxConcurrentJobs`)

## System Tasks (`src/services/system/system-task-service.ts`)

9 built-in background tasks run on configurable cron schedules with enable/disable toggles. Runner infrastructure lives in `src/lib/runner/system-task-runner.ts`.

| Task | Default Schedule | Enabled |
|------|-----------------|---------|
| `HEALTH_CHECK` | Every minute | Yes |
| `UPDATE_DB_VERSIONS` | Hourly | Yes |
| `REFRESH_STORAGE_STATS` | Hourly | Yes |
| `WARMUP_STORAGE_CACHE` | Hourly | Yes |
| `CHECK_FOR_UPDATES` | Daily midnight | Yes |
| `CLEAN_OLD_LOGS` | Daily midnight | Yes |
| `SYNC_PERMISSIONS` | Daily midnight | Yes |
| `CONFIG_BACKUP` | Daily 3 AM | No |
| `INTEGRITY_CHECK` | Weekly Sunday 4 AM | No |

Managed via Settings > System Tasks or `POST /api/settings/system-tasks`.

## Health Check System (`src/services/system/healthcheck-service.ts`)

Runs every minute (via `HEALTH_CHECK` system task). Pings all configured adapters and writes `HealthCheckLog` records (status: `ONLINE` / `DEGRADED` / `OFFLINE`, latency in ms).

- Uses `ping()` first, falls back to `test()` if not implemented
- Max 5 concurrent checks to avoid overloading the system
- Deduplicates offline notifications with 24 h cooldown
- `GET /api/adapters/[id]/health-history` – paginated history with uptime % and avg latency

## SSO/OIDC Integration

**Architecture:**
```
src/lib/adapters/oidc/                    → Provider adapters
src/services/sso/oidc-provider-service.ts → CRUD for SSO providers
src/services/sso/oidc-registry.ts         → Runtime provider registration for better-auth
```

**Supported Providers** (`src/lib/adapters/oidc/`):
- `authentik.ts` – Pre-configured for Authentik
- `pocket-id.ts` – Pre-configured for PocketID
- `keycloak.ts` – Pre-configured for Keycloak
- `generic.ts` – Manual OIDC configuration (any provider)

**Adding a new OIDC Adapter:**
1. Create `src/lib/adapters/oidc/{provider}.ts` implementing `OIDCAdapter` interface
2. Define `inputs` (form fields), `inputSchema` (Zod), and `getEndpoints()` method
3. Register in the OIDC adapter index

**Database:** `SsoProvider` model stores encrypted `clientId`/`clientSecret`, endpoints, and domain for email-based matching.

## Encryption Pipeline

**Two-layer encryption architecture:**

### 1. System Encryption (`ENCRYPTION_KEY` env var)
Used to encrypt sensitive data at rest (DB connection passwords, SSO secrets):
```typescript
// src/lib/crypto/index.ts
encrypt(plaintext)  → AES-256-GCM encrypted (stored in DB)
decrypt(ciphertext) → Original value
decryptConfig(obj)  → Recursively decrypts all encrypted fields in config objects
```

### 2. Backup Encryption (Encryption Profiles)
User-managed keys for backup files:

```typescript
// src/services/backup/encryption-service.ts
createEncryptionProfile(name) → Generates 32-byte key, encrypts with system key, stores in DB

// src/lib/crypto/stream.ts (Streaming for large files)
createEncryptionStream(key) → Returns { stream, iv, getAuthTag() }
createDecryptionStream(key, iv, authTag) → Returns decryption stream
```

**Backup Flow with Encryption:**
```
Database Dump → Compression Stream (optional) → Encryption Stream → Storage
                                                      ↓
                                    Metadata stored: { iv, authTag, profileId }
```

**Metadata File** (`.meta.json`): Stores `iv`, `authTag`, `compression`, and `profileId` for decryption. See `BackupMetadata` interface in [src/lib/core/interfaces.ts](src/lib/core/interfaces.ts).

## Restore Pipeline (`src/services/restore/restore-service.ts`)

Restore runs as a background process with live progress tracking. Implementation is split across sub-modules in `src/services/restore/`:
- `preflight.ts` – pre-flight checks (DB permissions, version compatibility)
- `pipeline.ts` – download, decrypt, decompress, restore orchestration
- `smart-recovery.ts` – auto-matches encryption profiles when metadata is missing

```
RestoreService.restore(input)
    ↓
1. Pre-flight checks:
   - prepareRestore() → Verify DB permissions (can create/overwrite?)
   - Version compatibility → Reject if backup version > target server
    ↓
2. Create Execution (type: "Restore", status: "Running")
    ↓
3. runRestoreProcess() (async background):
   - Download backup from storage → temp file
   - Detect encryption (read .meta.json) → Decrypt stream
   - Detect compression → Decompress stream
   - Call DatabaseAdapter.restore(config, tempFile)
   - Cleanup temp files
```

**Key Features:**
- **Database Mapping**: Restore to different DB names via `databaseMapping` parameter
- **Privileged Auth**: Optional elevated credentials for CREATE DATABASE permissions
- **Version Guard**: Prevents restoring newer dumps to older DB servers
- **Streaming Decryption**: Uses same `crypto/stream.ts` as backup (reverse direction)

**Input Interface:**
```typescript
interface RestoreInput {
  storageConfigId: string;       // Source storage adapter
  file: string;                  // Backup file path
  targetSourceId: string;        // Target database adapter
  targetDatabaseName?: string;   // Override single DB name
  databaseMapping?: Record<string, string>; // Multi-DB rename mapping
  privilegedAuth?: { user, password };      // Elevated credentials
}
```

## Integrity & Verification

### Post-Upload Verification (`src/services/storage/verification-service.ts`)
After every backup upload, checksums are validated:
- SHA-256 and MD5 checksums calculated and stored in `.meta.json`
- Native adapter verification used for S3, Google Drive, OneDrive (no re-download needed)
- Falls back to full file download for other storage adapters

### Periodic Integrity Checks (`src/services/backup/integrity-service.ts`)
Full verification of stored backups (scheduled weekly via `INTEGRITY_CHECK` task, disabled by default):
- **Jobs mode**: Only checks files linked to enabled jobs
- **Destinations mode**: Full storage scan regardless of job associations
- Filters: skip already-passed files, max age days, max size MB
- Returns: total, verified, passed, failed, skipped counts with error details

## Storage Alerts (`src/services/storage/storage-alert-service.ts`)

Per-destination configurable alerts with state tracking:
- **Usage Spike** – alert when size grows by X% unexpectedly
- **Storage Limit** – alert when total size exceeds a configured threshold
- **Missing Backup** – alert if no backup has been created in the past N hours

State tracking: notifies once on trigger, re-notifies after 24 h cooldown while active, resets automatically when resolved.

## Config Backup (`src/lib/runner/config-runner.ts`)

System task (`CONFIG_BACKUP`) that exports the full system configuration to a storage destination:
- Includes: adapters, jobs, users, groups, settings, schedules, policies
- Optional inclusion of secrets requires an encryption profile (cannot export secrets unencrypted)
- Output: `.tar.gz` or `.tar.gz.enc` stored in a chosen destination
- Disabled by default. Enable in Settings > System Tasks.

## Credential Profiles (`src/services/auth/credential-service.ts`)

Reusable named credential sets encrypted with the system `ENCRYPTION_KEY`:
- Types: `USERNAME_PASSWORD`, `SSH_KEY`, `ACCESS_KEY`, `TOKEN`, `SMTP`, `WEBHOOK`, `OAUTH`
- Assignable to multiple adapters as primary or SSH credentials

## Notification Events

Two distinct event scopes, both defined in `src/lib/notifications/` (`types.ts` for the `NOTIFICATION_EVENTS` map, `events.ts` for `EVENT_DEFINITIONS`):

- **Global events** (`EVENT_DEFINITIONS` in `events.ts`, ~14 entries) - configurable system-wide (enable/disable, reminder interval, target recipient) via Settings > Notifications:

  | Category | Events |
  |----------|--------|
  | Auth | `USER_LOGIN`, `USER_CREATED` |
  | Restore | `RESTORE_COMPLETE`, `RESTORE_FAILURE` |
  | System | `CONFIG_BACKUP`, `SYSTEM_ERROR` |
  | Storage | `STORAGE_USAGE_SPIKE`, `STORAGE_LIMIT_WARNING`, `STORAGE_MISSING_BACKUP` |
  | Updates | `UPDATE_AVAILABLE` |
  | Backup | `INTEGRITY_CHECK_FAILURE` |
  | Health | `CONNECTION_OFFLINE`, `CONNECTION_ONLINE`, `DB_VERSION_CHANGED` |

- **Per-job backup events** (`BACKUP_SUCCESS`, `BACKUP_PARTIAL`, `BACKUP_FAILURE`) are intentionally **not** in `EVENT_DEFINITIONS` - they are configured per-job (Job → Notify tab), not globally. Their message templates live in `src/lib/notifications/templates.ts` and are triggered by the runner pipeline (`04-completion.ts`).

Notification log: `src/services/notifications/notification-log-service.ts`.

## File Conventions
- **Naming**: `kebab-case` (e.g., `backup-service.ts`, `user-table.tsx`)
- **Exports**: Named exports preferred
- **Max file size**: ~300 lines, then split (e.g., Pipeline Pattern in `runner/steps/`)

## Logging & Error Handling

**IMPORTANT:** Never use `console.log`, `console.error`, or `console.warn` directly. Use the centralized logger instead.

### System Logger (`src/lib/logging/logger.ts`)
```typescript
import { logger } from "@/lib/logging/logger";

// Create a child logger with context
const log = logger.child({ service: "MyService" });

// Log levels: debug, info, warn, error
log.info("Operation started", { jobId: "123" });
log.error("Operation failed", { jobId: "123" }, wrapError(error));
```

### Custom Errors (`src/lib/logging/errors.ts`)
```typescript
import { AdapterError, wrapError, getErrorMessage } from "@/lib/logging/errors";

// Throw specific errors
throw new AdapterError("mysql", "Connection timeout");

// Wrap unknown errors
catch (e: unknown) {
  log.error("Failed", {}, wrapError(e));
  throw wrapError(e);
}
```

**Error Classes:**
- `DBackupError` (base), `AdapterError`, `ConnectionError`, `ConfigurationError`
- `ServiceError`, `NotFoundError`, `ValidationError`
- `PermissionError`, `AuthenticationError`
- `BackupError`, `RestoreError`, `EncryptionError`, `QueueError`

### Environment Variables
- `LOG_LEVEL`: `debug` | `info` (default) | `warn` | `error`
- `SQLITE_WAL_MODE`: `true` (default) | `false`. WAL mode is on by default for the Prisma SQLite DB. Set to `false` to opt out. See `src/lib/prisma.ts`.

## Quick Reference

| Concern | Location |
|---------|----------|
| DB Schema | [prisma/schema.prisma](prisma/schema.prisma) |
| Types/Interfaces | [src/lib/core/](src/lib/core/) |
| Permissions | [src/lib/auth/permissions.ts](src/lib/auth/permissions.ts) |
| Adapters | [src/lib/adapters/](src/lib/adapters/) |
| Services | [src/services/](src/services/) |
| Server Actions | [src/app/actions/](src/app/actions/) |
| Scheduler (Cron) | [src/lib/server/scheduler.ts](src/lib/server/scheduler.ts) |
| System Tasks | [src/services/system/system-task-service.ts](src/services/system/system-task-service.ts) |
| Health Checks | [src/services/system/healthcheck-service.ts](src/services/system/healthcheck-service.ts) |
| Integrity Checks | [src/services/backup/integrity-service.ts](src/services/backup/integrity-service.ts) |
| Post-Upload Verification | [src/services/storage/verification-service.ts](src/services/storage/verification-service.ts) |
| Config Backup Runner | [src/lib/runner/config-runner.ts](src/lib/runner/config-runner.ts) |
| Credential Profiles | [src/services/auth/credential-service.ts](src/services/auth/credential-service.ts) |
| Storage Alerts | [src/services/storage/storage-alert-service.ts](src/services/storage/storage-alert-service.ts) |
| Audit Logging | [src/services/audit-service.ts](src/services/audit-service.ts) |
| Crypto (encrypt/decrypt) | [src/lib/crypto/index.ts](src/lib/crypto/index.ts) |
| Crypto (streams) | [src/lib/crypto/stream.ts](src/lib/crypto/stream.ts) |
| Logger | [src/lib/logging/logger.ts](src/lib/logging/logger.ts) |
| Error Classes | [src/lib/logging/errors.ts](src/lib/logging/errors.ts) |
