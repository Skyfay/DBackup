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
  jobs/          job-service.ts, job-list-service.ts and job-overview.ts (the rows of the Jobs page), job-page-service.ts (one page of the Jobs page with its counts, the page reads only that), schedule-load-service.ts (the schedule picker), job-timeline-service.ts (the Timeline and Upcoming views, with the queue played through by `planQueue` in `lib/core/queue-plan.ts`), queue-snapshot.ts and queue-schedules.ts (the scheduled jobs of every tenant with their usual length and their planned runs, cached once for all, read by other-tenant-queue.ts)
  backup/        backup-service.ts (runJob), retention-service.ts (GFS), encryption-service.ts, integrity-service.ts
  restore/       restore-service.ts, preflight.ts, pipeline.ts, smart-recovery.ts, types.ts, shared-restore-log.ts (scrubs the run of a customer's restore of a shared database down to that database), run-logs.ts (that run and the provider's run beside it with the whole log), restore-record.ts (what the restore read and every database and folder it restored, kept in the metadata of its run)
  auth/          auth-service.ts, api-key-service.ts, credential-service.ts, api-keys-model.ts (API keys tab page model), api-key-details.ts (the panel of a key), login-page-service.ts (what the public login page shows, never a secret of a provider), password-policy-service.ts (the rules of Settings > Passwords)
  sso/           oidc-provider-service.ts, oidc-registry.ts, oidc-discovery.ts (the endpoints of a provider), sso-providers-model.ts (SSO tab page model), sso-connections-service.ts (the providers linked to the own account), email-domain-claims.ts (an email whose domain the provider of another tenant claims)
  storage/       storage-service.ts, verification-service.ts, storage-alert-service.ts, storage-lookup.ts, backup-contents.ts (analyze and browse an archive), restore-path-check.ts
  databases/     database-list-service.ts (cached database lists), database-explorer-service.ts (Database Explorer page model), database-page-service.ts with database-list-model.ts and database-facts.ts (the Databases tab a page at a time)
  history/       run-list-service.ts (the runs of the History page), newest-runs.ts (the newest run of each job in one query, never an `OR` per job, which SQLite refuses at a few thousand jobs), run-detail-service.ts (the page of a run), run-steps.ts, run-summary.ts, run-dumps.ts, restore-summary.ts with restore-rows.ts (the summary of a restore run, from its record), run-checks.ts, run-problems.ts, known-problems.ts
  vault/         vault-keys.ts and vault-credentials.ts (the tabs of the Vault page), vault-audit.ts (what the audit log knows), key-id.ts, vault-counts.ts
  notifications/ notification-log-service.ts, system-notification-service.ts, notification-settings-service.ts (the Notifications part: events, default channels, Send a test), notification-test-data.ts
  system/        healthcheck-service.ts, system-task-service.ts (with -definitions, -runs, -settings), update-service.ts, db-version-service.ts, certificate-service.ts, settings-model.ts (Settings page model), system-settings-service.ts (General, Sign-in, Privacy), rate-limit-settings-service.ts, data-retention-service.ts, database-service.ts, database-optimize.ts (the system task Optimize the database), login-image-service.ts (the picture of the login page, checked by its bytes)
  config/        database-copy.ts (the copy the backup uploads), copy-inspect.ts, copy-rekey.ts, open-backup.ts, pending-restores.ts, restore-staging.ts and restore-flow.ts (its restore), import.ts with import-context.ts and one import-*.ts per part (JSON files of older versions), config-service.ts, parse.ts, restore-pipeline.ts, config-backup-settings.ts (the Configuration backup part)
  templates/     naming-template-service.ts, notification-template-service.ts, retention-policy-service.ts, schedule-preset-service.ts, exclude-pattern-preset-service.ts, templates-model.ts (Templates page model), retention-targets.ts and retention-preview.ts (what a retention change removes)
  user/          user-service.ts, users-model.ts (Users tab page model), user-details.ts (the panel of a user), group-service.ts, groups-model.ts (Groups tab page model), tenant-group-templates.ts (groups the platform makes once for tenants, a linked group in each), group-details.ts (the history of a group), account-visibility.ts (who may see which account and its picture), preference-service.ts (table layouts, views and the colors of the tasks), profile-model.ts (Profile page model), avatar-service.ts (the pictures of the people, in the database) with avatar-import.ts (moves the files of earlier versions in once at the start)
  trash/         Recently deleted: trash-snapshot.ts (keepInTrash, the snapshot a delete keeps), trash-restore.ts, trash-service.ts (list, restore, purge, cleanup)
  dashboard/     overview-service.ts (page model), aggregates.ts (cached history), health.ts, trends.ts, cache.ts
  audit/         the Audit log tab: audit-list-service.ts (page, filters, numbers), audit-details.ts, audit-timeline.ts, audit-export.ts (CSV)
  search/        search-service.ts (what the search in the header finds by name, only of the kinds its caller allows) with search-admin.ts (people, templates, Vault), search-types.ts (shared with the browser)
  tenant/        tenant-service.ts (create, rename, delete, switch, `setSharing`), tenant-seed.ts (the built-in templates of a new tenant), membership-service.ts (the group of a user in a tenant, platform admins), invitation-service.ts (links that add someone to a tenant), database-assignments.ts (the databases of a shared server given to customers), shared-servers.ts (a shared server that outlives its connection, `sharesWithCustomers` and `assertCustomer`), database-moves.ts (a database moved to another server), shared-databases.ts with shared-places.ts and shared-backups.ts (what a customer sees of them, the one path that reads across tenants on purpose) and shared-on-demand.ts (a backup a customer starts) with shared-backup-runs.ts (the customer's short run of it, a follower of the real run, see `src/lib/execution/follower-runs.ts`), tenant-network.ts (whether a tenant reaches the local network, `Tenant.blocksLocalNetwork` with `allowedNetworks`, checked for every host a connection dials, see `src/lib/network/` and `src/lib/adapters/dialed-hosts.ts`). Which tenants give databases away is `Tenant.sharesWithCustomers`, a customer's own servers never do. Who may share is `SHARE_PERMISSION` in `src/lib/tenant/sharing.ts`, who may see it `SEE_SHARING_PERMISSION`, and who held a database at a time `holderAt` in `src/lib/tenant/database-owner.ts`
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

Permission categories: `USERS`, `GROUPS`, `SOURCES`, `DESTINATIONS`, `JOBS`, `STORAGE`, `HISTORY`, `DASHBOARD`, `AUDIT`, `NOTIFICATIONS`, `VAULT`, `CREDENTIALS`, `PROFILE`, `SETTINGS`, `TENANT_SETTINGS`, `API_KEYS`, `TEMPLATES`, and `PLATFORM`, which only a platform group gives. Storage has extra verbs (`DOWNLOAD`, `RESTORE`, `DELETE`), jobs have `EXECUTE`.

### Platform admins and accounts

The platform has rights of its own, `PERMISSIONS.PLATFORM.*` (tenants, accounts with the platform groups, the sign-in providers to see, the shared databases), which only a platform group gives and a platform admin holds. The tenants and their members check `platform-tenants:*` (`actions/tenant/tenant.ts`, `members.ts`), the accounts of every tenant and the platform groups `platform-accounts:*` (`actions/auth/platform-group.ts`), sharing databases `SHARE_PERMISSION` in `src/lib/tenant/sharing.ts`, on the servers of a tenant with `Tenant.sharesWithCustomers` only, which `platform-tenants:write` switches. Nobody makes, changes or gives a platform group that may do more than they may, see `src/lib/auth/platform-group-caps.ts`.

No permission is enough for what decides who signs in as whom or brings back every tenant. These refuse anyone who is no platform admin (`User.platformRole`, checked through `viewer.isPlatformAdmin` or `checkPlatformAdmin()`):

- Who is a platform admin, and the account of a platform admin.
- Changing the sign-in providers (`actions/auth/oidc.ts`, `platform-sign-in:write`, which no group gives), since a provider signs in as anyone of its emails.
- The configuration restore (`actions/backup/config-management.ts` and the routes under `api/settings/config-backup/restore`, which also refuse API keys) and the database download. A configuration backup at a destination holds the same keys, so every route that downloads, opens or restores a backup by its path asks `configBackupRefusal` in `src/lib/server/config-backup-guard.ts` first, and a link never serves one (`configBackupLinkRefusal`). The routes under `api/setup/restore` answer only while no account exists, and `src/lib/auth/sign-up-guard.ts` refuses a sign-up from the browser once one does, so New user signs up from the server.

An account belongs to every tenant it works in. A change of the account itself (password, second factor, sessions, name, email, delete) goes through `accountRefusal` in `src/lib/auth/account-access.ts`, read by `userService.accountRefusalFor`: only a platform admin changes the account of a platform admin, an account of a platform group only someone with `platform-accounts:write` who may give that platform group (`platform-group-caps.ts`), any other account whoever holds `platform-accounts:write`, and the admin of a tenant only an account that works in that tenant alone. `platform-accounts:*` reach only the tenants of the platform group (`PlatformReach`, `AccountActor.reach` from `userService.accountsReachOf`): a group of some tenants sees the accounts with a membership in one of them (`accountsSeenReach` in `services/user/account-visibility.ts`) and changes one only while it reaches every tenant of it, an account of no tenant counting as one of the home tenant. A new place that lists or changes accounts by these rights goes through them. The own name, email and second factor follow the `profile:*` permissions, also for someone who may manage users. An email of a domain that the sign-in provider of another tenant claims goes to an account only from a platform admin or someone whose reach covers that tenant (`emailClaimScope`), see `src/services/sso/email-domain-claims.ts`.

A group is given and taken through `roleRefusal`: nobody hands out or takes away a group that may do more than they may, on Platform > Tenants against what they may in that tenant (`actorIn` in `services/tenant/member-admin.ts`), where someone of a platform group also looks after only the tenants their platform group reaches. `updateUserGroup` and `moveUsersToGroup` give a group of the tenant only to its people (`membershipService.isPersonOf`) and never to a platform admin, unless a platform admin gives it. Nobody changes or deletes a group they hold in any tenant, and an API key never gets more than `ownerPermissionsIn` allows its owner in the tenant of the key, which leaves out every right of the platform but `platform-sharing:*` in a tenant that shares databases and `platform-tenants:*` with `platform-accounts:*` in the home tenant, bounded by the reach of the owner. The routes under `/api/tenants` and the actions of Platform > Tenants share their rules in `services/tenant/tenant-admin.ts`, `member-admin.ts` and `invitation-admin.ts`, see the developer guide of tenants. A new action of this kind follows the same pattern and gets a guard test.

The settings of the platform point only at connections and keys of the home tenant, like the destination and key of the configuration backup and the channels of Settings > Notifications. Their lists, their checks on save and the runs that use them read in `runAsTenant(HOME_TENANT_ID)` or filter on it, whichever tenant the admin works in. A customer's destination must never receive the configuration backup, which holds the key of every login.

### The own profile

The `profile:*` permissions decide what someone changes of their own account, on the server as well as on the page. The actions in `actions/auth/profile.ts` check the permission of each field that changes, `updateOwnPassword`, `togglePasskeyTwoFactor` and the SSO link actions check theirs, and `src/lib/auth/profile-guard.ts` refuses the better-auth endpoints the browser calls itself, like `/two-factor/enable` or `/passkey/delete-passkey`, from `beforeAuth` in `src/lib/auth/index.ts`. A new better-auth endpoint that changes the profile goes into `PROFILE_ENDPOINTS`.

## Password rules

Every new password follows the rules of Settings > Passwords, in `src/lib/auth/password-policy.ts` for the server and the browser alike. `authService.createUser` and `authService.setPassword` check them through `assertPasswordAllowed`, and `password-guard.ts` checks the better-auth endpoints the browser calls itself, like sign-up and change-password. A new way to set a password goes through one of them, and its field shows `PasswordChecklist` from `components/auth/` under it, with Generate from the same module.

## Global search

`GET /api/search` searches each kind only while the viewer may open the page that lists it, from the flags of `SearchScope` the route sets. A new kind gets a flag, a finder in `src/services/search/` that selects no secret, and rows with `needs` in `src/components/layout/search-items.ts`, which also hide a recent entry once its permission is gone.

## Audit log

Every Server Action and API route that changes something, runs something, restores or hands out data writes an entry once it succeeded: `auditService.log(user.id, ...)` in an action, `auditService.logFor(ctx, ...)` in a route, which records the API key of the request. The service reads the address and browser of the request and keeps the name of the user, so callers never pass them.

- Every entry names its record in `details.name` (a backup: `file`, `destination`), read before a delete.
- An update keeps `changes` from `diffFields` in `src/lib/core/audit-diff.ts`, before and after as a person reads them. A secret is a field with `secret: true`, never a value.
- Sign-ins, failed sign-ins and sign-outs are written by the better-auth hooks in `src/lib/auth/sign-in-audit.ts`, never by the browser.
- A change of the platform, like a setting of the instance, a system task or the configuration restore, goes into the log of the home tenant whichever tenant the admin works in: `PLATFORM_LOG` from `src/services/system/settings-save.ts` as the origin in an action, `platformLogFor(ctx)` in a route.
- `originShown` in `src/services/audit/audit-rows.ts` hides the address and browser of someone who is no member of a customer's tenant from its log, so a new reader of the log goes through it.

The sentence the Audit log tab shows comes from `describeEntry` in `src/lib/core/audit-sentence.ts`, which lists the details keys it reads. See `docs/developer-guide/advanced/audit.md`.

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
- Prisma 6 on SQLite panics on a `findMany` of more than 999 parents that orders one of their relations under a `select` ("no entry found for key"), and refuses one whose relation filter negates over as many. `relationOrderPaging` in `src/lib/prisma-paging.ts`, added to the client in `src/lib/prisma.ts`, reads such a query in pages of 999. A client of its own, like the copy of `openCopy`, does not have it.
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
02-dump.ts        Dump every source to temp files and pack them into the archive of the run (combined-dump.ts)
03-upload.ts      Upload the .tar with its .index and .meta.json to every destination (sets Partial on partial failure)
04-completion.ts  Cleanup temp files, finalize, fire notifications
05-retention.ts   Apply retention policy
```

Every job writes one `.tar` per run, one database or many, with or without directory sources. The archive writer in `src/lib/archive/` compresses and encrypts each entry on its own, so the archive stays seekable. The layout is in `docs/developer-guide/reference/archive-format.md`. Older formats (a bare dump, a TAR with a version 1 manifest) are still restored but never written.

Context flows through `RunnerContext` in `src/lib/runner/types.ts`. Add a step by adding a file here, not by growing an existing one.

**Execution statuses**: `Pending`, `Running`, `Success`, `Partial`, `Failed`, `Cancelled`. `Partial` is set in `03-upload.ts` when some destinations succeed and others fail.

**Air-gapped destinations** (`src/lib/core/air-gap.ts`, `airGapped` in the metadata of the connection) are connected only now and then. The upload asks one right before it with `isConnected` from `steps/air-gap.ts` and skips it when it does not answer, which keeps the run a `Success`. Anything that counts copies, connections that do not answer or offline alerts leaves one out through `isAirGapped` or `isNotConnected`, so a new place that does goes through them too.

## Queue system (`src/lib/execution/queue-manager.ts`)

FIFO queue with configurable concurrency:

```
runJob(jobId) -> Execution (Pending) -> processQueue()
                                            |
                    reads SystemSetting "maxConcurrentJobs" (default 1)
                                            |
                    starts next pending job if a slot is free
```

`processQueue()` runs after every enqueue and every completion. Jobs execute via `performExecution()` in `src/lib/runner.ts`. A pending run waits while another run of the same job is Running, so a job never runs twice at once. Every run keeps its archive and sidecars in its own directory (`ctx.runDir`), which `stepCleanup` removes.

## Encryption (two layers)

**System encryption** (`ENCRYPTION_KEY` env var) protects secrets at rest - DB passwords, SSO secrets, credential profiles:

```typescript
encrypt(plaintext) / decrypt(ciphertext)   // AES-256-GCM, src/lib/crypto/index.ts
decryptConfig(obj)                          // recursively decrypts config objects
```

**Backup encryption** (encryption profiles) protects backup files with user-managed keys. `createEncryptionProfile(name)` generates a 32-byte key and stores it encrypted with the system key.

```
Dump to temp file -> per entry: compression (optional) -> AES-256-GCM -> into the .tar -> upload
                                                   |
                     keys derived per archive by HKDF from the profile key and a fresh salt
```

Entry encryption lives in `src/lib/crypto/entry-cipher.ts`, the key derivation in `kdf.ts`, compression (Gzip or Brotli, no level) in `compression.ts`. An encrypted archive names its entries `d/000001` and encrypts its index too, but `.meta.json` carries the database names in clear. The whole-file streams of `src/lib/crypto/stream.ts`, with `iv` and `authTag` in `.meta.json`, are only written by config backups now and read for older database backups. `BackupMetadata` is defined in `src/lib/core/interfaces.ts`.

## Restore pipeline (`src/services/restore/`)

Runs as a background process with live progress. Split across `preflight.ts` (DB permissions, version compatibility), `pipeline.ts` (download, decrypt, decompress, restore), and `smart-recovery.ts` (auto-matches encryption profiles when metadata is missing).

```typescript
interface RestoreInput {
  storageConfigId: string;
  file: string;
  targetSourceId: string;
  targetDatabaseName?: string;
  databaseMapping?: Record<string, string> | DatabaseMappingEntry[]; // normalized to entries by RestoreService
  privilegedAuth?: { user: string; password: string }; // for CREATE DATABASE
}
```

A version guard rejects restoring a newer dump onto an older server.

## System tasks (`src/services/system/system-task-service.ts`)

Background tasks on cron schedules, defined with their defaults and words in `system-task-definitions.ts`. What each does lives in `system-task-runs.ts`, the Settings page and Run now in `system-task-settings.ts`. Runner infrastructure in `src/lib/runner/system-task-runner.ts`, managed via Settings > System tasks or `POST /api/settings/system-tasks`.

| Task | Default schedule | Enabled | Follows |
| :--- | :--- | :--- | :--- |
| `HEALTH_CHECK` | Every minute | Yes | |
| `STUCK_EXECUTION_CHECK` | Every 5 minutes | Yes | the stuck run timeout, off at `0` |
| `UPDATE_DB_VERSIONS` | Hourly | Yes | |
| `REFRESH_STORAGE_STATS` | Hourly | Yes | |
| `WARMUP_STORAGE_CACHE` | Hourly | Yes | |
| `CHECK_FOR_UPDATES` | Daily midnight | Yes | `general.checkForUpdates` |
| `CLEAN_OLD_LOGS` | Daily midnight | Yes | |
| `SYNC_PERMISSIONS` | Daily midnight | Yes | |
| `CONFIG_BACKUP` | Daily 3 AM | No | `config.backup.enabled`, `config.backup.schedule` |
| `INTEGRITY_CHECK` | Weekly Sunday 4 AM | No | |
| `OPTIMIZE_DATABASE` | Monthly, the 1st at 5 AM | Yes | |

A task that follows a setting has no switch of its own: `getTaskEnabled` and `setTaskEnabled` read and write that setting, so the two never disagree. A schedule is checked with `isValidCron` before it is stored. Every run records its start, length, whether it needs a look and a short result under `task.<id>.lastRun`, and each run function returns that result as a `TaskOutcome`. A task set to run at start runs once in `scheduler.init()`, never from `refresh()`, which runs after every saved job or setting. Run now goes through `startSystemTask`, which answers at once and refuses a task that runs already, and a scheduled start of a task that still runs is skipped (`runForAllTenants`).

Scheduled and internal tasks run as system and bypass permission checks.

`OPTIMIZE_DATABASE` (`database-optimize.ts`) holds new runs back with `beginRunHold()` from `src/lib/server/database-maintenance.ts` and waits up to an hour for the running ones before its VACUUM. The hold only stops the queue, while the maintenance flag of the VACUUM itself also skips system tasks and refuses restores.

## Health checks (`src/services/system/healthcheck-service.ts`)

Runs every minute. Pings all configured adapters and writes `HealthCheckLog` records (`ONLINE` / `DEGRADED` / `OFFLINE`, latency in ms). Uses `ping()` first, falls back to `test()`. Max 5 concurrent checks. Offline notifications are deduplicated with a 24 h cooldown. History via `GET /api/adapters/[id]/health-history`.

## Integrity and verification

- **Post-upload** (`src/services/storage/verification-service.ts`): SHA-256 and MD5 of every `.tar` are stored in `.meta.json`. `03-upload.ts` checks the copy right after the upload on Local Filesystem always, on other destinations only while the setting `backup.postUploadVerify` is `true`, which no page writes yet. S3, Google Drive, OneDrive and Local compare stored checksums, the others download the file.
- **Per dump**: the index of the archive holds the SHA-256 of every dump, checked on restore and by the Recovery Kit.
- **Periodic** (`src/services/backup/integrity-service.ts`): weekly `INTEGRITY_CHECK` task, disabled by default. Jobs mode checks only files linked to enabled jobs, destinations mode scans all storage. Filters for already-passed files, max age, and max size. It checks each tenant from `tenantsToCheck()` in a run of that tenant, see `system-task-runs.ts`.

## Storage alerts (`src/services/storage/storage-alert-service.ts`)

Per-destination alerts: usage spike (growth over X%), storage limit (total size over threshold), missing backup (nothing new in N hours). Notifies once on trigger, re-notifies after the reminder of its event while still active (24 h by default, never with the reminder at `0`), resets automatically when resolved.

## Notifications

Defined in `src/lib/notifications/` - `types.ts` holds the `NOTIFICATION_EVENTS` map, `events.ts` holds `EVENT_DEFINITIONS`.

**Global events** (configurable system-wide under Settings > Notifications, each with its name, default and default reminder in `EVENT_DEFINITIONS`):

| Category | Events |
| :--- | :--- |
| Auth | `USER_LOGIN`, `USER_CREATED` |
| Restore | `RESTORE_COMPLETE`, `RESTORE_FAILURE` |
| System | `CONFIG_BACKUP`, `SYSTEM_ERROR` |
| Storage | `STORAGE_USAGE_SPIKE`, `STORAGE_LIMIT_WARNING`, `STORAGE_MISSING_BACKUP`, `AIRGAP_SKIPPED` |
| Updates | `UPDATE_AVAILABLE` |
| Backup | `INTEGRITY_CHECK_FAILURE` |
| Health | `CONNECTION_OFFLINE`, `CONNECTION_ONLINE`, `DB_VERSION_CHANGED` |

**Per-job events** (`BACKUP_SUCCESS`, `BACKUP_PARTIAL`, `BACKUP_FAILURE`) are deliberately **not** in `EVENT_DEFINITIONS`. They are configured per job (Job > Notify tab), their templates live in `src/lib/notifications/templates/backup.ts`, and the runner fires them from `04-completion.ts` with the data of `steps/notification-data.ts`.

**The mail** of every notification is `renderNotificationEmail()` in `src/components/email/`, tables and inline styles with a dark mode sheet. Its icons are PNGs under `docs/public/email/`, drawn by `pnpm email:icons` from the lists in `email-icons.ts`, since mail clients draw no SVG.

## Config backup (`src/lib/runner/config-runner.ts`)

`CONFIG_BACKUP` system task uploads a copy of the whole database (`createConfigCopy` in `src/services/config/database-copy.ts`), gzipped and always encrypted with the key picked for it, as `config_backup_<time>.db.gz.enc`. The copy leaves sign-ins and caches out, the history without Include the history, and carries `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in a row that only ever exists in a copy. Disabled by default.

A restore checks a copy first (`restore-flow.ts`: integrity, no migration this version does not know, its keys), only from a destination of the home tenant and with a key of the home tenant, then lays it beside the live database as `restore-pending.db` and restarts. `scripts/apply-pending-restore.js` swaps it in before `prisma migrate deploy`, keeping the old database as `dbackup.db.before-restore`. A copy from an instance with other keys is encrypted again by `copy-rekey.ts`, which searches the copy for encrypted values instead of listing columns, so a new table needs no code there.

JSON files of older versions still restore through `importConfiguration()`, which checks every link before it writes, drops one to a record neither in the file nor here and returns a note for each kind of change. A foreign key error during a restore is a bug. See `docs/developer-guide/advanced/config-backup.md`.

## Recently deleted (`src/services/trash/`)

Deleting an encryption key, a credential profile, a connection, a job or a user keeps a snapshot of the record and everything that cascades from it in `DeletedRecord`, in the transaction of the delete, unless `permanently`. The delete functions of those services take `DeleteOptions` (`permanently`, `by`), the routes read `?permanently=true` or `permanently` in a bulk body. A restore creates the rows again under their old ids and drops links to what is gone with a note. The actions in `src/app/actions/settings/trash.ts` check the permission of every row they touch, stored with the row, and only a platform admin handles the account of a platform admin, of a platform group or of someone who also worked in another tenant (`superAdminOnly`). Restoring, purging and deleting `permanently` also need `TRASH_ADMIN_PERMISSION` (`tenant-settings:write`), so someone who may only delete a record cannot make that final. Undo needs no more than the kind's right, for the viewer's own delete of the last 5 minutes. The snapshot of an account waits in its one tenant when it worked there alone, without a platform role, a platform group or an API key elsewhere, and in the home tenant with `superAdminOnly` otherwise, never by the tenant that deleted it, so Undo of one's own delete of an account reads it in every tenant (`latestAccountEntries`, `mayRestoreAccount`). A new table that cascades from one of the five belongs in its snapshot in `trash-snapshot.ts`, or a restore loses it. The assignments of a shared server do not cascade, they hang off its `SharedServer`, which keeps the name of a deleted connection for its customers. The retention is `deletedItems` under Data retention, 30 days by default.

## Credential profiles (`src/services/auth/credential-service.ts`)

Reusable named credential sets encrypted with the system key. Types: `USERNAME_PASSWORD`, `SSH_KEY`, `ACCESS_KEY`, `TOKEN`, `SMTP`, `WEBHOOK`, `OAUTH`. Assignable to multiple adapters as primary or SSH credentials.

## SSO / OIDC

```
src/lib/adapters/oidc/                    Provider adapters
src/services/sso/oidc-provider-service.ts CRUD for SSO providers
src/services/sso/oidc-registry.ts         The adapters the dialogs offer
src/services/sso/oidc-discovery.ts        Checks the fields of a type and reads its endpoints
src/lib/auth/sso-guard.ts                 Refuses a provider that is off and unwanted sign-ups, places new people in a group
```

Run `ls src/lib/adapters/oidc/` for the providers. A new provider implements the `OIDCAdapter` interface with `inputs` (form fields), `inputSchema` (Zod), and `getEndpoints()`, calls `validateOutboundUrl` before it fetches, registers in `OIDC_ADAPTERS`, and gets a logo in `src/components/oidc/provider-logos.ts`. The `SsoProvider` model stores encrypted `clientId` / `clientSecret`, endpoints, a domain for email-based matching and the group of new people.

The Prisma client decrypts `clientId`, `clientSecret` and `oidcConfig` on every read of `ssoProvider`, so a whole row holds the secret in plain text. A read whose result leaves the server selects its fields like `PROVIDER_SELECT` in `sso-providers-model.ts`, and never `clientSecret` or `oidcConfig`. Whatever the browser sends to better-auth, like `requestSignUp`, is checked against the saved provider in `sso-guard.ts`. See `docs/developer-guide/advanced/sso.md`.
