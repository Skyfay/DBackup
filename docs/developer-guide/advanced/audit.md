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
- A change of an account, the own one included, its password, second factor, sessions, name, email, dates, preferences, picture, sign-in accounts or its delete, names its log with `accountLogOrigin(viewer, userIds)` from `src/services/audit/account-log.ts`, read before the change, since a delete ends the memberships. The tenant the viewer works in keeps the entry while every account is one of its people (`membershipService.isPersonOf`), anything else, a change made in All tenants included, goes into the home tenant with `PLATFORM_LOG`. So a customer never reads what someone did to an account of another tenant, nor what someone of the platform changed of their own account while working there. The actions in `user.ts`, `user-security.ts`, `profile.ts` and `sso-connections.ts`, the route of the own picture `api/user/avatar` and the hook of a link `recordSsoLink` (`src/lib/auth/sso-link-audit.ts`, which writes `SSO account connected` for a provider linked while its account is signed in, whichever page started it) pass it, `togglePasskeyTwoFactor` among them, which writes `UPDATE USER` with the change `Passkey as second factor`. The restore of a deleted account from Recently deleted, Undo included, writes into the tenant the viewer works in only while the account waited there, else with `PLATFORM_LOG` (`recordRestored` in `actions/settings/trash.ts`).
- What someone read of a source in the Database Explorer, `EXPORT SOURCE` with `action: "table_list"` or `"table_data"` from `database-tables` and `database-table-data`, goes into the log of the tenant of the source, read with `connectionPlace` in `src/services/audit/record-names.ts` and passed as the last argument of `logFor`. In All tenants no tenant runs, so the entry would land in the log of the home tenant otherwise.
- A look at a saved record through `logProbe` or `auditedProbe` (`folder_browse` of `adapters/[id]/browse`, `volume_list`, `volume_sizes`, `path_check`, `storage_check` of one destination and `token_check`) and a read of the databases of a saved source through `logDatabasesRead` (`databases_read`) go into the log of the tenant of that record the same way, with `connectionPlace` for a connection and `credentialPlace` for the saved login of a `token_check`. A look from a form names no record and stays in the log of the code that runs. Inside a tenant the record is one of its own, so nothing changes there.

Sign-ins, failed sign-ins and sign-outs are written by the server around the endpoints of better-auth, in `src/lib/auth/sign-in-audit.ts`: the `after` hook turns a new session into `LOGIN` with its method (`password`, `passkey`, `two-factor`, `sso` with the name of the provider in `provider` and its ID in `providerId`) and a turned down password into `LOGIN_FAILED`, the `before` hook of `/sign-out` writes `LOGOUT`. A password sign-in of someone with a second factor is written by the second step, and a code of the second factor with a session, which finishes its setup, signs nobody in. The changes of the own second factor and passkeys that the browser makes through better-auth are written by the same hooks in `src/lib/auth/security-audit.ts` once the endpoint succeeded, as `UPDATE USER` with `change` from `SECURITY_CHANGES` in `src/lib/core/audit-types.ts` (the app set up, the second factor on and off, the app removed while a passkey stays the second factor, new backup codes, a passkey added, renamed with `changes` or deleted, its name in `passkey`), and so are the own sessions it ends through `/revoke-session`, `/revoke-other-sessions` and `/revoke-sessions` (one session, every other one or every one, how many in `sessions`, nothing for a token of no session of the account), into the log `accountLogOrigin` picks for the tenant the session works in. Someone a sign-in provider adds is written as `CREATE USER` with `via: "sso"`, the provider and the group it put them in, by `placeSsoUser` in `src/lib/auth/sso-guard.ts`.

Cancelling a run through `POST /api/executions/{id}/cancel` writes `UPDATE` with `action: "cancel"` and the `executionId`, as `cancelAuditEntries` in `src/services/history/run-cancel.ts` lays it out: on the job for a run of a job, and on `BACKUP` with the `name` of what the run is of (`subjectOf`, the database of a shared one, else the archive or the server) for a run without a job, like a restore. A customer's cancel that stopped the run of the job of the server's tenant also writes an entry on that job into the log of that tenant, without the API key of the customer.

The checks of a backup against its checksums, `POST /api/storage/{id}/verify`, `verify-async` and `/api/storage/verify-copies`, write `EXECUTE BACKUP` with `action: "verify"`, the backup from `backupAuditDetails` and the `status` or the `executionId`, one entry per copy. `describeEntry` reads it as "Checked" and the backup. They refuse All tenants, since a check keeps its result in the `.meta.json` of the copy.

### Details

The pinned SSH host key of a connection writes `UPDATE ADAPTER` with `action: "ssh-host-key.pin"`, `"ssh-host-key.accept"` or `"ssh-host-key.forget"`, and `EXECUTE ADAPTER` with `"ssh-host-key.mismatch"` for a server that presented another key, once per changed key and not once per health check. The details hold `host`, `port` and the fingerprints (`fingerprint`, `previous`, `expected`, `presented`), all public values. A pin of a first connect and a mismatch of a run or a health check name no user.

The Audit log tab turns an entry into a sentence with `describeEntry` in `src/lib/core/audit-sentence.ts`, and what changed into rows with `changesOf` in `src/lib/core/audit-changes.ts`. Write details they read:

| Key | Holds |
| :--- | :--- |
| `name` | The display name of the record. Every create, change and delete names it, so read it before a delete |
| `file`, `destination`, `job` | A backup: its path, the destination name, the job name |
| `changes` | `AuditChange[]` from `diffFields` in `src/lib/core/audit-diff.ts`: each field before and after as a person reads it |
| `renamedFrom`, `clonedFromName` | The old name, the name of the original |
| `added`, `removed`, `areas` | Permissions of a group or an API key, and the level of each area before and after |
| `action` | A variant, like `restore`, `download`, `download_link_created`, `lock`, `cancel`, `verify`, `rotate`, `config_restore`, `audit_export`, `trash_restore` and `trash_purge` for Recently deleted, `notification_test` for a test notification of an event, `recipients_test` for one to the own recipients of a shared channel, `connection_test` for a test of a connection with `adapter` and `success`, `ssh_test` for a test of an SSH login of a form with `adapter`, `host` and `success`, `folder_browse` for a list of the folders of a server a picker or a connection form took (`browse-location`, `system/filesystem`, its `remote`, `dropbox`, `google-drive` and `onedrive`, and `adapters/[id]/browse` with `name` of the saved connection) with `adapter`, `host` where there is one, `local` for the server DBackup runs on and `success`, `snapshot_check` for the snapshot check of a form with `adapter`, `host` and `success`, `volume_list` and `volume_sizes` for the volumes of a saved Docker connection (`adapters/[id]/volumes` and its `sizes`) with `name` and `success`, `path_check` for the check of a folder of a restore target (`storage/[id]/check-path`) with `name`, `path` and `success`, `token_check` for the check of a saved login of a cloud drive (`adapters/*/validate-token`, an entry of the `CREDENTIAL`) with `name`, `adapter` and `success`, `storage_check` for Check now of the Storage Explorer (`storage/explorer/refresh`) with `names` of the destinations it listed, `sso_check` for the check of a sign-in provider of a dialog (`checkSsoConnection`, an entry of the `SSO_PROVIDER` in the log of the platform, only when the discovery sent a request, see `dialed`) with `adapter`, `host` of the address it read and `success`, all written once they ran through `auditedProbe` or `logProbe` in `src/services/adapters/probe-audit.ts`, `key_check` for a key tried on a backup that changed nothing in the Vault (`recoverEncryptionKeyAction`, an entry of the `VAULT`) with `file`, `destination`, `success` and `keyName` of the key of the Vault it matched, never the key, and `databases_read` for a read of the databases of the sources with `count`, and `all` when it read every source, or for one read of the databases of a server (`access-check`, `database-stats`, `adapters/[id]/databases`) with `name` of the saved source or `form` for a connection form, `adapter` and `success`, written once the read ran |
| `permanently` | For a delete that skipped Recently deleted |
| `originalName` | For a restore from Recently deleted under another name, the name it had |
| `area` | For `UPDATE SYSTEM`: the settings part a person sees, like `Data retention` |
| `enabled` | For an enable or disable |
| `group` | For a change of the group of a user (`change: "Updating Group"`), the name of the group it gave, none when it took the group |
| `bulk`, `requested`, `succeeded`, `failed`, `names` | For a bulk action, with the names of the records it changed |
| `tenantId`, `tenantIds` | The tenant an entry names, or the tenants, from `namedTenants` in `src/lib/core/audit-tenants.ts`, at the top level of the details only, see Reading the Log |

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

The log of the home tenant is the log of the platform, with the sign-ins, sign-outs and failed sign-ins of every account. Someone whose platform group reaches some tenants only reads there the entries of the accounts of those tenants, an account of no tenant counting as one of the home tenant (`membersOfAny`), their own and those of no person, but a failed sign-in of an account beyond the reach, which names the account by `resourceId`. An entry of a deleted account, which kept only its name, stays hidden from them. An entry about an account (`resource` USER), like a change of its email, names that account by `resourceId` too and shows only for an account they see, whoever made the change. Of these they read only the entries about tenants of the reach: an entry of `resource` TENANT whose `resourceId` is beyond it, an entry whose details name only tenants beyond it by `tenantId` (found as `"tenantId":"<id>"` in the JSON), and an entry whose `tenantIds` lists any tenant beyond it, stay hidden whoever acted. So an entry outside `resource` TENANT that names a tenant by its name, like `tenant` of a membership, an assignment or a backup of a shared database, `customers` of a restore over databases of customers or the tenant of a sign-in provider, carries its id beside the name, one in `tenantId` and several in `tenantIds`, which `namedTenants` in `src/lib/core/audit-tenants.ts` builds. They go at the top level of the details and nowhere else, since the filter finds `"tenantId":` anywhere in the JSON text. A list of records keeps the tenant of each under another key, like `to` of each database of an assignment batch (`logDatabasesAssigned` in `src/services/tenant/assignment-audit.ts`), whose tenants, the ones it gave to and the ones a take-back took a database from, go into `namedTenants` at the top level, so a mixed batch shows only to whoever reaches all of them. A sign-in provider of a tenant names that tenant in every entry about it, its create, edit, switch and delete and the change the delete of a group made to it (`ProviderMove.tenantId`), a provider of the platform names none and stays visible. A list is no text a query can check, so `auditVisibleWhere` reads the entries of the home tenant with `tenantIds` and keeps those whose every tenant is of the reach by their id (`listsOfReachedTenants`). An entry whose `tenantIds` is no list of ids at the top level tells no tenants and stays hidden. These lookups read the whole log of the home tenant, so `auditVisibleWhere` reads them once per `LogView`, which a request makes once, and every reader of that request shares the result. The filter hides such an entry rather than masking the names in it, since it is the one `where` the list, its counts, the timeline, the export and the panel share, so paging and counts stay right and the search of the list finds no name the reader may not read. `logViewOf(ctx)` in `src/services/audit/log-reach.ts` reads the reach once per request, and every reader of the log takes its `LogView`: the list, its counts, the Who options and the numbers, whose caches are kept by `view.key`, the timeline, the panel of an entry with the entries around it, the CSV export, the activity of the panel of a user (`getUserDetails`), `originShown` and the pictures of `maySeePicture`. The notification log of the home tenant follows the same view with `notificationLogVisibleWhere`: its rows do not name the tenant of the records a message of the platform is about, so such a reader sees the messages of runs of the home tenant and those that concern no tenant at all. The notice of a failed integrity check names the other tenants with copies that failed, so `notificationShownTo` gives such a reader only how many under Other tenants, without the mail and the payload that went out. A platform admin, a platform group of all tenants and a member of the home tenant without a platform group read all of it.

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
