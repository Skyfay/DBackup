# Audit Log System

The audit log records sign-ins and every change, run, restore, download and revealed secret, with who did it, from where, and what changed.

## Architecture

### Database Schema

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  userId      String?  // Who did it, null for a failed sign-in or a user deleted before names were kept
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  actorName   String?  // The name of the user when the entry was written, kept after the user is deleted
  apiKeyId    String?  // The API key the request came with
  apiKeyName  String?  // Its name at the time
  action      String   // AUDIT_ACTIONS
  resource    String   // AUDIT_RESOURCES
  resourceId  String?  // The record the entry is about
  details     String?  // JSON, see Details below
  ipAddress   String?  // clientAddress(), set by the custom server from a trusted proxy
  userAgent   String?
  tenantId    String   @default("default") // The tenant whose log keeps the entry
  createdAt   DateTime @default(now())
}
```

### Constants

`src/lib/core/audit-types.ts` holds `AUDIT_ACTIONS` (`LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `CREATE`, `UPDATE`, `DELETE`, `EXECUTE`, `RESTORE`, `EXPORT`) and `AUDIT_RESOURCES` (`AUTH`, `USER`, `GROUP`, `JOB`, `BACKUP`, `ADAPTER`, `VAULT`, `CREDENTIAL`, `API_KEY`, `TEMPLATE`, `SYSTEM`, `SSO_PROVIDER`, `TENANT`, plus `SOURCE` and `DESTINATION` from before). `src/lib/core/audit-areas.ts` groups the resources into the areas of the Area filter and the actions into the quick filters. `EXPORT` and `RESTORE` count as sensitive.

## Writing an Entry

Every Server Action and API route that changes something, runs something or hands out data writes an entry after it succeeded.

```typescript
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

// A Server Action, the session user is the author.
await auditService.log(user.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.GROUP, { name: group.name }, group.id);

// An API route, which may be called with an API key.
await auditService.logFor(ctx, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.JOB, { name, changes }, job.id);
```

- `logFor(ctx, ...)` takes the `AuthContext` of the route and records the API key when the request came with one. The key acts as its owner, so `userId` is the owner.
- The service reads the address and the browser from the request it runs in and snapshots the names of the user and the key. Callers never pass them. Outside a request, like in a scheduled task, they stay empty.
- `log` never throws. A failed write is logged, the action goes on.
- The entry goes into the log of `origin.tenantId` when the caller names one, else of `currentTenantId()`, else of the home tenant, and is written in `runAsSystem`. A group belongs to its tenant, so its changes go into the log of that tenant. What belongs to the platform names the home tenant itself, whichever tenant the admin works in: the tenants, platform admins, platform groups and sign-in providers, and the settings of the instance, the system tasks, data retention, the certificate, the download and optimize of the database, the configuration backup and its restore, the login image and the notification settings. An action passes `PLATFORM_LOG` from `src/services/system/settings-save.ts` as the last argument, a route `platformLogFor(ctx)`, which also names the API key of the request, and `savePart` does it for the parts of the Settings page that save through it. A sign-in has no tenant in its request yet and lands there as well. See [Tenants](/developer-guide/advanced/tenants).
- A change of an account, the own one included, its password, second factor, sessions, name, email, dates, preferences, picture, sign-in accounts or its delete, names its log with `accountLogOrigin(viewer, userIds)` from `src/services/audit/account-log.ts`, read before the change, since a delete ends the memberships. The tenant the viewer works in keeps the entry while every account is one of its people (`membershipService.isPersonOf`), anything else, a change made in All tenants included, goes into the home tenant with `PLATFORM_LOG`. So a customer never reads what someone did to an account of another tenant, nor what someone of the platform changed of their own account while working there. The actions in `user.ts`, `user-security.ts`, `profile.ts` and `sso-connections.ts`, the route of the own picture `api/user/avatar` and the link callback `api/auth/sso-link-callback` pass it, `togglePasskeyTwoFactor` among them, which writes `UPDATE USER` with the change `Passkey as second factor`. The restore of a deleted account from Recently deleted, Undo included, writes into the tenant the viewer works in only while the account waited there, else with `PLATFORM_LOG` (`recordRestored` in `actions/settings/trash.ts`).

Sign-ins, failed sign-ins and sign-outs are written by the server around the endpoints of better-auth, in `src/lib/auth/sign-in-audit.ts`: the `after` hook turns a new session into `LOGIN` with its method (`password`, `passkey`, `two-factor`, `sso` with the name of the provider in `provider` and its ID in `providerId`) and a turned down password into `LOGIN_FAILED`, the `before` hook of `/sign-out` writes `LOGOUT`. A password sign-in of someone with a second factor is written by the second step. Someone a sign-in provider adds is written as `CREATE USER` with `via: "sso"`, the provider and the group it put them in, by `placeSsoUser` in `src/lib/auth/sso-guard.ts`.

Cancelling a run through `POST /api/executions/{id}/cancel` writes `UPDATE` with `action: "cancel"` and the `executionId`, as `cancelAuditEntries` in `src/services/history/run-cancel.ts` lays it out: on the job for a run of a job, and on `BACKUP` with the `name` of what the run is of (`subjectOf`, the database of a shared one, else the archive or the server) for a run without a job, like a restore. A customer's cancel that stopped the run of the job of the server's tenant also writes an entry on that job into the log of that tenant, without the API key of the customer.

The checks of a backup against its checksums, `POST /api/storage/{id}/verify`, `verify-async` and `/api/storage/verify-copies`, write `EXECUTE BACKUP` with `action: "verify"`, the backup from `backupAuditDetails` and the `status` or the `executionId`, one entry per copy. `describeEntry` reads it as "Checked" and the backup. They refuse All tenants, since a check keeps its result in the `.meta.json` of the copy.

### Details

The Audit log tab turns an entry into a sentence with `describeEntry` in `src/lib/core/audit-sentence.ts`, and what changed into rows with `changesOf` in `src/lib/core/audit-changes.ts`. Write details they read:

| Key | Holds |
| :--- | :--- |
| `name` | The display name of the record. Every create, change and delete names it, so read it before a delete |
| `file`, `destination`, `job` | A backup: its path, the destination name, the job name |
| `changes` | `AuditChange[]` from `diffFields` in `src/lib/core/audit-diff.ts`: each field before and after as a person reads it |
| `renamedFrom`, `clonedFromName` | The old name, the name of the original |
| `added`, `removed`, `areas` | Permissions of a group or an API key, and the level of each area before and after |
| `action` | A variant, like `restore`, `download`, `download_link_created`, `lock`, `cancel`, `verify`, `rotate`, `config_restore`, `audit_export`, `trash_restore` and `trash_purge` for Recently deleted |
| `permanently` | For a delete that skipped Recently deleted |
| `originalName` | For a restore from Recently deleted under another name, the name it had |
| `area` | For `UPDATE SYSTEM`: the settings part a person sees, like `Data retention` |
| `enabled` | For an enable or disable |
| `bulk`, `requested`, `succeeded`, `failed` | For a bulk action |

A secret never goes into the details with its value. Mark its field with `secret: true` in `diffFields`, and the entry keeps only that it changed.

## Reading the Log

`src/services/audit/` builds the Audit log tab of Users & Groups:

| File | Does |
| :--- | :--- |
| `audit-query.ts` | `buildAuditWhere(filter, now, omit?)`: who, area, action, quick filter, period or a day range, one record, search |
| `audit-rows.ts` | An entry as a row: its author, its sentence, the device, and whether a sign-in came from a new network |
| `audit-list-service.ts` | A page of rows, the counts beside every filter, the options of the Who filter and the numbers of the last 30 days |
| `audit-details.ts` | The panel of one entry: its changes, the sign-in it came from, the entries of the same record, the session of a sign-in |
| `audit-timeline.ts` | Entries per person and API key and day, the days cut in the time zone of the viewer |
| `audit-export.ts` | The filtered entries as CSV, at most 50,000, with cells that start like a formula quoted |

A sign-in counts as from a new place when the person signed in before, but never from its network: the first three parts of an IPv4 address or the first half of an IPv6 address.

`originShown(record)` in `audit-rows.ts` decides whether a tenant sees where an entry came from. In a customer's tenant the address and the browser of someone who is no member there, like a platform admin or someone of a platform group, stay empty in the rows, the panel and the CSV export. An entry of no person, without `userId` and `actorName`, like a failed sign-in, shows them. A deleted account keeps only its `actorName`, and with its memberships gone nothing tells whether it worked in the tenant, so a customer's log hides its origin too. The home tenant sees every one.

The search matches an address only where the row shows it, through `addressShownWhere(viewerTenantId)` in `audit-query.ts`: in a tenant the entries of the home tenant, those of no person and those of its own members, in All tenants only the entries of the home tenant and those of no person, since a query cannot compare the person with the tenant of each row. In a tenant the email of a person matches only in the same entries, so the email of someone of the platform cannot be guessed letter by letter there, while All tenants, a view of the platform, matches every email. `listAudit`, `getAuditFacets`, `getAuditTimeline` and `auditCsv` set `viewerTenantId` from `currentTenantId()`, never from the query.

The log of the home tenant is the log of the platform, with the sign-ins, sign-outs and failed sign-ins of every account. Someone whose platform group reaches some tenants only reads there the entries of the accounts of those tenants, an account of no tenant counting as one of the home tenant (`membersOfAny`), their own and those of no person, but a failed sign-in of an account beyond the reach, which names the account by `resourceId`. An entry of a deleted account, which kept only its name, stays hidden from them. Of these they read only the entries about tenants of the reach: an entry of `resource` TENANT whose `resourceId` is beyond it, and an entry whose details name only tenants beyond it by `tenantId` (found as `"tenantId":"<id>"` in the JSON), stay hidden whoever acted. `logViewOf(ctx)` in `src/services/audit/log-reach.ts` reads the reach once per request, and every reader of the log takes its `LogView`: the list, its counts, the Who options and the numbers, whose caches are kept by `view.key`, the timeline, the panel of an entry with the entries around it, the CSV export, the activity of the panel of a user (`getUserDetails`), `originShown` and the pictures of `maySeePicture`. The notification log of the home tenant follows the same view with `notificationLogVisibleWhere`: its rows do not name the tenant of the records a message of the platform is about, so such a reader sees the messages of runs of the home tenant and those that concern no tenant at all. The notice of a failed integrity check names the other tenants with copies that failed, so `notificationShownTo` gives such a reader only how many under Other tenants, without the mail and the payload that went out. A platform admin, a platform group of all tenants and a member of the home tenant without a platform group read all of it.

## API Endpoints

All need `audit:read` and read the log of the tenant of the request.

| Route | Returns |
| :--- | :--- |
| `GET /api/audit` | One page of rows with the counts of every filter, the Who options and the numbers of the last 30 days |
| `GET /api/audit/{id}` | The panel of one entry, 404 once the log no longer keeps it |
| `GET /api/audit/timeline?start=&end=&tz=` | Entries per person and day, at most 93 days |
| `GET /api/audit/export` | The filtered entries as CSV. The export writes an entry of its own |

The filters are query parameters shared by all four: `who` (repeatable, `user:<id>`, `key:<id>`, `deleted:<name>` or `unknown`), `area` and `action` (repeatable), `quick` (`all`, `changes`, `signins`, `sensitive`), `period` (`24h`, `7d`, `30d`, `90d`, `all`), `search`, `record` (`<RESOURCE>:<id>`), and `fromDay`, `toDay` with `tz` for a range of days. The list takes `page` and `pageSize` too.

## Retention Policy

Old entries are removed by `auditService.cleanOldLogs(retentionDays)` based on the system setting `audit.retentionDays` (default 90 days, **Audit log** under Settings → Data retention). It runs as part of the "Clean old data" system task, together with the other data retention settings, for every tenant at once.
