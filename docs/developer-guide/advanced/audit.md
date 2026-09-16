# Audit Log System

The Audit Log system tracks significant user actions (Authentication, Resource Management, etc.) for security and compliance purposes.

## Architecture

### Database Schema

The system uses the `AuditLog` model in Prisma:

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  userId     String?  // Who performed the action (nullable for system actions)
  action     String   // What happened (e.g., CREATE, DELETE)
  resource   String   // What was affected (e.g., USER, JOB)
  resourceId String?  // ID of the affected object
  details    String?  // JSON string with additional info (diffs, metadata)
  ipAddress  String?  // Request context
  userAgent  String?  // Browser/client info
  createdAt  DateTime @default(now())

  user       User?    @relation(fields: [userId], references: [id])
}
```

### Constants

To ensure consistency, we use strict constants for Actions and Resources.

**Location**: `src/lib/core/audit-types.ts`

```typescript
export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  EXECUTE: 'EXECUTE',
  EXPORT: 'EXPORT',   // For sensitive data exports (e.g., recovery kit)
} as const;

export const AUDIT_RESOURCES = {
  AUTH: 'AUTH',
  USER: 'USER',
  GROUP: 'GROUP',
  SOURCE: 'SOURCE',
  DESTINATION: 'DESTINATION',
  JOB: 'JOB',
  SYSTEM: 'SYSTEM',
  ADAPTER: 'ADAPTER',
  VAULT: 'VAULT',       // Encryption profiles / recovery kits
  CREDENTIAL: 'CREDENTIAL', // Credential profiles
  API_KEY: 'API_KEY',   // API keys
  TEMPLATE: 'TEMPLATE', // Naming templates, schedule presets, retention policies
} as const;
```

### Service Layer

**Location**: `src/services/audit-service.ts`

The `AuditService` handles:
- Writing logs to the database (`log()`)
- Fetching paginated and filtered logs (`getLogs()`)
- Generating statistics for UI filters (`getFilterStats()`)
- Retention management (auto-delete old entries)

## Usage Guide

### Logging an Event

Log an event whenever a significant state change occurs (typically in **Server Actions** or **Services**):

```typescript
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

export async function createSource(data: SourceInput) {
  // 1. Perform Business Logic
  const newSource = await db.adapterConfig.create({ ... });

  // 2. Log the Action
  if (session?.user) {
    await auditService.log(
      session.user.id,           // userId (nullable for system actions)
      AUDIT_ACTIONS.CREATE,      // action
      AUDIT_RESOURCES.SOURCE,    // resource
      { name: newSource.name },  // details (optional, Record<string, any>)
      newSource.id,              // resourceId (optional)
    );
  }

  return newSource;
}
```

### Required Events to Log

| Action | Resource | When |
|--------|----------|------|
| LOGIN | USER | Successful authentication |
| LOGOUT | USER | Session terminated |
| CREATE | SOURCE/DESTINATION/JOB | New adapter or job created |
| UPDATE | SOURCE/DESTINATION/JOB | Configuration modified |
| DELETE | SOURCE/DESTINATION/JOB | Resource removed |
| EXECUTE | EXECUTION | Backup job triggered |
| RESTORE | EXECUTION | Database restored |
| CREATE/UPDATE/DELETE | USER | User management |
| CREATE/UPDATE/DELETE | GROUP | Permission group changes |

### Self-Service Actions

When a user performs an action on their own account (e.g., password change), tag it appropriately:

```typescript
await auditService.log(
  userId,
  AUDIT_ACTIONS.UPDATE,
  AUDIT_RESOURCES.USER,
  { field: 'password', selfService: true }, // details
  userId,                                   // resourceId
);
```

## Retention Policy

Old entries are removed by `auditService.cleanOldLogs(retentionDays)` based on the system setting `audit.retentionDays` (default 90 days, **Audit Log** under Settings → General → Data Retention).

This runs as part of the "Clean Old Data" system task (`system.clean_audit_logs`), together with the other data retention settings.

## API Endpoints

### Get Audit Logs

```http
GET /api/audit?page=1&limit=20&action=CREATE&resource=JOB
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |
| `action` | string | Filter by action type |
| `resource` | string | Filter by resource type |
| `userId` | string | Filter by user |
| `startDate` | string | Filter from date (ISO) |
| `endDate` | string | Filter to date (ISO) |

### Get Filter Statistics

```http
GET /api/audit/stats
```

Returns counts grouped by action and resource for building filter dropdowns.
