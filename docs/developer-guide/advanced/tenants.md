# Tenants

Every row that holds data of a customer belongs to one tenant, and a Prisma extension narrows each query to the tenant of the code that runs now. Services read and write as before and never pass a tenant around. The code lives in `src/lib/tenant/` and `src/services/tenant/`, the user side in [Tenants](/user-guide/admin/tenants), [Shared Databases](/user-guide/admin/shared-databases) and [Shared Destinations and Channels](/user-guide/admin/shared-connections).

## The Model

| Model or field | Holds |
| :--- | :--- |
| `Tenant` | A customer, with a unique name. `HOME_TENANT_ID = "default"` in `src/lib/tenant/home.ts` is the home tenant, which the migration creates as Default and which is never deleted |
| `Tenant.sharesWithCustomers` | Whether the tenant gives databases of its servers, its destinations and its channels to other tenants, a tenant of the MSP. False by default, true for the home tenant from the migration `20261016120000_sharing_tenants`, renamed from `sharesDatabases` in `20261017090000_shared_connections`. `sharesWithCustomers(tenantId)` in `src/services/tenant/shared-servers.ts` reads it, see [Shared Databases](#shared-databases) and [Shared Destinations and Channels](#shared-destinations-and-channels) |
| `Tenant.addsDatabases`, `addsDirectorySources`, `addsDestinations`, `addsChannels`, `addsApiKeys` | What the tenant adds itself, true by default, see [Tenant Allowances](#tenant-allowances) |
| `TenantMembership` | `{ userId, tenantId, groupId }`, the group (role) of an account in one tenant. The group is one of that tenant |
| `TenantInvitation` | A link into a tenant with a group, kept as the SHA-256 of its token |
| `User.platformRole` | `"ADMIN"` (`PLATFORM_ADMIN_ROLE`) for a platform admin, else null |
| `Group.fullAccess` | The group with every permission, which cannot be edited or deleted. Nothing checks a group by its name |
| `Session.activeTenantId` | The tenant a session picked with the switcher |
| `tenantId` on every model in `TENANT_MODELS` | The tenant of the row. Its default `"default"` only fills the rows of the migration |
| `DatabaseAssignment`, `DatabaseAssignmentRule` | The databases of a shared server given to another tenant. `tenantId` names the customer without a relation, null on an assignment that took a database back, and a rule ends with `validUntil`, see [Shared Databases](#shared-databases) |
| `ConnectionShare`, `ConnectionShareTenant`, `ChannelRecipients` | A destination or a channel shared with other tenants, the customers it names and the recipients a customer names for a shared email channel, see [Shared Destinations and Channels](#shared-destinations-and-channels) |

Users, sessions and the system settings belong to no tenant. A group belongs to one tenant, `Group` is in `TENANT_MODELS`. A sign-in provider belongs to the platform or names one tenant in `SsoProvider.tenantId`, outside the filter. Names of groups, saved logins and the five template kinds are unique per tenant (`@@unique([tenantId, name])`), so services look them up with `findFirst({ where: { name } })`.

## The Scope

`src/lib/tenant/context.ts` keeps the scope of the code that runs now in an `AsyncLocalStorage`, one per process on `globalThis`, since Next.js builds several module graphs that would otherwise each have their own.

```typescript
type TenantScope = { kind: "tenant"; tenantId: string } | { kind: "system" } | { kind: "all" };

runAsTenant(tenantId, () => jobService.list());   // reads and writes one tenant
runAsSystem(() => scheduler.refresh());            // reads every tenant, unfiltered
explicitScope();                                   // the scope set around this code, if any
```

A request sets no scope. The extension asks the request instead, through `requestScope()` in `src/lib/tenant/current.ts`, which reads the headers with `requestHeaders()` and calls `getAuthContext(headers)`. `getAuthContext` is memoised per `Headers` object in a `WeakMap` on `globalThis`, so a request resolves its session or key once however many queries ask. `forgetAuthContext(headers)` drops the entry, which `switchTenant` does before it reads on.

The tenant of a request comes from:

- **A session**: `pickTenant` in `access-control.ts` takes `Session.activeTenantId` while the account is still a member there (a platform admin any tenant that exists, a platform group any tenant of its scope), else the home tenant for a member of it, else the first membership. Null for an account of no tenant, whose Overview shows `NoTenantNote` and whose dashboard reads nothing of a tenant. A platform admin, and a platform group that opens All tenants, starts in All tenants while there is more than one tenant. Removing someone from a tenant clears it from their sessions, so they pick another one on their next request.
- **All tenants**: a platform admin's session that stores `ALL_TENANTS` (`"*"`, from `src/lib/tenant/home.ts`) gets `allTenants: true` and no `tenantId`. Its scope is `all`, see below.
- **An API key**: `apiKeyService.validate` runs in `runAsSystem`, since a key is found by its hash before its tenant is known, and returns `tenantId`, the tenant the key was made in.

`currentTenantId()` answers the same question for code that has to name a tenant itself, like the audit log, which writes in the system scope: the tenant of `runAsTenant`, null in the system scope, else the one of the request.

`tenantOf(ctx)` from `access-control.ts` returns the tenant of a context or throws `PermissionError` for an account of none and in All tenants.

Every tab of a browser shares the session and so its tenant. `TenantSync` in `src/components/tenant/tenant-sync.tsx` reloads the other tabs when one switches, and the actions of the tenant settings take the tenant the page shows and refuse when the session works in another one.

### All Tenants

All tenants is the view of a platform admin, or of a platform group of all tenants, over every tenant at once. The scope `all` reads every tenant unfiltered and refuses every create, update and delete of a tenant model or a child row with `TenantScopeError`, except the caches a read fills on the way (`StorageListCache`, `DatabaseListCache`, `HealthCheckLog`, `DbVersionHistory`). A change belongs to one tenant, and only there `assertOwnRecords` can check what it links. The UI opens a record in its tenant before it changes it, through `useOpenInTenant` in `src/components/tenant/tenant-view.tsx`, and asks for the tenant of a new record with `TenantPickDialog`. The pick lists only the tenants where the viewer may add that kind of record, from the `writes` that `tenantService.switchable` returns with each tenant and `newRecordPermission` in `src/components/tenant/new-record.ts`, and New stays hidden without one.

The permissions in All tenants are `ALL_TENANTS_PERMISSIONS`: every `*:read` and `*:view`, the platform permissions, the profile and `users:write`, since accounts, memberships and settings are global. Groups belong to tenants and change in their tenant. A platform admin passes no other check there, so the UI hides every write by the permissions it already reads.

## The Prisma Extension

`tenantScopeExtension` in `src/lib/tenant/prisma-scope.ts` is added to the client in `src/lib/prisma.ts`. For a model in `TENANT_MODELS` it does per operation:

| Operation | Tenant scope | System scope |
| :--- | :--- | :--- |
| `findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy` and their `OrThrow` forms | `where` gets `AND: [{ tenantId }]` | As it is |
| `update`, `updateMany`, `updateManyAndReturn` | The same, and `data.tenantId` may only name the same tenant | As it is |
| `delete`, `deleteMany` | `where` narrowed | As it is |
| `create`, `createMany`, `createManyAndReturn` | Every row stamped with the tenant, a row naming another one throws | Every row must name its `tenantId` |
| `upsert` | `where` narrowed, `create` stamped, `update` checked | `create` must name its `tenantId` |
| Anything else | Throws | As it is |

The filter is one more entry of `AND`, so the unique field of a `findUnique` stays where Prisma looks for it. An id of another tenant reads the same as one that does not exist.

The system scope must name the tenant of a row it creates, since the column default would otherwise put a row of a customer into the home tenant without a word. Moving a row between tenants is for the system scope only.

`CHILD_MODELS` maps the rows that belong to a tenant through their parent, like `JobDestination` through `job` or `HealthCheckLog` through `adapterConfig`, to that relation. Their reads, changes and deletes are narrowed with `{ [relation]: { tenantId } }`. A create passes, since it names its parent by an id, which the write checks itself (see [Writes](#writes-check-what-they-link)).

Without a scope and without a request that names a tenant, a query on a tenant model throws `TenantScopeError` from `src/lib/logging/errors.ts`. A forgotten scope is an error, never a leak of every row.

### Prisma Queries Are Lazy

A Prisma query is a `PrismaPromise`, which only runs once something calls its `then`. Handed back unawaited from the function of `runAsTenant`, it would run after `store.run` returned, outside the scope, and fail or read another tenant. `within()` in `context.ts` therefore starts a returned thenable inside the scope and hands back a plain `Promise`:

```typescript
// Fine: within() calls then() inside the scope, the query runs there.
const jobs = await runAsTenant(id, () => prisma.job.findMany());

// Wrong: the query is handed out wrapped and only awaited after the scope ended. It runs in the
// tenant of the request, or throws TenantScopeError outside one.
const { count } = runAsTenant(id, () => ({ count: prisma.job.count() }));
await count;
```

Await a query inside the function, or return it as it is, never inside another object.

A transaction keeps the scope of the code that opened it, the interactive form and the batch form alike.

### Raw SQL Skips the Filter

`$queryRaw` and `$executeRaw` are no model operations, so the extension never sees them. Raw SQL over tenant models may only find ids or numbers, and the rows themselves are read through the client afterwards, which filters them again.

### Writes Check What They Link

The filter narrows queries, it does not read the ids inside a payload. A job of one tenant that names the source of another by its id would back up a database of a stranger. A write that links records checks the ids first with `assertOwnRecords(client, { adapterConfig: [...], encryptionProfile: [...] })` from `src/lib/tenant/references.ts`, with the client or transaction it writes with. A row of another tenant counts as missing, and the `ValidationError` reads the same as for one that never existed. `jobService` and the notification templates use it, a connection checks its logins through `validateCredentialAssignments`, which reads them through the filtered client.

## Code Outside a Request

Everything that runs without a request names its scope:

| Entry point | Scope |
| :--- | :--- |
| `src/instrumentation.ts` | `startServer` in `runAsSystem`: recovery of stale runs, the scheduler, the checks at start |
| Scheduler, `src/lib/server/scheduler.ts` | `refresh()` reads the jobs of every tenant in `runAsSystem`, a due job runs in `runAsTenant(job.tenantId)`, a system task in `runAsSystem` |
| Queue, `processQueue()` | Reads the pending runs of every tenant in `runAsSystem`, starts each in `runAsTenant(execution.tenantId)` |
| System tasks, `systemTaskService.runTask` | `runAsSystem`, also when someone starts one from a page. The integrity check records one run per tenant, each in `runAsTenant` of that tenant with its own copies, the home tenant first (`system-task-runs.ts`, `integrityService.tenantsToCheck`). A check of backup copies someone starts from a page records its run in their own tenant. Execution retention keeps the newest runs per tenant, and the permission sync writes only `AVAILABLE_PERMISSIONS` into a full access group, never a right of the platform |
| Counts across tenants | The numbers of Data retention and the guards that wait for no running run, before a VACUUM, the database download and the restore of a database copy, count in `runAsSystem`, so the runs of every tenant count whichever tenant the admin has open |
| `notify()`, the system notifications | `runAsSystem`, the channels of Settings → Notifications belong to the platform. `recordNotificationLog` writes into the tenant of the channel, else the current one, else the home tenant |
| `refreshStorageStatsCache` | `runAsSystem` for every destination, one entry per destination and tenant. `getStorageVolume` filters the cached entries to the backups the caller sees, see [Caches and Numbers per Tenant](#caches-and-numbers-per-tenant) |
| `auditService.log` | Writes in `runAsSystem` into `origin.tenantId`, else `currentTenantId()`, else the home tenant. The sign-in hooks name the home tenant themselves, so a sign-out lands there too and not in the tenant the session looked at. A change of the platform names it with `PLATFORM_LOG` or `platformLogFor(ctx)`, see [Audit Logging](/developer-guide/advanced/audit) |
| Restore of a shared database | `restoreService.restoreShared` in `runAsSystem`, the run recorded in the customer's tenant and a second run in the tenant of the server |
| Configuration backup and its restore | The settings point at a destination and a key of the home tenant, so `restore-flow.ts` and `restore-pipeline.ts` read them in `runAsTenant(HOME_TENANT_ID)`, also on the sign-up page, which has no tenant of its own |

### Caches and Tokens

- `cached()` in `src/services/dashboard/cache.ts` prefixes every key with the scope: the tenant, `*` for the system scope and All tenants, which read every tenant alike, and `-` without one, like a request of an account of no tenant. The numbers of one tenant never answer another, and code of no tenant never gets those of every tenant.
- A download link is fetched without a session, so its token carries the tenant it was made in and its maker (`generateLinkToken({ tenantId, userId, ... })`, `kind: "link"`). `GET /api/storage/public-download` serves only such a link, inside `runAsTenant` of its tenant, and reads any other token as spent. The dump of a shared database goes to its customer through `GET /api/shared/download?token=`, whose address never names the destination of the server. See [Download Tokens](/developer-guide/core/download-tokens).

## Shared Databases

`DatabaseAssignment` and `DatabaseAssignmentRule` name the customer in `tenantId`, but belong to the tenant of their server and sit in `CHILD_MODELS` through `server`, the `SharedServer` that outlives its connection. Their `tenantId` has no relation, so the id of a deleted tenant stays. The tenant of the server manages them with `databaseAssignmentService` in `src/services/tenant/database-assignments.ts`, under the normal filter. Changing them needs `platform-sharing:write` (`SHARE_PERMISSION` in `src/lib/tenant/sharing.ts`), seeing them `platform-sharing:read` (`SEE_SHARING_PERMISSION`), never `sources:*`.

Only a tenant with `Tenant.sharesWithCustomers` gives databases away, so a customer's own servers never share, whoever holds `platform-sharing:write`. `assertCustomer(tenantId, serverTenantId)` in `shared-servers.ts` refuses a server of a tenant that does not share (`NOT_SHARING`), the tenant of the server itself and a tenant that is gone. A tenant that shares may get databases too, a database it gets is no server of its own, so it never passes one on. `forSource` offers every other tenant as `customers`, `moveDatabase` refuses a server of a tenant that does not share, and `serverSharingOf` in `server-sharing.ts` shows the card only in a tenant that shares, while there is more than one tenant.

`tenantService.setSharing(id, on)` switches it, through the action `setTenantSharing` in `actions/tenant/tenant.ts`, which needs `platform-tenants:write` and a tenant the viewer manages (`managesTenant`) and writes the audit entry into the home tenant. It refuses to switch off while its servers give databases away, an open assignment with a tenant or an active rule on a `SharedServer` of the tenant, or while it has a `ConnectionShare`, since without the switch nobody could manage them. `createTenant(name, sharesWithCustomers)` sets it from the start.

Who held a database at a time is plain data, `holderAt()` and `ownerAt()` in `src/lib/tenant/database-owner.ts`: the assignment of the name that held then, else a move away, which keeps every rule off it, else the matching rule of the highest priority and, of equal ones, the oldest. It is settled by what was given by then, by `createdAt`: an assignment or a rule made later with a start in the past only reaches times nobody else held, so backdating or a new rule of a higher priority never takes the backups of another customer's time. A backup is judged by its `createdAt`, never by the owner now.

- `assign()` ends an assignment rather than deleting it, and moves a backdated start up to the end of the previous one.
- Taking a database back, `tenantId: null`, is recorded as an assignment without a tenant, so it belongs to the server's tenant alone from then on, also when a rule matches its name. Taking back what nobody holds changes nothing.
- `removeRule()` ends a rule with `validUntil` instead of deleting it. The backups made while it gave a database stay with its customer, like after an ended assignment.
- `tenantService.delete` ends the assignments and rules of the deleted tenant and keeps them with its id, so the backups of its time belong to nobody and never fall to another tenant's rule.

`src/services/tenant/shared-databases.ts` is the one path that reads across tenants on purpose. In `runAsSystem` it reads the server, its jobs, the destinations of the server's tenant and their cached listings, and keeps the archives with an index (`hasFileIndex`) that hold the database and were made while the customer held it. A backup is opened in `runAsTenant` of the server's tenant, so a backup without a named key is matched against that tenant's keys alone, and the key never leaves the module. A download and a restore try the next copy when a destination does not answer. Every download and restore checks the backup again from its reference, never from what the browser sends along.

A restore of a customer passes every line of its run through `sharedLogScrubber` in `src/services/restore/shared-restore-log.ts`. The run names the database alone, never the host, port, user, archive, destination or another database, and keeps no details. Its notifications name the database instead of the archive, without the destination and with a generic error.

The tenant of the server gets a run of the same restore with the whole log. `restoreSharedBackup` passes both tenants in `RestoreInput.shared.provider`, `RestoreService` creates the customer's run and the provider's run in one transaction, and `createRestoreLogs` in `src/services/restore/run-logs.ts` writes both: `log` for a line both read, `split` for a line the customer reads in other words or not at all, and `sinks` for `archive-restore.ts` and `archive-restore-databases.ts`, which hand the raw line to the provider's run and the scrubbed one to the customer's. Both runs share their progress, end with the same status, and are cancelled through one `AbortController` registered under both ids. The provider's run follows the customer's, see below. A failed run of the customer ends on `providerHint`. The action writes the restore into both audit logs, in the provider's as `shared_restore` with the database, the server and the customer.

How many backups a day a customer may start of a database is `effectiveOnDemand` in `src/lib/tenant/sharing.ts`: the `onDemandPerDay` of the assignment or the rule that holds it, none for `ON_DEMAND_OFF` (0), and for null the `Tenant.onDemandPerDay` of the customer, which the platform sets with `setTenantOnDemand` (`platform-tenants:write`, a tenant the viewer reaches). `tenantPlaces`, `holdingNow` and the rows of the provided servers resolve it, so a new reader of the number goes through it too. `tenantOnDemandService` in `src/services/tenant/tenant-on-demand.ts` lists the assignments and rules of a customer that set their own and lets one follow the customer again.

A backup a customer starts of a shared database (`requestSharedBackup` in `shared-on-demand.ts`) is a run of the job of the server's tenant with `onlyDatabases`. The customer gets a run of its own from `src/services/tenant/shared-backup-runs.ts`: `createCustomerBackupRun` records it, waiting, before the real run is queued under an id picked for it (`RunJobOptions.executionId`). When the queue takes the real run, `performExecution` finds it through `customerBackupFollower` and tells it its start and each stage, and `stepFinalize` ends it right after the real run's status. It writes its own lines and never copies one of the runner, so a new log line of the runner can never reach a customer. A Partial run reads as Success there, the size is the one of the dump of the database. `CUSTOMER_BACKUP_STAGES` are its steps on the page of the run.

Both are followers (`src/lib/execution/follower-runs.ts`): their metadata names the run they follow under `followsRun`. `LEADING_RUNS` keeps them out of the queue, pending or running, and out of the watchdog. Whatever ends a run without its own steps, the watchdog or a cancel before the start or of a run of another process, calls `endFollowers`. Cancel of a follower cancels the run it follows, in `runAsSystem`, since that run belongs to another tenant. The startup recovery keeps the metadata of a run, so a follower keeps its name.

## Shared Destinations and Channels

A tenant with `sharesWithCustomers` also shares its destinations and notification channels with other tenants. The code lives in `src/services/sharing/`, the view of a destination in `src/lib/tenant/storage-view.ts`.

| Model | Holds |
| :--- | :--- |
| `ConnectionShare` | One per shared connection, its `id` is the id of the `AdapterConfig` and cascades with it. `tenantId` is the tenant that shares it, in `TENANT_MODELS`. `allTenants` (every tenant, a new one too), `encryptedOnly` (a destination, false by default) and `ownRecipients` (an email channel, true by default) |
| `ConnectionShareTenant` | `{ shareId, tenantId }`, a picked customer while `allTenants` is false. `tenantId` names the customer without a relation and the row sits in `CHILD_MODELS` through `share`, so the tenant that shares manages it. `tenantService.delete` removes the rows of a deleted customer |
| `ChannelRecipients` | The addresses a customer names for a shared email channel, a JSON array, unique per `tenantId` and `configId`. `tenantId` is the customer, in `TENANT_MODELS` |

`connectionShareService` in `connection-shares.ts` runs in the scope of the tenant that shares, so it finds only its own connections, and `sharedKindOf` lets only a destination or a channel through. `save` refuses a tenant without `sharesWithCustomers`, refuses to share a destination while a job of the tenant called `tenants` (`TENANTS_FOLDER`) writes to it, and wants `confirmed` when a tenant loses a destination. It takes the connection away first with `forgetConnection` and writes the share only then, so a storage that does not answer leaves the share as it was. `view` and `losing` say how each customer uses it, from its jobs and templates and from `storageEntriesOf`.

The actions in `actions/tenant/connection-share.ts` check `SHARE_PERMISSION` or `SEE_SHARING_PERMISSION`, refuse All tenants and write `share` and `unshare` into the log of the tenant that shares. Each customer that lost the connection gets an `unshare` entry with its lost jobs, templates and backups in its own log (`origin.tenantId`), which `withdrawnConnections` in `withdrawn.ts` reads back for the note of the Connections page during `WITHDRAWN_DAYS`. The recipients a customer names (`setChannelRecipients`) need `notifications:write` in its tenant.

### Reading Across Tenants

A provided connection stays in the tenant that shares it, so the scope of the customer never finds it. `providedTo(tenantId, { kind, ids })` in `provided.ts` reads across tenants on purpose, in `runAsSystem`, so it answers the same in every scope. A connection counts as provided while its tenant has `sharesWithCustomers` and its share names the customer or every tenant. Every reader of a provided connection asks it, or `providedConnection` and `providedIds` for given ids:

- `providedItem` in `connection-options.ts` turns one into a list row with `config: "{}"`, no secret status, no `lastError` and `provided` with the tenant that shares it and its terms. `listAdapters` appends `providedItems(type, role)`, the pickers use `connectionOptions(type)`.
- The job service accepts a provided destination and refuses a job without a key on one with `encryptedOnly` (`assertEncryptionAsked`). The notification templates and the tenant notifications accept a provided channel.
- Everything else, an edit, test, clone or delete of a provided connection, finds nothing, since the tenant filter keeps it out.

### Opening a Destination

`destination-access.ts` is the one way to open storage:

| Function | Returns |
| :--- | :--- |
| `findDestination(id, tenantId?)` | The row and the `StorageViewMode` of the tenant given, else of the request, else of the tenant of the destination, for the system scope and All tenants. A destination of another tenant that is not shared with it throws `NotFoundError` |
| `openRow(row, mode)` | The adapter wrapped in `storageView(adapter, mode)`, with the resolved config |
| `openDestination(id, tenantId?)` | Both at once |
| `destinationAccess(row, tenantId)` | The mode with the `ProvidedConnection`, whose `encryptedOnly` the runner reads |

`StorageViewMode` is `own` for a destination nobody shares, the plain adapter, `provider` for the tenant of a shared destination, which sees everything but `tenants/` and gets a `ValidationError` for a path into it, and `customer` with its tenant id, which sees `tenants/<id>/` alone with every path relative to it. `cleanPath` refuses `..`. The view maps the path of `upload`, `download`, `list`, `delete`, `read`, `verifyChecksum`, `downloadRange` and `openSession`, and leaves out `listTree`, `downloadDirectory`, `createSymlink` and `browseDirectories`, since a destination never serves as a directory source.

::: warning Rule for new code
Code that reads or writes backups opens the destination through `openDestination`, or `findDestination` with `openRow` when it needs the row first. Never `registry.get` with `resolveAdapterConfig` itself, which reaches the folder of every customer.
:::

The exceptions know why: `01-initialize.ts` builds the view from `destinationAccess` with the tenant of the job and records a refusal for the upload instead of throwing, `refreshStorageStatsCache` lists a whole destination in the system scope and splits it by tenant, and the configuration backup uses a destination of the home tenant as it is.

### Caches and Numbers per Tenant

- `StorageListCache` is keyed by `adapterConfigId` and `tenantId` and sits in `TENANT_MODELS`. A shared destination keeps a listing per tenant, each with the backups of that tenant alone. `storageService.listingTenant` picks the tenant of a call like `findDestination` does.
- `refreshStorageStatsCache` writes one `StorageVolumeEntry` per destination and tenant (`entriesOf`), counting `tenants/<id>/` for that customer and everything else for the tenant of the destination, and saves the `StorageSnapshot` rows per tenant. `getStorageVolume` shows a tenant its own backups on its own and on provided destinations, All tenants one entry per destination. `storageEntriesOf(configId)` gives the tenant that shares the space of each customer. The storage limit and the usage spike of a shared destination watch its whole storage, the backups of its customers included, while the missing backup alert watches its own tenant's runs.

### Channels

`channelTarget(channel, tenantId)` in `channel-recipients.ts` decides where a message of a tenant through a channel goes: an own channel sends as it is set, a provided channel to the recipients the customer named when `ownRecipients`, else as it is set. It refuses once the channel is no longer shared with the tenant and while the customer named nobody, so a message of a customer never reaches the recipients of the tenant that shares by mistake. `sendThroughChannel` and `04-completion.ts` ask it before every send and record a refusal as a failed notification. `setRecipients` keeps at most `MAX_RECIPIENTS` (20), and `sendRecipientsTest` sends a plain notification, never the SMTP test of the channel, whose mail would name the server and sender.

### Taking It Back

`forgetConnection(configId, kind, tenantIds, deleteBackups = true)` in `share-cleanup.ts` takes every link of each tenant to the connection away, in the system scope. On a destination it deletes the backups of the tenant first with `deleteTenantBackups`, which opens the destination in the view of that customer so nothing outside its folder is touched, then its `JobDestination` rows and its listing. A channel leaves the template channels of the tenant, the notifications of its jobs, its `ChannelRecipients` and its tenant notification settings. Only `tenantService.delete` of the tenant that shares passes `false`, since its connection goes and the storage stays. Deleting a customer deletes its backups on provided destinations after the delete, in the background.

`removeAdapter` refuses a connection with a `ConnectionShare` with a `ConflictError`, and `tenantService.setSharing` refuses to switch off while the tenant has one.

### Tenant Allowances

`Tenant.addsDatabases`, `addsDirectorySources`, `addsDestinations`, `addsChannels` and `addsApiKeys` say what a tenant adds itself, `ALLOWANCE_KINDS` in `src/lib/tenant/allowances.ts`. `assertMayAddKind(kind)` in `src/services/tenant/tenant-allowances.ts` refuses something of a kind the tenant that runs now may not add with a `ValidationError`, and passes outside a tenant, like the configuration restore. `assertMayAdd(type, storageRole)` asks it for a connection. `createAdapter`, `cloneAdapter`, a role change in `updateAdapter`, a connection back from Recently deleted in `restoreFromTrash` and `apiKeyService.create` call it, and so does any new path that creates one of these. `setAllowances` refuses the home tenant. The action `setTenantAllowances` needs `platform-tenants:write` and a tenant the viewer manages, and writes the change into the log of the home tenant and of the tenant. The pages read the allowances from `tenantService.switchable` through `useMayAdd(kind)`, and `tenantsThatCreate` leaves a tenant out of the pick of New in All tenants.

A connection that reaches the server DBackup runs on, its files, its Docker, its sockets, the tools it runs with options of the connection and its SSH keys or agent, belongs to the home tenant only. `hostLocalReason(adapterId, config)` in `src/lib/adapters/host-local.ts` says why one does. `createAdapter`, `updateAdapter` and `cloneAdapter` refuse it outside the home tenant through `assertMayReachHost`, every config of a form that a route runs before it is saved goes through `overlayCredentialsOnConfig` or `assertConfigOffHost`, and `resolveAdapterConfig` refuses a stored one of a customer at run time, also when a login it names changed later. A new adapter that touches the server itself, or a new option that a tool on the server reads, gets a rule there. The MySQL restore runs its client with `lockedDownClientArgs`, so a dump runs no shell command and sends no local file.

## Permissions

`src/lib/auth/owner-permissions.ts` decides what someone may do while working in a tenant:

| Function | Returns |
| :--- | :--- |
| `groupPermissions(group)` | Every permission for a `fullAccess` group, else the stored ones DBackup knows |
| `permissionsIn(memberships, tenantId)` | The group in the tenant without the platform permissions, plus the platform permissions from the group in the home tenant, plus the profile permissions from any group |
| `ownerPermissionsIn(owner, tenantId, tenantShares)` | The ceiling of an API key in its tenant: every permission of a tenant for a platform admin, else `permissionsIn` without what a platform group gives on the platform. In a tenant that shares with customers also the `platform-sharing:*` the owner holds (`keyPlatformPermissions(tenantShares)`) |
| `capToOwner(key, owner)` | What the key holds and its owner may do now |

`PLATFORM_PERMISSIONS` are `settings:*`, which act on the whole instance. Groups belong to a tenant, so `groups:*` counts in each tenant, and `tenant-settings:*` covers the tenant's own settings and its Recently deleted (`TRASH_ADMIN_PERMISSION`). `VIEWER_PERMISSIONS` is the group Viewer that tenants made before the groups for tenants started with, and what the preset Viewer of a group for tenants holds. `PROFILE_PERMISSIONS` are `profile:*`, which change the own account, which belongs to no tenant. With one tenant `permissionsIn` is exactly what the group gives.

`AuthContext` carries `tenantId`, `isPlatformAdmin` and `allTenants`. A platform admin passes every check of `checkPermission` and `checkPermissionWithContext` inside a tenant, never through an API key, and in All tenants only what `ALL_TENANTS_PERMISSIONS` holds. The tenants and their members check `platform-tenants:*` (`actions/tenant/tenant.ts`, `members.ts`). `checkPlatformAdmin()` guards the platform admin role and the keys of the home tenant a configuration restore picks from (`getPlatformEncryptionProfiles`). `getViewer()` returns the user with `isPlatformAdmin`, `tenantId`, `permissions` and `role`, their group in the tenant.

### Platform Groups

A `PlatformGroup` gives the people of the MSP rights without the platform admin role, which stays `User.platformRole` and shows in the pages as the built-in group Platform admin. A user holds at most one through `User.platformGroupId`. Its `platformPermissions` are the settings of the instance and the rights of `PLATFORM_ONLY_PERMISSIONS` (`platform-tenants:*`, `platform-accounts:*`, `platform-sign-in:read`, `platform-sharing:*`), which are kept apart from `AVAILABLE_PERMISSIONS`, so no group of a tenant ever holds them. Its `tenantPermissions` count in every tenant when `allTenants`, else in those of `PlatformGroupTenant`.

`permissionsIn(memberships, tenantId, platformGroup)` adds the tenant rights of the group in a tenant of its scope (`platformTenantRightsIn`) and its platform rights (`platformRightsOf`), and `ctx.permissions` carries both, so a platform right is checked like any other. `pickTenant` opens a tenant of the scope without a membership, and All tenants for a group that reaches every tenant and reads there (`opensAllTenants`), with `allTenantsPermissionsOf`. `ownerPermissionsIn` gives an API key the tenant rights of its owner's platform group, and of its platform rights only `platform-sharing:*` in a key of a tenant that shares with customers. The settings of the instance from the owner's group in the home tenant still count for a key, as before tenants. `platform-sign-in:write` is in no list a group draws from, so only a platform admin changes a sign-in provider.

Someone of a platform group looks after a tenant on Platform > Tenants, its members, its name, its sharing and its delete, only when their platform group reaches it (`platformGroupService.reaches`). A membership there gives no right on the platform. Creating a tenant needs a platform admin or a platform group of all tenants (`reachesAll`), since a group of some tenants would never reach the new one.

### Groups for Tenants

A `TenantGroupTemplate` is a group the platform makes once (`src/services/user/tenant-group-templates.ts`): a name, unique among them and never Admin, the permissions of a group of a tenant without the settings of the instance (`templateRights`), and `allTenants` or the tenants of `TenantGroupTemplateTenant`. Each tenant it reaches has a real `Group` with `templateId`, so the checks of a tenant read it like any group of theirs, and `@@unique([tenantId, templateId])` keeps one per tenant. `groupService.update`, `delete` and `deleteMany` refuse a linked group with `fromPlatform`, and the actions say so first.

`preview` lists what a save asks: a tenant to reach with an own group by the name (`ReachClash`, with its members and what they gain and lose) and a tenant it leaves where people hold it (`ReachLeave`, with the other groups there). `save` and `remove` take the answers as a `ReachPlan` and do all of it in one transaction in `runAsSystem`, refusing a missing answer. A group taken out moves its members and the sign-in providers that add people to it like `groupService.delete`. `seedTenantGroups` gives a new tenant the groups for all tenants and its full access Admin, nothing else. The presets of New group for tenants are `TENANT_GROUP_TEMPLATES` in `src/lib/auth/group-templates.ts`, led by Client, and the editor starts from them through `draftOf` in `tenant-group-template-model.ts`, which leaves out what the viewer may not give.

The actions in `actions/auth/tenant-group-template.ts` need `platform-accounts:write` and cap a group for tenants like a platform group without rights on the platform (`platformGroupRefusal`), and a move of members into a group by `lockedTenantRight`. They write the group to the log of the home tenant with `forTenants`, and per tenant what happened to its group with `fromPlatform`.

`src/lib/auth/account-access.ts` guards the people:

- `accountRefusal(actor, target)`: a platform admin may change any account, nobody else the one of a platform admin. An account of a platform group is changed only by someone with `platform-accounts:write` who may give that platform group (`platformGroupRefusal` in `platform-group-caps.ts`), never by the admin of a tenant. Whoever holds `platform-accounts:write` changes any other account, and a tenant admin only an account whose memberships are all in their tenant. An account of no tenant counts as one of the home tenant. `userService.accountRefusalFor` reads both sides.
- `roleRefusal(actor, group)`: a group is given only by someone who holds every permission it gives in that tenant, from `roleGrantsIn`. On Platform > Tenants it is checked against what the viewer may do in that tenant (`actorIn` in `members.ts`), for the group given and for the one taken.
- `updateUserGroup` and `moveUsersToGroup` give a group of the tenant only to its people, `membershipService.isPersonOf` with `peopleOf`: its members, and in the home tenant the accounts of no tenant. Only a platform admin gives one to a platform admin or to anyone else. The others join by an invitation or through Platform > Tenants.

## Adding a Model

A new model that holds data of a customer:

1. Add `tenantId String @default("default")` with an index, or a unique pair with its name, to `prisma/schema.prisma`, and write the migration
2. Add the model to `TENANT_MODELS`. A model that belongs to a tenant through a parent goes into `CHILD_MODELS` with the relation instead
3. Delete its rows in `tenantService.delete`, which removes a tenant table by table, since the tenant columns carry no relation
4. Seed a row of it for both tenants in `tests/unit/tenant/tenant-isolation.test.ts`. Its first case fails for every model with a `tenantId` column that is missing from `TENANT_MODELS`, and the cases per model then prove that a second tenant neither reads, counts, changes nor deletes the row
5. Check every write that links the new rows to others with `assertOwnRecords`, and every code path outside a request for its scope

## Next Steps

- [Permission System](/developer-guide/advanced/permissions) - the permissions and their checks
- [API Keys & Webhooks](/developer-guide/advanced/api-keys) - how a key finds its tenant
- [Audit Logging](/developer-guide/advanced/audit) - which tenant an entry lands in
