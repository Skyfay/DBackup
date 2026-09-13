# Backend and Application Logic

Rules for `src/app/actions/`, `src/app/api/`, `src/services/`, and `src/lib/`.

> **Editing any `.tsx` file - including pages and client components under `src/app/` - means reading [components/CLAUDE.md](components/CLAUDE.md) first.** That guide owns the design system (ScrollArea, dialogs, forms, tables, dark mode) and applies project-wide, not only to `src/components/`.

Adapter rules live in [lib/adapters/CLAUDE.md](lib/adapters/CLAUDE.md).

## Layer boundaries

| Layer | Path | Allowed to contain |
| :--- | :--- | :--- |
| Routes | `src/app/**/page.tsx` | Data fetching via services, prop passing. No business logic. |
| Server Actions | `src/app/actions/**` | Auth check, Zod validation, one service call, revalidate. Nothing else. |
| API routes | `src/app/api/**` | Auth context, permission check, service call, response shaping. |
| Services | `src/services/**` | All business logic. The only layer that owns rules. |
| Adapters | `src/lib/adapters/**` | Protocol-specific I/O behind a shared interface. |

Services must not perform permission checks - that is the caller's job. Services must not import from `src/app/`.

### Service domains

```
src/services/
  jobs/          job-service.ts
  backup/        backup-service.ts (runJob), retention-service.ts (GFS), encryption-service.ts, integrity-service.ts
  restore/       restore-service.ts, preflight.ts, pipeline.ts, smart-recovery.ts, types.ts
  auth/          auth-service.ts, api-key-service.ts, credential-service.ts
  sso/           oidc-provider-service.ts, oidc-registry.ts
  storage/       storage-service.ts, verification-service.ts, storage-alert-service.ts
  notifications/ notification-log-service.ts, system-notification-service.ts
  system/        healthcheck-service.ts, system-task-service.ts, update-service.ts, db-version-service.ts, certificate-service.ts
  config/        config-service.ts, export.ts, import.ts, parse.ts, restore-pipeline.ts
  templates/     naming-template-service.ts, notification-template-service.ts, retention-policy-service.ts, schedule-preset-service.ts
  user/          user-service.ts
  audit-service.ts, dashboard-service.ts   (flat, no subdirectory)
```

## Security: RBAC is mandatory

Two guard patterns exist. Use the one matching the entry point.

**Server Actions** - `checkPermission` must be the first meaningful line:

```typescript
"use server";

export async function updateJob(id: string, input: UpdateJobInput) {
  await checkPermission(PERMISSIONS.JOBS.WRITE); // 1. Auth
  const data = UpdateJobSchema.parse(input);      // 2. Zod validation
  const job = await jobService.update(id, data);  // 3. Service call
  revalidatePath("/jobs");                        // 4. Revalidate
  return { success: true, data: job };
}
```

**API routes** - `getAuthContext` supports both session cookies and API key Bearer tokens:

```typescript
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(await headers());
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await checkPermissionWithContext(ctx, PERMISSIONS.SOURCES.READ);
  // ...
}
```

Both helpers come from `@/lib/auth/access-control`. Constants live in `@/lib/auth/permissions`.

Rules:
- The guard runs **before** any data is fetched. Loading first and checking after is an information leak.
- Match the permission to the operation: mutations use `.WRITE` / `.DELETE`, reads use `.READ`.
- Self-service actions where any authenticated user may act on their own data are exempt, and must be annotated `/** @no-permission-required */` with a justification.
- Intentionally public routes (health check, auth callbacks, OAuth redirects) need an explicit comment saying why.

Permission categories: `USERS`, `GROUPS`, `SOURCES`, `DESTINATIONS`, `JOBS`, `STORAGE`, `HISTORY`, `DASHBOARD`, `AUDIT`, `NOTIFICATIONS`, `VAULT`, `PROFILE`, `SETTINGS`, `API_KEYS`. Storage has extra verbs (`DOWNLOAD`, `RESTORE`, `DELETE`), jobs have `EXECUTE`.

## Validation

Zod on every boundary. Adapter config schemas live in `src/lib/adapters/definitions/`, split into `database.ts`, `storage.ts`, `notification.ts`, and `shared.ts` for common field helpers.

```typescript
export const MySQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(3306),
});
```

Use `z.coerce` for anything arriving from a form or query string.

## Response format

```typescript
{ success: boolean, message?: string, data?: any, error?: string }
```

Client code relies on this shape, including mocked responses in tests.

## Database access

- Prisma Client for everything. No raw SQL unless there is a measured performance reason, and then leave a comment saying why.
- Schema changes go through a migration file. See the migration workflow in the root [CLAUDE.md](../CLAUDE.md).
- The target databases DBackup backs up are reached through adapters, never through Prisma. Prisma is only for DBackup's own SQLite store.

## Logging and errors

```typescript
import { logger } from "@/lib/logging/logger";
import { AdapterError, wrapError, getErrorMessage } from "@/lib/logging/errors";

const log = logger.child({ service: "MyService" });

log.info("Operation started", { jobId });
log.error("Operation failed", { jobId }, wrapError(error));
```

- Never `console.*`, including inside `.catch()` handlers.
- Log specific fields, never whole session, user, or config objects - configs carry decrypted secrets.
- Error classes: `DBackupError` (base), `AdapterError`, `ConnectionError`, `ConfigurationError`, `ServiceError`, `NotFoundError`, `ValidationError`, `PermissionError`, `AuthenticationError`, `BackupError`, `RestoreError`, `EncryptionError`, `QueueError`.
- Wrap unknown catches with `wrapError(e)` before logging or rethrowing.
- Errors returned to the client are sanitized. Internal detail goes to the log, not the response.

## Dates

Store UTC (ISO 8601). Manipulate with `date-fns` / `date-fns-tz`. Never rely on local system time on the server. Backend formatting helpers in `src/lib/utils.ts`: `formatBytes`, `formatDuration`, `compareVersions`. Display formatting is a UI concern - see [components/CLAUDE.md](components/CLAUDE.md).

## Backup pipeline (`src/lib/runner`)

```
01-initialize.ts  Fetch job, resolve adapters
02-dump.ts        Database dump + compression/encryption
03-upload.ts      Upload to destinations (sets Partial on partial failure)
04-completion.ts  Cleanup temp files, finalize, fire notifications
05-retention.ts   Apply retention policy
```

Context flows through `RunnerContext` in `src/lib/runner/types.ts`. Add a step by adding a file here, not by growing an existing one.

**Execution statuses**: `Pending`, `Running`, `Success`, `Partial`, `Failed`, `Cancelled`. `Partial` is set in `03-upload.ts` when some destinations succeed and others fail.

## Queue system (`src/lib/execution/queue-manager.ts`)

FIFO queue with configurable concurrency:

```
runJob(jobId) -> Execution (Pending) -> processQueue()
                                            |
                    reads SystemSetting "maxConcurrentJobs" (default 1)
                                            |
                    starts next pending job if a slot is free
```

`processQueue()` runs after every enqueue and every completion. Jobs execute via `performExecution()` in `src/lib/runner.ts`.

## Encryption (two layers)

**System encryption** (`ENCRYPTION_KEY` env var) protects secrets at rest - DB passwords, SSO secrets, credential profiles:

```typescript
encrypt(plaintext) / decrypt(ciphertext)   // AES-256-GCM, src/lib/crypto/index.ts
decryptConfig(obj)                          // recursively decrypts config objects
```

**Backup encryption** (encryption profiles) protects backup files with user-managed keys. `createEncryptionProfile(name)` generates a 32-byte key and stores it encrypted with the system key. Streaming lives in `src/lib/crypto/stream.ts`.

```
Dump -> Compression stream (optional) -> Encryption stream -> Storage
                                              |
                          .meta.json: { iv, authTag, compression, profileId }
```

`BackupMetadata` is defined in `src/lib/core/interfaces.ts`. Restore reverses the same streams.

## Restore pipeline (`src/services/restore/`)

Runs as a background process with live progress. Split across `preflight.ts` (DB permissions, version compatibility), `pipeline.ts` (download, decrypt, decompress, restore), and `smart-recovery.ts` (auto-matches encryption profiles when metadata is missing).

```typescript
interface RestoreInput {
  storageConfigId: string;
  file: string;
  targetSourceId: string;
  targetDatabaseName?: string;
  databaseMapping?: Record<string, string>;   // multi-DB rename
  privilegedAuth?: { user: string; password: string }; // for CREATE DATABASE
}
```

A version guard rejects restoring a newer dump onto an older server.

## System tasks (`src/services/system/system-task-service.ts`)

Background tasks on cron schedules with enable/disable toggles. Runner infrastructure in `src/lib/runner/system-task-runner.ts`, managed via Settings > System Tasks or `POST /api/settings/system-tasks`.

| Task | Default schedule | Enabled |
| :--- | :--- | :--- |
| `HEALTH_CHECK` | Every minute | Yes |
| `UPDATE_DB_VERSIONS` | Hourly | Yes |
| `REFRESH_STORAGE_STATS` | Hourly | Yes |
| `WARMUP_STORAGE_CACHE` | Hourly | Yes |
| `CHECK_FOR_UPDATES` | Daily midnight | Yes |
| `CLEAN_OLD_LOGS` | Daily midnight | Yes |
| `SYNC_PERMISSIONS` | Daily midnight | Yes |
| `CONFIG_BACKUP` | Daily 3 AM | No |
| `INTEGRITY_CHECK` | Weekly Sunday 4 AM | No |

Scheduled and internal tasks run as system and bypass permission checks.

## Health checks (`src/services/system/healthcheck-service.ts`)

Runs every minute. Pings all configured adapters and writes `HealthCheckLog` records (`ONLINE` / `DEGRADED` / `OFFLINE`, latency in ms). Uses `ping()` first, falls back to `test()`. Max 5 concurrent checks. Offline notifications are deduplicated with a 24 h cooldown. History via `GET /api/adapters/[id]/health-history`.

## Integrity and verification

- **Post-upload** (`src/services/storage/verification-service.ts`): SHA-256 and MD5 checksums stored in `.meta.json`. S3, Google Drive, and OneDrive use native verification. Others fall back to a full download.
- **Periodic** (`src/services/backup/integrity-service.ts`): weekly `INTEGRITY_CHECK` task, disabled by default. Jobs mode checks only files linked to enabled jobs, destinations mode scans all storage. Filters for already-passed files, max age, and max size.

## Storage alerts (`src/services/storage/storage-alert-service.ts`)

Per-destination alerts: usage spike (growth over X%), storage limit (total size over threshold), missing backup (nothing new in N hours). Notifies once on trigger, re-notifies after a 24 h cooldown while still active, resets automatically when resolved.

## Notifications

Defined in `src/lib/notifications/` - `types.ts` holds the `NOTIFICATION_EVENTS` map, `events.ts` holds `EVENT_DEFINITIONS`.

**Global events** (configurable system-wide under Settings > Notifications):

| Category | Events |
| :--- | :--- |
| Auth | `USER_LOGIN`, `USER_CREATED` |
| Restore | `RESTORE_COMPLETE`, `RESTORE_FAILURE` |
| System | `CONFIG_BACKUP`, `SYSTEM_ERROR` |
| Storage | `STORAGE_USAGE_SPIKE`, `STORAGE_LIMIT_WARNING`, `STORAGE_MISSING_BACKUP` |
| Updates | `UPDATE_AVAILABLE` |
| Backup | `INTEGRITY_CHECK_FAILURE` |
| Health | `CONNECTION_OFFLINE`, `CONNECTION_ONLINE`, `DB_VERSION_CHANGED` |

**Per-job events** (`BACKUP_SUCCESS`, `BACKUP_PARTIAL`, `BACKUP_FAILURE`) are deliberately **not** in `EVENT_DEFINITIONS`. They are configured per job (Job > Notify tab), their templates live in `src/lib/notifications/templates.ts`, and the runner fires them from `04-completion.ts`.

## Config backup (`src/lib/runner/config-runner.ts`)

`CONFIG_BACKUP` system task exports the full system configuration (adapters, jobs, users, groups, settings, schedules, policies) as `.tar.gz` or `.tar.gz.enc` to a chosen destination. Including secrets requires an encryption profile - secrets can never be exported unencrypted. Disabled by default.

## Credential profiles (`src/services/auth/credential-service.ts`)

Reusable named credential sets encrypted with the system key. Types: `USERNAME_PASSWORD`, `SSH_KEY`, `ACCESS_KEY`, `TOKEN`, `SMTP`, `WEBHOOK`, `OAUTH`. Assignable to multiple adapters as primary or SSH credentials.

## SSO / OIDC

```
src/lib/adapters/oidc/                    Provider adapters
src/services/sso/oidc-provider-service.ts CRUD for SSO providers
src/services/sso/oidc-registry.ts         Runtime registration for better-auth
```

Providers: `authentik.ts`, `pocket-id.ts`, `keycloak.ts`, `generic.ts`. A new provider implements the `OIDCAdapter` interface with `inputs` (form fields), `inputSchema` (Zod), and `getEndpoints()`, then registers in the OIDC adapter index. The `SsoProvider` model stores encrypted `clientId` / `clientSecret`, endpoints, and a domain for email-based matching.
