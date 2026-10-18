# Tenants

Every row that holds data of a customer belongs to one tenant, and a Prisma extension narrows each query to the tenant of the code that runs now. Services read and write as before and never pass a tenant around. The code lives in `src/lib/tenant/` and `src/services/tenant/`, the user side in [Tenants](/user-guide/admin/tenants), [Shared Databases](/user-guide/admin/shared-databases) and [Shared Destinations and Channels](/user-guide/admin/shared-connections).

## The Model

| Model or field | Holds |
| :--- | :--- |
| `Tenant` | A customer, with a unique name. `HOME_TENANT_ID = "default"` in `src/lib/tenant/home.ts` is the home tenant, which the migration creates as Default and which is never deleted |
| `Tenant.sharesWithCustomers` | Whether the tenant gives databases of its servers, its destinations and its channels to other tenants, a tenant of the MSP. False by default, true for the home tenant from the migration `20261016120000_sharing_tenants`, renamed from `sharesDatabases` in `20261017090000_shared_connections`. `sharesWithCustomers(tenantId)` in `src/services/tenant/shared-servers.ts` reads it, see [Shared Databases](#shared-databases) and [Shared Destinations and Channels](#shared-destinations-and-channels) |
| `Tenant.addsDatabases`, `addsDirectorySources`, `addsDestinations`, `addsChannels`, `addsApiKeys` | What the tenant adds itself, true by default, see [Tenant Allowances](#tenant-allowances) |
| `Tenant.blocksLocalNetwork`, `allowedNetworks` | Whether its connections reach the local network of the server, true for a new tenant, and the CIDR ranges they reach anyway, see [The Local Network](#the-local-network) |
| `TenantMembership` | `{ userId, tenantId, groupId }`, the group (role) of an account in one tenant. The group is one of that tenant |
| `TenantInvitation` | A link into a tenant with a group, kept as the SHA-256 of its token |
| `User.platformRole` | `"ADMIN"` (`PLATFORM_ADMIN_ROLE`) for a platform admin, else null |
| `Group.fullAccess` | The group with every permission, which cannot be edited or deleted. Nothing checks a group by its name |
| `Session.activeTenantId` | The tenant a session picked with the switcher |
| `tenantId` on every model in `TENANT_MODELS` | The tenant of the row. Its default `"default"` only fills the rows of the migration |
| `DatabaseAssignment`, `DatabaseAssignmentRule` | The databases of a shared server given to another tenant. `tenantId` names the customer without a relation, null on an assignment that took a database back, and a rule ends with `validUntil`, see [Shared Databases](#shared-databases) |
| `ConnectionShare`, `ConnectionShareTenant`, `ChannelRecipients` | A destination or a channel shared with other tenants, the customers it names and the recipients a customer names for a shared email channel, see [Shared Destinations and Channels](#shared-destinations-and-channels) |

Users, sessions and the system settings belong to no tenant. A group belongs to one tenant, `Group` is in `TENANT_MODELS`. A sign-in provider belongs to the platform or names one tenant in `SsoProvider.tenantId`, outside the filter. `TenantMembership` and `TenantInvitation` name a tenant too but stay out of `TENANT_MODELS`, the platform's to read through `membershipService` and `invitationService`, which name the `tenantId` in every query of one tenant. An invitation is found by the hash of its link while whoever opens it is no member of its tenant yet, which the filter of their request would hide. `tests/unit/tenant/tenant-isolation.test.ts` lists every such model. Names of groups, saved logins and the five template kinds are unique per tenant (`@@unique([tenantId, name])`), so services look them up with `findFirst({ where: { name } })`.

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

A link of a notification names the tenant of its record with `tenant=` (`TENANT_PARAM`, `paths` in `src/lib/notifications/templates/format.ts`, from `TemplateOptions.tenantId`). `TenantFromLink` in `src/components/tenant/tenant-from-link.tsx`, mounted once by the dashboard layout, switches the session into that tenant and loads the same page there, or only drops the parameter in All tenants, in the open tenant and for a tenant the viewer may not open. `useOpenFromLink` waits while the switch is pending (`useSwitchFromLink`), or it would look for the record in the wrong tenant.

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
| Counts across tenants | The numbers of Data retention and the guards that wait for no running run, before a VACUUM, the database download and the restore of a database copy, count in `runAsSystem`, so the runs of every tenant count whichever tenant the admin has open. The queue is one for every tenant, so the Timeline, Upcoming and the schedule picker of a tenant play the jobs and live runs of the others through too, read by `otherTenantQueue` in `src/services/jobs/other-tenant-queue.ts` and named only `OTHER_TENANT_JOB`, never by name or id. It reads one snapshot every tenant shares, `src/services/jobs/queue-snapshot.ts` (each scheduled job with its usual length, a job saved reads the list again, a run that ended its length), planned once per schedule by `queue-schedules.ts` at the fixed offset of its time zone where the window holds no change of it (`src/lib/core/cron-window.ts`) |
| `notify()`, the system notifications | `runAsSystem`, the channels of Settings → Notifications belong to the platform. `recordNotificationLog` writes into the tenant the entry names, else the tenant of the channel, else the current one, else the home tenant. A message of a customer through a channel another tenant shares names the customer, so its row lands in the customer's log and never in the tenant that shares the channel. The links of a message name the tenant of its records from `recordTenant`, while the log of the platform's channels keeps the `executionId` only of a run of the home tenant (`platformRun` in `system-notification-service.ts`), since the home tenant cannot open the run of another one |
| `refreshStorageStatsCache` | `runAsSystem` for every destination, one entry per destination and tenant. `getStorageVolume` filters the cached entries to the backups the caller sees, see [Caches and Numbers per Tenant](#caches-and-numbers-per-tenant) |
| `auditService.log` | Writes in `runAsSystem` into `origin.tenantId`, else `currentTenantId()`, else the home tenant. The sign-in hooks name the home tenant themselves, so a sign-out lands there too and not in the tenant the session looked at. A change of the platform names it with `PLATFORM_LOG` or `platformLogFor(ctx)`, see [Audit Logging](/developer-guide/advanced/audit) |
| Restore of a shared database | `restoreService.restoreShared` in `runAsSystem`, the run recorded in the customer's tenant and a second run in the tenant of the server |
| Configuration backup and its restore | The settings point at a destination and a key of the home tenant, so `restore-flow.ts` and `restore-pipeline.ts` read them in `runAsTenant(HOME_TENANT_ID)`, also on the sign-up page, which has no tenant of its own |

### Caches and Tokens

- `cached()` in `src/services/dashboard/cache.ts` prefixes every key with the scope: the tenant, `*` for the system scope and All tenants, which read every tenant alike, and `-` without one, like a request of an account of no tenant. The numbers of one tenant never answer another, and code of no tenant never gets those of every tenant.
- A run that ended clears the scope of its tenant and `*` alone (`invalidateTenantCaches`), a storage refresh those of the tenants of its destinations, so the pages of the other tenants stay warm. An entry that reads other tenants too, like the shared servers of a customer, says so with `readsOtherTenants: true` and goes with every clear. `invalidateDashboardCache()` clears everything, for a change of the platform.
- A download link is fetched without a session, so its token carries the tenant it was made in and its maker (`generateLinkToken({ tenantId, userId, ... })`, `kind: "link"`). `GET /api/storage/public-download` serves only such a link, inside `runAsTenant` of its tenant, while `makerMayDownload` in `src/lib/auth/download-maker.ts` finds that its maker, and the API key it was made with (`apiKeyId`), may still download there, and reads any other token as spent. A file prepared for the browser and a pick of a seekable archive carry their tenant and API key too, and only a request of the same tenant and key collects them (`madeBy`), the pick served in `runAsTenant` of its tenant. The dump of a shared database goes to its customer through `GET /api/shared/download?token=`, whose address never names the destination of the server. See [Download Tokens](/developer-guide/core/download-tokens).

## Shared Databases

`DatabaseAssignment` and `DatabaseAssignmentRule` name the customer in `tenantId`, but belong to the tenant of their server and sit in `CHILD_MODELS` through `server`, the `SharedServer` that outlives its connection. Their `tenantId` has no relation, so the id of a deleted tenant stays. The tenant of the server manages them with `databaseAssignmentService` in `src/services/tenant/database-assignments.ts`, under the normal filter. Changing them needs `platform-sharing:write` (`SHARE_PERMISSION` in `src/lib/tenant/sharing.ts`), seeing them `platform-sharing:read` (`SEE_SHARING_PERMISSION`), never `sources:*`.

Every change takes the `PlatformReach` of the person as its last argument, which the action or the route reads with `platformGroupService.reachOf(userId)`, of the owner for an API key. `src/services/tenant/assignment-reach.ts` refuses a database given to or taken from a tenant beyond it, a move or a change of backups on demand of a database such a tenant holds, a change of its rules, and a new rule that would rank above one of its rules for a database the server lists, with the sentences of `OUTSIDE_REACH` in `src/lib/tenant/sharing-reach.ts`. `forSource` lists the reached tenants under `customers` and every other tenant under `tenants`, for the names of the filters, and the card locks the same through `assignment-reach.ts` beside it in `components/dashboard/explorer/`. `"all"` changes nothing.

Only a tenant with `Tenant.sharesWithCustomers` gives databases away, so a customer's own servers never share, whoever holds `platform-sharing:write`. `assertCustomer(tenantId, serverTenantId)` in `shared-servers.ts` refuses a server of a tenant that does not share (`NOT_SHARING`), the tenant of the server itself and a tenant that is gone. A tenant that shares may get databases too, a database it gets is no server of its own, so it never passes one on. `forSource` offers every other tenant the viewer reaches as `customers`, `moveDatabase` refuses a server of a tenant that does not share, and `serverSharingOf` in `server-sharing.ts` shows the card only in a tenant that shares, while there is more than one tenant.

`tenantService.setSharing(id, on)` switches it, through the action `setTenantSharing` in `actions/tenant/tenant.ts`, which needs `platform-tenants:write` and a tenant the viewer manages (`managesTenant`) and writes the audit entry into the home tenant. It refuses to switch off while its servers give databases away, an open assignment with a tenant or an active rule on a `SharedServer` of the tenant whose connection still exists, or while it has a `ConnectionShare`, since without the switch nobody could manage them. What a server whose connection was deleted gave away nobody can take back, so the switch ends it. `createTenant(name, sharesWithCustomers)` sets it from the start.

Who held a database at a time is plain data, `holderAt()` and `ownerAt()` in `src/lib/tenant/database-owner.ts`: the assignment of the name that held then, else a move away, which keeps every rule off it, else the matching rule of the highest priority and, of equal ones, the oldest. It is settled by what was given by then, by `createdAt`: an assignment or a rule made later with a start in the past only reaches times nobody else held, so backdating or a new rule of a higher priority never takes the backups of another customer's time. A backup is judged by its `createdAt`, never by the owner now.

- `assign()` ends an assignment rather than deleting it, and moves a backdated start up to the end of the previous one.
- Taking a database back, `tenantId: null`, is recorded as an assignment without a tenant, so it belongs to the server's tenant alone from then on, also when a rule matches its name. Taking back what nobody holds changes nothing.
- `removeRule()` ends a rule with `validUntil` instead of deleting it. The backups made while it gave a database stay with its customer, like after an ended assignment.
- `tenantService.delete` refuses while a run of the tenant waits or runs (`assertNoActiveRun`, asked again inside its transaction), and while a run of a customer writes to a destination it shares or waits to (`assertNoCustomerRun`). It ends the assignments and rules of the deleted tenant and keeps them with its id, so the backups of its time belong to nobody and never fall to another tenant's rule, and takes a database it held by name back with an assignment without a tenant, like **Nobody else**.

`src/services/tenant/shared-databases.ts` is the one path that reads across tenants on purpose. In `runAsSystem` it reads the server, its jobs, the destinations of the server's tenant and those other tenants share with it (`providedTo` in `serverBackupFiles`), and their cached listings as the server's tenant sees them, and keeps the archives with an index (`hasFileIndex`) that hold the database and were made while the customer held it. A backup is opened in `runAsTenant` of the server's tenant, so a backup without a named key is matched against that tenant's keys alone, and the key never leaves the module. A download and a restore try the next copy when a destination does not answer. Every download and restore checks the backup again from its reference, never from what the browser sends along.

A restore of a customer passes every line of its run through `sharedLogScrubber` in `src/services/restore/shared-restore-log.ts`. The run names the database alone, never the host, another host of its domain, the master of a Sentinel, the port, user, archive, destination or another database of the backup or of what the server lists (`listedDatabases`), and keeps no details. Its notifications name the database instead of the archive, without the destination and with a generic error.

The tenant of the server gets a run of the same restore with the whole log. `restoreSharedBackup` passes both tenants in `RestoreInput.shared.provider`, `RestoreService` creates the customer's run and the provider's run in one transaction, and `createRestoreLogs` in `src/services/restore/run-logs.ts` writes both: `log` for a line both read, `split` for a line the customer reads in other words or not at all, and `sinks` for `archive-restore.ts` and `archive-restore-databases.ts`, which hand the raw line to the provider's run and the scrubbed one to the customer's. Both runs share their progress, end with the same status, and are cancelled through one `AbortController` registered under both ids. The provider's run follows the customer's, see below. A failed run of the customer ends on `providerHint`. The action writes the restore into both audit logs, in the provider's as `shared_restore` with the database, the server and the customer.

Every restore keeps what it read and every database and folder it restored under `restore` in the metadata of its run, from `createRestoreTracker` in `src/services/restore/restore-record.ts`, which the summary of the run reads. The customer's run keeps `view(true)`, without `from` and `archive`, the destination and the path of the server's archive, and the provider's run `view(false)`, the whole record. `SharedRestore.copyTenantId` in `src/services/restore/types.ts` names the tenant in whose view of the destination the path of the copy lies, the tenant of the server, so `preflight.ts`, `pipeline.ts`, `archive-restore.ts` and `archive-restore-databases.ts` open the copy as that tenant through `openDestination(id, copyTenantId)` or `findDestination`. A copy on a destination another tenant provides to the server's tenant lies in that tenant's folder there, which the view of the customer, the tenant of the request, would never reach.

How many backups a day a customer may start of a database is `effectiveOnDemand` in `src/lib/tenant/sharing.ts`: the `onDemandPerDay` of the assignment or the rule that holds it, none for `ON_DEMAND_OFF` (0), and for null the `Tenant.onDemandPerDay` of the customer, which the platform sets with `setTenantOnDemand` (`platform-tenants:write`, a tenant the viewer reaches). `tenantPlaces`, `holdingNow` and the rows of the provided servers resolve it, so a new reader of the number goes through it too. `tenantOnDemandService` in `src/services/tenant/tenant-on-demand.ts` lists the assignments and rules of a customer that set their own and lets one follow the customer again, both with the `PlatformReach` of the viewer: a tenant that shares beyond it shows as `PROVIDER_BEYOND_REACH` without its id, and what it gives never follows from there.

A backup a customer starts of a shared database (`requestSharedBackup` in `shared-on-demand.ts`) is a run of the job of the server's tenant with `onlyDatabases`. The customer gets a run of its own from `src/services/tenant/shared-backup-runs.ts`: `createCustomerBackupRun` records it, waiting, before the real run is queued under an id picked for it (`RunJobOptions.executionId`). When the queue takes the real run, `performExecution` finds it through `customerBackupFollower` and tells it its start and each stage, and `stepFinalize` ends it right after the real run's status. It writes its own lines and never copies one of the runner, so a new log line of the runner can never reach a customer. A Partial run reads as Success there, the size is the one of the dump of the database. `CUSTOMER_BACKUP_STAGES` are its steps on the page of the run.

Both are followers (`src/lib/execution/follower-runs.ts`): their metadata names the run they follow under `followsRun`, which every query matches with its colon, `"followsRun":`, so a destination or a database of that name makes no follower. `LEADING_RUNS` keeps them out of the queue, pending or running, and out of the watchdog. Whatever ends a run without its own steps, the watchdog or a cancel before the start or of a run of another process, calls `endFollowers`. A follower whose run is gone, like one of a deleted tenant, or ended without it, like a restore whose write of the provider's run failed, is ended by `endOrphanedFollowers`, which `sweepStuckExecutions` calls on every round of the watchdog while it is on. It waits `ORPHAN_GRACE_MS` (10 minutes) from the end of that run, or from the start of the oldest follower when the run is gone, and then ends the followers with the status of the run, or `Failed` when it is gone. Cancel of a follower cancels the run it follows, in `runAsSystem`, since that run belongs to another tenant. The startup recovery keeps the metadata of a run, so a follower keeps its name.

## Shared Destinations and Channels

A tenant with `sharesWithCustomers` also shares its destinations and notification channels with other tenants. The code lives in `src/services/sharing/`, the view of a destination in `src/lib/tenant/storage-view.ts`.

| Model | Holds |
| :--- | :--- |
| `ConnectionShare` | One per shared connection, its `id` is the id of the `AdapterConfig` and cascades with it. `tenantId` is the tenant that shares it, in `TENANT_MODELS`. `allTenants` (every tenant, a new one too), `encryptedOnly` (a destination, false by default) and `ownRecipients` (an email channel, true by default) |
| `ConnectionShareTenant` | `{ shareId, tenantId }`, a picked customer while `allTenants` is false. `tenantId` names the customer without a relation and the row sits in `CHILD_MODELS` through `share`, so the tenant that shares manages it. `tenantService.delete` removes the rows of a deleted customer |
| `ChannelRecipients` | The addresses a customer names for a shared email channel, a JSON array, unique per `tenantId` and `configId`. `tenantId` is the customer, in `TENANT_MODELS` |

`connectionShareService` in `connection-shares.ts` runs in the scope of the tenant that shares, so it finds only its own connections, and `sharedKindOf` lets only a destination or a channel through. `save` refuses a tenant without `sharesWithCustomers`, refuses to share a destination while a job of the tenant called `tenants` (`TENANTS_FOLDER`), or whose name starts with `tenants/` (`isTenantsFolderName`), writes to it, refuses the first share while `tenants/` holds a file (`customerFolderFiles`), and wants `confirmed` when a tenant loses a destination. It takes the connection away first with `forgetConnection` and writes the share only then, so a storage that does not answer leaves the share as it was. `view` and `losing` say how each customer uses it, from its jobs and templates and from `storageEntriesOf`.

The actions in `actions/tenant/connection-share.ts` check `SHARE_PERMISSION` or `SEE_SHARING_PERMISSION`, refuse All tenants and write `share` and `unshare` into the log of the tenant that shares. They hand the service the reach of the viewer, and `boundToReach` in `share-reach.ts` keeps a change inside it: every tenant, and any change of a share with every tenant, needs `"all"`, a picked tenant beyond the reach is refused, the tenants beyond it that the share names stay on it, and the terms stay while one of them gets it. `stopFor` and `deleteBackupsOf` refuse such a tenant. `view` lists the reached tenants as `candidates` and what stays locked in `reach` (`ShareReachView`), which the dialog and the card follow. Each customer that lost the connection gets an `unshare` entry with its lost jobs, templates and backups in its own log (`origin.tenantId`), which `withdrawnConnections` in `withdrawn.ts` reads back for the note of the Connections page during `WITHDRAWN_DAYS`. The recipients a customer names (`setChannelRecipients`) need `notifications:write` in its tenant.

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
| `openRow(row, mode)` | The adapter wrapped in `storageView(adapter, mode)`, with the resolved config. In the view of a customer a config that cannot be resolved throws `SHARED_STORAGE_FAILURE`, never the message, which names the logins of the tenant that shares it |
| `openDestination(id, tenantId?)` | Both at once |
| `destinationAccess(row, tenantId)` | The mode with the `ProvidedConnection`, whose `encryptedOnly` the runner reads |

`StorageViewMode` is `own` for a destination nobody shares, the plain adapter, `provider` for the tenant of a shared destination, which sees everything but `tenants/` and gets a `ValidationError` for a path into it, and `customer` with its tenant id, which sees `tenants/<id>/` alone with every path relative to it. `cleanPath` refuses `..` and every other segment of dots and spaces alone, like `.. ` or `...`, which Windows reads as `..`, and the folder of the customers is found without the dots and spaces at the end of its name, in lower and in upper case. A listed file the view could never name is left out of a listing. The view maps the path of `upload`, `download`, `list`, `delete`, `read`, `verifyChecksum`, `downloadRange` and `openSession`, and leaves out `listTree`, `downloadDirectory`, `createSymlink` and `browseDirectories`, since a destination never serves as a directory source.

::: warning Rule for new code
Code that reads or writes backups opens the destination through `openDestination`, or `findDestination` with `openRow` when it needs the row first. Never `registry.get` with `resolveAdapterConfig` itself, which reaches the folder of every customer.
:::

The exceptions know why: `01-initialize.ts` builds the view from `destinationAccess` with the tenant of the job and records a refusal for the upload instead of throwing, `SHARED_STORAGE_FAILURE` for a provided destination whose config cannot be resolved, `refreshStorageStatsCache` lists a whole destination in the system scope and splits it by tenant, and the configuration backup uses a destination of the home tenant as it is. Its file there holds the keys of the instance, so whichever tenant looks at the destination, every download, analysis and restore of it is for a platform admin with a session alone, see [Who Downloads It](/developer-guide/advanced/config-backup#who-downloads-it).

### Caches and Numbers per Tenant

- `StorageListCache` is keyed by `adapterConfigId` and `tenantId` and sits in `TENANT_MODELS`. A shared destination keeps a listing per tenant, each with the backups of that tenant alone. `storageService.listingTenant` picks the tenant of a call like `findDestination` does.
- `refreshStorageStatsCache` writes one `StorageVolumeEntry` per destination and tenant (`entriesOf`), counting `tenants/<id>/` for that customer while it gets the destination, the folder of any other tenant for nobody, and everything else for the tenant of the destination, and saves the `StorageSnapshot` rows per tenant. `getStorageVolume` shows a tenant its own backups on its own and on provided destinations, All tenants one entry per destination. `storageEntriesOf(configId)` gives the tenant that shares the space of each customer. The storage limit and the usage spike of a shared destination watch its whole storage, the backups of its customers included, while the missing backup alert watches its own tenant's runs.

### Channels

`channelTarget(channel, tenantId)` in `channel-recipients.ts` decides where a message of a tenant through a channel goes: an own channel sends as it is set, a provided channel to the recipients the customer named when `ownRecipients`, else as it is set. It refuses once the channel is no longer shared with the tenant and while the customer named nobody, so a message of a customer never reaches the recipients of the tenant that shares by mistake. `sendThroughChannel` and `04-completion.ts` ask it before every send and record a refusal as a failed notification. `setRecipients` keeps at most `MAX_RECIPIENTS` (20), and `sendRecipientsTest` sends a plain notification, never the SMTP test of the channel, whose mail would name the server and sender.

### Taking It Back

`forgetConnection(configId, kind, tenantIds, deleteBackups = true)` in `share-cleanup.ts` takes every link of each tenant to the connection away, in the system scope. On a destination it deletes the backups of the tenant first with `deleteTenantBackups`, which opens the destination in the view of that customer so nothing outside its folder is touched, then its `JobDestination` rows and its listing. A channel leaves the template channels of the tenant, the notifications of its jobs, its `ChannelRecipients` and its tenant notification settings. Only `tenantService.delete` of the tenant that shares passes `false`, since its connection goes and the storage stays, and passes its transaction as `tx`, so its customers keep every link when the delete fails. Deleting a customer deletes its backups on provided destinations after the delete, in the background (`clearBorrowedDestination`). A share left with nobody is dropped only after `sweepCustomerFolder` emptied `tenants/`, and kept with nobody when the storage does not answer, like `save` does, and the numbers of the destination are refreshed either way.

`removeAdapter` refuses a connection with a `ConnectionShare` with a `ConflictError`, and `tenantService.setSharing` refuses to switch off while the tenant has one.

### No Second Way In

The view of the tenant that shares hides `tenants/` of a shared destination, which a second, unshared connection to the same place would show. `assertOffSharedPlaces(adapterId, config, logins, exceptId)` in `src/services/adapters/shared-place.ts` refuses a storage connection of either role whose place equals, lies inside or holds the place of a destination the tenant that runs now shares with customers. `createAdapter`, `cloneAdapter` and `updateAdapter` (when the config or a login changes, leaving the connection itself out) call it. The place is `storagePlaceOf(adapterId, config)` in `src/lib/adapters/storage-place.ts`, the storage (a server, a bucket on its endpoint, a share, the app of a cloud drive) and the folder in it, with the logins laid over the config by `layLoginsOver`, since a relative folder of SFTP lies in the home of its account. SFTP and rsync on one host are one storage, Amazon S3 and a generic S3 at an endpoint of Amazon too. It compares the address as typed, so a name and its address count as two storages, and a folder of Google Drive is an id, so only the same folder and the top of the drive are found there. A connection that overlapped before the destination was shared stays as it is.

### Tenant Allowances

`Tenant.addsDatabases`, `addsDirectorySources`, `addsDestinations`, `addsChannels` and `addsApiKeys` say what a tenant adds itself, `ALLOWANCE_KINDS` in `src/lib/tenant/allowances.ts`. `assertMayAddKind(kind)` in `src/services/tenant/tenant-allowances.ts` refuses something of a kind the tenant that runs now may not add with a `ValidationError`, and passes outside a tenant, like the configuration restore. `assertMayAdd(type, storageRole)` asks it for a connection. `createAdapter`, `cloneAdapter`, a role change in `updateAdapter`, a connection back from Recently deleted in `restoreFromTrash` and `apiKeyService.create` call it, and so does any new path that creates one of these. `setAllowances` refuses the home tenant. The action `setTenantAllowances` needs `platform-tenants:write` and a tenant the viewer manages, and writes the change into the log of the home tenant and of the tenant. The pages read the allowances from `tenantService.switchable` through `useMayAdd(kind)`, and `tenantsThatCreate` leaves a tenant out of the pick of New in All tenants.

A connection that reaches the server DBackup runs on, its files, its Docker, its sockets, the tools it runs with options of the connection and its SSH keys or agent, belongs to the home tenant only. `hostLocalReason(adapterId, config)` in `src/lib/adapters/host-local.ts` says why one does. `createAdapter`, `updateAdapter` and `cloneAdapter` refuse it outside the home tenant through `assertMayReachHost`, every config of a form that a route runs before it is saved goes through `overlayCredentialsOnConfig` or `assertConfigOffHost`, and `resolveAdapterConfig` refuses a stored one of a customer at run time, also when a login it names changed later. A new adapter that touches the server itself, or a new option that a tool on the server reads, gets a rule there. The MySQL restore runs its client with `lockedDownClientArgs`, so a dump runs no shell command and sends no local file.

### The Local Network

`Tenant.blocksLocalNetwork` says whether the connections of a tenant reach the local network of the server DBackup runs on, and `Tenant.allowedNetworks` (a JSON array of CIDR ranges) what they reach anyway. The migration `20261018120000_tenant_network` sets the column to false for every tenant it finds, a new tenant starts with true. The home tenant is never blocked, whatever its column says, `networkOfRow` reads it as false.

| Module | Holds |
| :--- | :--- |
| `src/lib/network/local-network.ts` | What counts as local (`LOCAL_NETWORK`: loopback, this network, private, link-local, the shared space `100.64.0.0/10` of VPN overlays, multicast, reserved and broadcast, and for IPv6 `::1`, `::`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`), an IPv4 inside IPv6 (mapped or NAT64) checked as its IPv4, the address parser and `parseCidr`, which refuses anything malformed and bits after the prefix. No Node.js module, so the Edit dialog checks a range as it is typed with the same code. The tests compare its parser with `isIP` of `node:net` |
| `src/lib/adapters/dialed-hosts.ts` | `DIALED_HOSTS`, per adapter id the hosts DBackup itself connects to for a config. `tests/unit/adapters/dialed-hosts.test.ts` fails for an adapter without an entry |
| `src/lib/network/reach-check.ts` | `firstBlockedAddress(hosts, allowed)`: an IP literal as it is, a name through `dns.promises.lookup` with `all: true`, a host that does not resolve within five seconds passes |
| `src/services/tenant/tenant-network.ts` | `assertTenantReach(tenantId, adapterId, config)`, `assertReachFromHere` for the tenant that runs now, `assertHostsReachable` for hosts of its own, and `setNetwork`. The refusal is a `ValidationError` like `Acme reaches no address of the local network, db.internal is 10.0.0.5. The platform allows ranges for it under Platform, Tenants.` |

A database in direct mode dials its host and every host of a list (PostgreSQL's `a,b`, the sentinels of Redis, the hosts of a MongoDB URI), in SSH mode the SSH host alone, since whatever lies behind it is reached from that server. SQL Server tunnels to its SSH host, which falls back to the database host, and its older file transfer over SSH dials both. A storage dials the server of its address, an S3 endpoint and the host of the bucket on it unless the bucket goes in the path (the endpoint of R2 and Hetzner is built from a field the person types, so it counts too). A channel dials every URL or host a person types. Amazon S3, the cloud drives, Telegram and Twilio have endpoints of their own and dial nothing to check. An agent will be like SSH mode: DBackup dials the agent, the agent the database, so only the address of the agent counts.

The check runs wherever a config of a tenant is used:

- `resolveAdapterConfig` checks a saved connection with the tenant of its row, beside `hostLocalReason`, for every run, test, health check and notification that resolves one. A destination or a channel another tenant shares follows the setting of that tenant, never the one of the customer whose run uses it.
- `assertConfigOffHost`, which `overlayCredentialsOnConfig` calls, checks every config of a form a route runs before it is saved, in the tenant that runs now: Test connection (`connection-test.ts`), the access check, the reads of databases by config, the browse of a location and the SSH test. `listRemoteDirectory` checks the host it dials itself, whatever the mode of the form.
- `assertMayReachHost` in `createAdapter`, `updateAdapter` and `cloneAdapter`, so a person learns it on save. `layLoginsOver` lays the logins over a config without any check, for the callers that check or only compare the result.

The action `setTenantNetwork` in `actions/tenant/tenant.ts` needs `platform-tenants:write` and a tenant the viewer manages, refuses the home tenant and All tenants, and writes `diffFields` of the block and the ranges into the log of the home tenant and of the tenant. `TenantRow.network` carries both to the Tenants page.

::: warning A guard against mistakes and plain misuse
The check reads the answer of the resolver when it runs, and the adapter resolves the name again when it connects. A hostile DNS server that answers a public address first and a private one after gets past it, so is a host whose lookup takes longer than five seconds. The firewall of the server keeps out what must never be reached.
:::

## Tenant Notifications

The channels of Settings → Notifications belong to the platform and hear about every tenant. A tenant other than the home tenant also picks channels of its own for the events about its own data, under the Notifications part of its tenant settings.

| Module | Holds |
| :--- | :--- |
| `src/lib/notifications/tenant-events.ts` | `TENANT_EVENT_DEFINITIONS`, the events a tenant may hear about: the three runs of a job, which the platform only hears about through the job, and the restores, storage alerts, connections and the integrity check in the words of the platform. `getTenantEventDefinition` is undefined for an event of the platform alone, like a sign-in or a new version |
| `src/services/notifications/tenant-notification-settings.ts` | What a tenant stored, in `SystemSetting` under `notifications.tenant.<id>` (`tenantNotificationKey`), with default channels and channels per event like the platform, without reminders and mails to a person. A save checks every channel against the own ones and those another tenant shares (`providedTo`). `tenantHearsAbout` tells a caller whether gathering the event is worth it |
| `src/services/notifications/tenant-notification-delivery.ts` | `recordTenant`, the tenant an event is about: the one a caller names, else the connection, run or job it names, else the tenant that runs now. `deliverToTenant` sends to the picked channels in `runAsTenant` of that tenant, the shared ones read in the system scope, and never for the home tenant. `sendTenantEventTest` is Send a test |
| `src/services/notifications/channel-send.ts` | `sendThroughChannel`, shared by the platform and the tenants. It asks `channelTarget` before every send and records the send in the notification log of the tenant it was for, also through a shared channel. A customer reads `SHARED_FAILURE` instead of the error of a channel another tenant shares |
| `src/services/notifications/tenant-integrity.ts` | `notifyTenantsOfIntegrity`, after the integrity check: each tenant whose copies failed hears about its own copies alone, by the tenant whose run checked them, never by the tenant of the destination |

`notify()` finds the tenant with `recordTenant` before it enters the system scope of the platform, which would hide the tenant of a run, and then sends to the platform and to the tenant. A run of a job sends with `platform: false` and `skipChannelIds` from `04-completion.ts`, so a channel the job told already gets it once. The actions in `actions/tenant/tenant-settings.ts` need `tenant-settings:write` in the tenant they change and refuse the home tenant, which reports through the notifications of the platform.

## The Logo

`TenantLogo` keeps the logo of a tenant in the database, one row per tenant, like `Avatar` keeps the pictures of the people, so a configuration backup brings it back. `src/services/tenant/tenant-logo-service.ts` stores at most 1 MB (`TENANT_LOGO_MAX_BYTES`) and reads the type from the first bytes with `imageTypeOf`, PNG, JPG, GIF or WebP, never SVG, which could carry a script. `GET /api/tenants/[id]/logo` serves it with `nosniff` to whoever `mayViewTenantLogo` allows, a platform admin, the tenant a request acts in, a member or a platform group that reaches the tenant, and answers anyone else like a tenant without a logo. Its address carries the time of the logo in `?v=` (`tenantLogoUrl`), so it is cached for good. `POST` and `DELETE` need `tenant-settings:write` in the tenant the request acts in and write into its audit log.

## Invitations

`TenantInvitation` keeps a link into a tenant with a group, an optional note, its maker and when it runs out, and only the SHA-256 of its token (`tokenHash`). `invitationService` in `src/services/tenant/invitation-service.ts` makes a token of 32 random bytes and hands it back once. A link works from 1 to 30 days, 7 by default, and a tenant has at most 100 open ones (`OPEN_INVITATIONS_MAX`). `openInvitation` finds a link by the hash and treats a link that is unknown, used, run out, or whose maker may no longer give its group (`creatorMayGive` through `roleRefusal`) the same.

`acceptWithNewAccount` marks the link used before it makes the account, so two requests at once make one account, and frees it again when the account fails. A refusal, like an email with an account or one whose domain the provider of another tenant claims, counts against the link in a map of the process by the hash, and the fifth (`MAX_FAILED_SIGN_UPS`) spends the link, since a refusal tells whether an email has an account. The count lives in memory, so a restart resets it. The actions in `actions/tenant/invitation.ts` write the creation and the revoke with the note, and the accept, into the audit log of the tenant.

## Permissions

`src/lib/auth/owner-permissions.ts` decides what someone may do while working in a tenant:

| Function | Returns |
| :--- | :--- |
| `groupPermissions(group)` | Every permission for a `fullAccess` group, else the stored ones DBackup knows |
| `permissionsIn(memberships, tenantId)` | The group in the tenant without the platform permissions, plus the platform permissions from the group in the home tenant, plus the profile permissions from any group |
| `ownerPermissionsIn(owner, tenantId, tenantShares)` | The ceiling of an API key in its tenant: every permission of a tenant for a platform admin, else `permissionsIn` without what a platform group gives on the platform. In a tenant that shares with customers also the `platform-sharing:*` the owner holds (`keyPlatformPermissions(tenantShares)`) |
| `capToOwner(key, owner)` | What the key holds and its owner may do now |

`PLATFORM_PERMISSIONS` are `settings:*`, which act on the whole instance. Groups belong to a tenant, so `groups:*` counts in each tenant, and `tenant-settings:*` covers the tenant's own settings and its Recently deleted (`TRASH_ADMIN_PERMISSION`). `PROFILE_PERMISSIONS` are `profile:*`, which change the own account, which belongs to no tenant. With one tenant `permissionsIn` is exactly what the group gives.

`AuthContext` carries `tenantId`, `isPlatformAdmin` and `allTenants`. A platform admin passes every check of `checkPermission` and `checkPermissionWithContext` inside a tenant, never through an API key, and in All tenants only what `ALL_TENANTS_PERMISSIONS` holds. The tenants and their members check `platform-tenants:*` (`actions/tenant/tenant.ts`, `members.ts`). `checkPlatformAdmin()` guards the platform admin role and the keys of the home tenant a configuration restore picks from (`getPlatformEncryptionProfiles`). `getViewer()` returns the user with `isPlatformAdmin`, `tenantId`, `permissions` and `role`, their group in the tenant.

### Platform Groups

A `PlatformGroup` gives the people of the MSP rights without the platform admin role, which stays `User.platformRole` and shows in the pages as the built-in group Platform admin. A user holds at most one through `User.platformGroupId`. Its `platformPermissions` are the settings of the instance and the rights of `PLATFORM_ONLY_PERMISSIONS` (`platform-tenants:*`, `platform-accounts:*`, `platform-sign-in:read`, `platform-sharing:*`), which are kept apart from `AVAILABLE_PERMISSIONS`, so no group of a tenant ever holds them. Its `tenantPermissions` count in every tenant when `allTenants`, else in those of `PlatformGroupTenant`.

`permissionsIn(memberships, tenantId, platformGroup)` adds the tenant rights of the group in a tenant of its scope (`platformTenantRightsIn`) and its platform rights (`platformRightsOf`), and `ctx.permissions` carries both, so a platform right is checked like any other. `pickTenant` opens a tenant of the scope without a membership, and All tenants for a group that reaches every tenant and reads there (`opensAllTenants`), with `allTenantsPermissionsOf`. `ownerPermissionsIn` gives an API key the tenant rights of its owner's platform group, and of its platform rights only `platform-sharing:*` in a key of a tenant that shares with customers. The settings of the instance from the owner's group in the home tenant still count for a key, as before tenants. `platform-sign-in:write` is in no list a group draws from, so only a platform admin changes a sign-in provider.

Two rights of the platform follow the scope as well, through `platformGroupService.reachOf`, which returns `"all"` for a platform admin and a platform group of all tenants and the tenants of the scope otherwise (`PlatformReach`, `reachCovers` in `platform-group-caps.ts`). `platform-sharing:*` gives to and takes from the reached tenants only, see [Shared Databases](#shared-databases) and [Shared Destinations and Channels](#shared-destinations-and-channels). `platform-sign-in:read` shows the providers of the platform and of the reached tenants, with the groups they place people in and the accounts that work there, `getSsoProvidersModel` with a `SsoProvidersScope`, while `settings:read` still shows every provider.

Someone of a platform group looks after a tenant on Platform > Tenants, its members, its name, its sharing and its delete, only when their platform group reaches it (`platformGroupService.reaches`). A membership there gives no right on the platform. Creating a tenant needs a platform admin or a platform group of all tenants (`reachesAll`), since a group of some tenants would never reach the new one.

`platform-accounts:*` follow the reach as well. `accountsSeenReach` in `src/services/user/account-visibility.ts` is the reach whose people someone sees through them, `"all"` also in All tenants. For a group of some tenants `maySeeAccount`, `maySeePicture`, `getAllUsersModel` and `getPlatformGroupsModel` keep to the accounts with a membership in a reached tenant (`membersOfAny`), an account in no tenant counting as one of the home tenant like in `accountRefusal`, their own account, only the reached tenants of each and the groups of those tenants. The members of the platform groups and the people of the sign-in providers follow the same rule. `accountRefusal` reads the reach of the actor (`AccountActor.reach`, from `userService.accountsReachOf`), and the Users tab marks a row it does not cover `beyondReach`, which `accountLock` reads. New user offers `newUserTenants` with `newUserGroups` from `viewerReach`, as `createUser` checks them: a reached tenant for `platform-accounts:write`, or one where the viewer holds `users:write`. Someone of a group of some tenants gives a platform group with `setUserPlatformGroup` only to an account `accountRefusal` lets them change, and `createPlatformUser` needs a reach of every tenant, since the new account is in none. `emailClaimScope` lets a group of some tenants give the emails the providers of its tenants claim.

### Groups for Tenants

A `TenantGroupTemplate` is a group the platform makes once (`src/services/user/tenant-group-templates.ts`): a name, unique among them and never Admin, the permissions of a group of a tenant without the settings of the instance (`templateRights`), and `allTenants` or the tenants of `TenantGroupTemplateTenant`. Each tenant it reaches has a real `Group` with `templateId`, so the checks of a tenant read it like any group of theirs, and `@@unique([tenantId, templateId])` keeps one per tenant. `groupService.update`, `delete` and `deleteMany` refuse a linked group with `fromPlatform`, and the actions say so first.

`preview` lists what a save asks: a tenant to reach with an own group by the name (`ReachClash`, with its members and what they gain and lose) and a tenant it leaves where people hold it (`ReachLeave`, with the other groups there). `save` and `remove` take the answers as a `ReachPlan` and do all of it in one transaction in `runAsSystem`, refusing a missing answer. A group taken out moves its members and the sign-in providers that add people to it like `groupService.delete`. `seedTenantGroups` gives a new tenant the groups for all tenants and its full access Admin, nothing else. The presets of New group for tenants are `TENANT_GROUP_TEMPLATES` in `src/lib/auth/group-templates.ts`, led by Client, and the editor starts from them through `draftOf` in `tenant-group-template-model.ts`, which leaves out what the viewer may not give.

The actions in `actions/auth/tenant-group-template.ts` need `platform-accounts:write` and cap a group for tenants like a platform group without rights on the platform (`platformGroupRefusal`), a move of members into a group by `lockedTenantRight`, and a take-over of a group of a tenant by `takeOverRefusal`: someone of a platform group takes over no group with `fullAccess` or with a permission their platform group does not give there. `previewTenantGroupTemplate` marks such a clash `beyondYou`, which the dialog offers only to leave out. They write the group to the log of the home tenant with `forTenants`, and per tenant what happened to its group with `fromPlatform`.

`src/lib/auth/account-access.ts` guards the people:

- `accountRefusal(actor, target)`: a platform admin may change any account, nobody else the one of a platform admin. An account of a platform group is changed only by someone with `platform-accounts:write` who may give that platform group (`platformGroupRefusal` in `platform-group-caps.ts`), never by the admin of a tenant. Whoever holds `platform-accounts:write` changes any other account whose tenants their reach all covers (`reachCoversAccount`), every one for a platform group of all tenants, and an account of a platform group only within it too. Anyone else, and someone of a platform group beyond their reach, changes as a tenant admin with `users:write` only an account whose memberships are all in their tenant. An account of no tenant counts as one of the home tenant. `userService.accountRefusalFor` reads both sides and the reach.
- `roleRefusal(actor, group)`: a group is given only by someone who holds every permission it gives in that tenant, from `roleGrantsIn`. On Platform > Tenants it is checked against what the viewer may do in that tenant (`actorIn` in `members.ts`), for the group given and for the one taken.
- `updateUserGroup` and `moveUsersToGroup` give a group of the tenant only to its people, `membershipService.isPersonOf` with `peopleOf`: its members, and in the home tenant the accounts of no tenant. Only a platform admin gives one to a platform admin or to anyone else. The others join by an invitation or through Platform > Tenants.

A change of an account writes its audit entry into the log `accountLogOrigin` in `src/services/audit/account-log.ts` picks, read before the change: the tenant the viewer works in while every account is one of its people, else the home tenant (`PLATFORM_LOG`), see [Audit Logging](/developer-guide/advanced/audit).

Recently deleted keeps an account where someone may bring it back, never by the tenant it was deleted from. `keepInTrash` writes its `DeletedRecord` in the system scope into the tenant of the snapshot: the one tenant of an account with exactly one membership, no platform role, no platform group and no API key in another tenant, else the home tenant with `superAdminOnly`. Undo of the viewer's own delete reads the newest entry of each account in every tenant with `latestAccountEntries`, keeps those `mayRestoreAccount` allows (a platform admin any, anyone else with `users:write` or `platform-accounts:write` an entry without `superAdminOnly` whose account `accountRefusal` lets them change with their reach), and restores them with `restoreFromTrash(ids, { anyTenantAccounts: true })`. An account comes back with an email whose domain the provider of another tenant claims only through a platform admin or someone of a platform group that reaches that tenant, `claimedAccounts` with `emailClaimScope` in `actions/settings/trash.ts`, and its API keys stay out of a tenant without `addsApiKeys`.

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
