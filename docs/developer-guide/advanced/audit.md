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
  ipAddress   String?  // From X-Forwarded-For or X-Real-IP
  userAgent   String?
  createdAt   DateTime @default(now())
}
```

### Constants

`src/lib/core/audit-types.ts` holds `AUDIT_ACTIONS` (`LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `CREATE`, `UPDATE`, `DELETE`, `EXECUTE`, `RESTORE`, `EXPORT`) and `AUDIT_RESOURCES` (`AUTH`, `USER`, `GROUP`, `JOB`, `BACKUP`, `ADAPTER`, `VAULT`, `CREDENTIAL`, `API_KEY`, `TEMPLATE`, `SYSTEM`, `SSO_PROVIDER`, plus `SOURCE` and `DESTINATION` from before). `src/lib/core/audit-areas.ts` groups the resources into the areas of the Area filter and the actions into the quick filters. `EXPORT` and `RESTORE` count as sensitive.

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

Sign-ins, failed sign-ins and sign-outs are written by the server around the endpoints of better-auth, in `src/lib/auth/sign-in-audit.ts`: the `after` hook turns a new session into `LOGIN` with its method (`password`, `passkey`, `two-factor`, `sso` with the name of the provider in `provider` and its ID in `providerId`) and a turned down password into `LOGIN_FAILED`, the `before` hook of `/sign-out` writes `LOGOUT`. A password sign-in of someone with a second factor is written by the second step. Someone a sign-in provider adds is written as `CREATE USER` with `via: "sso"`, the provider and the group it put them in, by `placeSsoUser` in `src/lib/auth/sso-guard.ts`.

### Details

The Audit log tab turns an entry into a sentence with `describeEntry` in `src/lib/core/audit-sentence.ts`, and what changed into rows with `changesOf` in `src/lib/core/audit-changes.ts`. Write details they read:

| Key | Holds |
| :--- | :--- |
| `name` | The display name of the record. Every create, change and delete names it, so read it before a delete |
| `file`, `destination`, `job` | A backup: its path, the destination name, the job name |
| `changes` | `AuditChange[]` from `diffFields` in `src/lib/core/audit-diff.ts`: each field before and after as a person reads it |
| `renamedFrom`, `clonedFromName` | The old name, the name of the original |
| `added`, `removed`, `areas` | Permissions of a group or an API key, and the level of each area before and after |
| `action` | A variant, like `restore`, `download`, `download_link_created`, `lock`, `cancel`, `rotate`, `config_restore`, `audit_export` |
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

## API Endpoints

All need `audit:read`.

| Route | Returns |
| :--- | :--- |
| `GET /api/audit` | One page of rows with the counts of every filter, the Who options and the numbers of the last 30 days |
| `GET /api/audit/{id}` | The panel of one entry, 404 once the log no longer keeps it |
| `GET /api/audit/timeline?start=&end=&tz=` | Entries per person and day, at most 93 days |
| `GET /api/audit/export` | The filtered entries as CSV. The export writes an entry of its own |

The filters are query parameters shared by all four: `who` (repeatable, `user:<id>`, `key:<id>`, `deleted:<name>` or `unknown`), `area` and `action` (repeatable), `quick` (`all`, `changes`, `signins`, `sensitive`), `period` (`24h`, `7d`, `30d`, `90d`, `all`), `search`, `record` (`<RESOURCE>:<id>`), and `fromDay`, `toDay` with `tz` for a range of days. The list takes `page` and `pageSize` too.

## Retention Policy

Old entries are removed by `auditService.cleanOldLogs(retentionDays)` based on the system setting `audit.retentionDays` (default 90 days, **Audit log** under Settings → Data retention). It runs as part of the "Clean old data" system task, together with the other data retention settings.
