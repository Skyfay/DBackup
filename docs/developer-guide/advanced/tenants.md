# Tenants

Every row that holds data of a customer belongs to one tenant, and a Prisma extension narrows each query to the tenant of the code that runs now. Services read and write as before and never pass a tenant around. The code lives in `src/lib/tenant/` and `src/services/tenant/`, the user side in [Tenants](/user-guide/admin/tenants) and [Shared Databases](/user-guide/admin/shared-databases).

## The Model

| Model or field | Holds |
| :--- | :--- |
| `Tenant` | A customer, with a unique name. `HOME_TENANT_ID = "default"` in `src/lib/tenant/home.ts` is the home tenant, which the migration creates as Default and which is never deleted |
| `TenantMembership` | `{ userId, tenantId, groupId }`, the group (role) of an account in one tenant. The group is one of that tenant |
| `TenantInvitation` | A link into a tenant with a group, kept as the SHA-256 of its token |
| `User.platformRole` | `"ADMIN"` (`PLATFORM_ADMIN_ROLE`) for a platform admin, else null |
| `Group.fullAccess` | The group with every permission, which cannot be edited or deleted. Nothing checks a group by its name |
| `Session.activeTenantId` | The tenant a session picked with the switcher |
| `tenantId` on every model in `TENANT_MODELS` | The tenant of the row. Its default `"default"` only fills the rows of the migration |
| `DatabaseAssignment`, `DatabaseAssignmentRule` | The databases of a shared server given to another tenant, see [Shared Databases](#shared-databases) |

Users, groups, sessions, sign-in providers and the system settings belong to no tenant. Names of saved logins and of the five template kinds are unique per tenant (`@@unique([tenantId, name])`), so services look them up with `findFirst({ where: { name } })`.

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

- **A session**: `pickTenant` in `access-control.ts` takes `Session.activeTenantId` while the account is still a member there (a platform admin any tenant that exists), else the home tenant for a member of it, else the first membership. Null for an account of no tenant. A platform admin starts in All tenants while there is more than one tenant, else in the home tenant.
- **All tenants**: a platform admin's session that stores `ALL_TENANTS` (`"*"`, from `src/lib/tenant/home.ts`) gets `allTenants: true` and no `tenantId`. Its scope is `all`, see below.
- **An API key**: `apiKeyService.validate` runs in `runAsSystem`, since a key is found by its hash before its tenant is known, and returns `tenantId`, the tenant the key was made in.

`currentTenantId()` answers the same question for code that has to name a tenant itself, like the audit log, which writes in the system scope: the tenant of `runAsTenant`, null in the system scope, else the one of the request.

`tenantOf(ctx)` from `access-control.ts` returns the tenant of a context or throws `PermissionError` for an account of none and in All tenants.

### All Tenants

All tenants is the view of a platform admin over every tenant at once. The scope `all` reads every tenant unfiltered and refuses every create, update and delete of a tenant model or a child row with `TenantScopeError`, except the caches a read fills on the way (`StorageListCache`, `DatabaseListCache`, `HealthCheckLog`, `DbVersionHistory`). A change belongs to one tenant, and only there `assertOwnRecords` can check what it links. The UI opens a record in its tenant before it changes it, through `useOpenInTenant` in `src/components/tenant/tenant-view.tsx`, and asks for the tenant of a new record with `TenantPickDialog`.

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
| System tasks, `systemTaskService.runTask` | `runAsSystem`, also when someone starts one from a page. `SystemTaskRunner` records the run of the integrity check in the home tenant, and a check of backup copies someone starts from a page in their own tenant |
| `notify()`, the system notifications | `runAsSystem`, the channels of Settings → Notifications belong to the platform. `recordNotificationLog` writes into the tenant of the channel, else the current one, else the home tenant |
| `refreshStorageStatsCache` | `runAsSystem` for every destination. `getStorageVolume` filters the cached entries to the destinations the caller sees |
| `auditService.log` | Writes in `runAsSystem` into `origin.tenantId`, else `currentTenantId()`, else the home tenant. The sign-in hooks name the home tenant themselves, so a sign-out lands there too and not in the tenant the session looked at |
| Restore of a shared database | `restoreService.restoreShared` in `runAsSystem`, the run recorded in the customer's tenant |

### Caches and Tokens

- `cached()` in `src/services/dashboard/cache.ts` prefixes every key with `currentTenantId()`, `*` in the system scope, so the numbers of one tenant never answer another.
- A download link is fetched without a session, so its token carries the tenant it was made in (`generateLinkToken({ tenantId, ... })`), and `GET /api/storage/public-download` serves it inside `runAsTenant` of that tenant. A token without a tenant is served in the home tenant.

## Shared Databases

`DatabaseAssignment` and `DatabaseAssignmentRule` name the customer in `tenantId`, but belong to the tenant of their server and sit in `CHILD_MODELS` through `source`. The tenant of the server manages them with `databaseAssignmentService` in `src/services/tenant/database-assignments.ts`, under the normal filter.

Who a database belonged to at a time is plain data, `ownerAt()` in `src/lib/tenant/database-owner.ts`: the assignment of the name that held then, else the matching rule of the highest priority and, of equal ones, the oldest. A backup is judged by its `createdAt`, never by the owner now. `assign()` ends an assignment rather than deleting it, and moves a backdated start up to the end of the previous one.

`src/services/tenant/shared-databases.ts` is the one path that reads across tenants on purpose. In `runAsSystem` it reads the server, its jobs, the destinations of the server's tenant and their cached listings, and keeps the archives with an index (`hasFileIndex`) that hold the database and were made while the customer owned it. The key of a backup never leaves the module. Every download and restore checks the backup again from its reference, never from what the browser sends along.

## Permissions

`src/lib/auth/owner-permissions.ts` decides what someone may do while working in a tenant:

| Function | Returns |
| :--- | :--- |
| `groupPermissions(group)` | Every permission for a `fullAccess` group, else the stored ones DBackup knows |
| `permissionsIn(memberships, tenantId)` | The group in the tenant without the platform permissions, plus the platform permissions from the group in the home tenant, plus the profile permissions from any group |
| `ownerPermissionsIn(owner, tenantId)` | Every permission for a platform admin, else `permissionsIn`. The ceiling of an API key in its tenant |
| `capToOwner(key, owner)` | What the key holds and its owner may do now |

`PLATFORM_PERMISSIONS` are `settings:*`, which act on the whole instance. Groups belong to a tenant, so `groups:*` counts in each tenant, and `tenant-settings:*` covers the tenant's own settings and its Recently deleted (`TRASH_ADMIN_PERMISSION`). `VIEWER_PERMISSIONS` is the group Viewer every new tenant starts with, beside its full access Admin. `PROFILE_PERMISSIONS` are `profile:*`, which change the own account, which belongs to no tenant. With one tenant `permissionsIn` is exactly what the group gives.

`AuthContext` carries `tenantId`, `isPlatformAdmin` and `allTenants`. A platform admin passes every check of `checkPermission` and `checkPermissionWithContext` inside a tenant, never through an API key, and in All tenants only what `ALL_TENANTS_PERMISSIONS` holds. `checkPlatformAdmin()` guards the tenants, their members and the platform admin role. `getViewer()` returns the user with `isPlatformAdmin`, `tenantId`, `permissions` and `role`, their group in the tenant.

### Platform Groups

A `PlatformGroup` gives the people of the MSP rights without the platform admin role, which stays `User.platformRole` and shows in the pages as the built-in group Platform admin. A user holds at most one through `User.platformGroupId`. Its `platformPermissions` are the settings of the instance and the rights of `PLATFORM_ONLY_PERMISSIONS` (`platform-tenants:*`, `platform-accounts:*`, `platform-sign-in:read`, `platform-sharing:*`), which are kept apart from `AVAILABLE_PERMISSIONS`, so no group of a tenant ever holds them. Its `tenantPermissions` count in every tenant when `allTenants`, else in those of `PlatformGroupTenant`.

`permissionsIn(memberships, tenantId, platformGroup)` adds the tenant rights of the group in a tenant of its scope (`platformTenantRightsIn`) and its platform rights (`platformRightsOf`), and `ctx.permissions` carries both, so a platform right is checked like any other. `pickTenant` opens a tenant of the scope without a membership, and All tenants for a group that reaches every tenant and reads there (`opensAllTenants`), with `allTenantsPermissionsOf`. `ownerPermissionsIn` gives an API key the tenant rights of its owner's group and never the platform rights. `platform-sign-in:write` is in no list a group draws from, so only a platform admin changes a sign-in provider.

`src/lib/auth/account-access.ts` guards the people:

- `accountRefusal(actor, target)`: a platform admin may change any account, nobody else the one of a platform admin, and a tenant admin only an account whose memberships are all in their tenant. An account of no tenant counts as one of the home tenant.
- `roleRefusal(actor, group)`: a group is given only by someone who holds every permission it gives in that tenant, from `roleGrantsIn`.

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
