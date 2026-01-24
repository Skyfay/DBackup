# Audit Log System Documentation

This document describes the implemented User Audit Log system, which tracks significant user actions (Authentication, Resource Management, etc.) for security and compliance.

## 1. Architecture

### Database Schema
The system uses the `AuditLog` model in Prisma (`prisma/schema.prisma`). It stores:
*   `userId`: Who performed the action (nullable for system actions).
*   `action`: What happened (e.g., `CREATE`, `DELETE`).
*   `resource`: What was affected (e.g., `USER`, `JOB`).
*   `resourceId`: ID of the affected object.
*   `details`: JSON string with additional info (diffs, metadata).
*   `ipAddress` / `userAgent`: Request context.

### Constants (`src/lib/core/audit-types.ts`)
To ensure consistency, we use strict constants for Actions and Resources.

```typescript
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

// AUDIT_ACTIONS: LOGIN, CREATE, UPDATE, DELETE, EXECUTE...
// AUDIT_RESOURCES: USER, JOB, SOURCE, DESTINATION, SYSTEM...
```

### Service Layer (`src/services/audit-service.ts`)
The `AuditService` handles the logic for:
*   Writing logs to the database (`log()`).
*   Fetching paginated and filtered logs (`getLogs()`).
*   Generating statistics for UI filters (`getFilterStats()`).

## 2. Usage Guide

### Logging an Event
You should log an event whenever a significant state change occurs (typically in **Server Actions** or **Services**).

```typescript
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

// Example: Inside a Server Action
export async function createThing(data: any) {
    // 1. Perform Business Logic
    const newThing = await db.create(...);

    // 2. Log Action
    // Ensure you have the user session/ID available
    if (session?.user) {
        await auditService.log(
            session.user.id,                // Actor (User ID)
            AUDIT_ACTIONS.CREATE,           // Action
            AUDIT_RESOURCES.JOB,            // Resource Category
            { name: newThing.name },        // Details (stored as JSON)
            newThing.id                     // Resource ID (Optional but recommended)
        );
    }
}
```

### Viewing Logs
*   **UI**: The Audit Log is accessible in the Dashboard under **Users & Groups** -> **Audit Logs** tab.
*   **Permission**: Users need `audit:read` permission to view this tab or fetch logs via the API.

## 3. Implementation Details

*   **Frontend**: `src/components/audit/audit-table.tsx` provides a data table with server-side pagination and filtering.
*   **Server Actions**: `src/app/actions/audit.ts` exposes the data fetching logic securely (checking permissions).
*   **Automated Login Logging**: Successful logins are automatically logged via `src/app/actions/audit-log.ts` called from the authentication flow.
