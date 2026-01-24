# Audit Log System Plan

This document outlines the implementation plan for the **User Audit Log** feature. The goal is to track significant user actions (Authentication, Resource Management) and display them in a searchable table within the "Users & Groups" dashboard.

## 1. Database & Schema Design

We need a dedicated model to store audit events.

### Prisma Schema (`prisma/schema.prisma`)

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  userId      String?  // Nullable because some actions might be system actions or deleted users
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  action      String   // ENUM-like string: "LOGIN", "CREATE", "UPDATE", "DELETE"
  resource    String   // ENUM-like string: "USER", "JOB", "SOURCE", "DESTINATION", "SETTINGS"
  resourceId  String?  // The ID of the affected object

  details     String?  // JSON string storing changes (diff) or connection info
  ipAddress   String?
  userAgent   String?

  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([resource])
  @@index([createdAt])
}
```

## 2. Shared Types (`src/lib/core/audit-types.ts`)

Define consistent constants to avoid magic strings.

```typescript
export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  EXECUTE: "EXECUTE", // For running jobs manually
} as const;

export const AUDIT_RESOURCES = {
  AUTH: "AUTH",
  USER: "USER",
  GROUP: "GROUP",
  SOURCE: "SOURCE",
  DESTINATION: "DESTINATION",
  JOB: "JOB",
  SYSTEM: "SYSTEM",
} as const;
```

## 3. Core Logic (`src/services/audit-service.ts`)

A centralized service to handle logging. This ensures we can swap the backend (e.g., to a file stream) later if DB becomes too heavy.

**Functions:**
*   `log(userId: string, action: string, resource: string, details?: object)`: Creating a log entry.
*   `getLogs(filter: AuditLogFilter)`: Fetching paginated logs for the UI.
*   `cleanOldLogs(retentionDays: number)`: Maintenance task.

## 4. Permissions (`src/lib/permissions.ts`)

We need to protect the audit log view.

*   Add `AUDIT: { READ: "audit:read" }` to `PERMISSIONS`.
*   Add the permission to the `SuperAdmin` group via migration script.

## 5. Integration Points (Backend)

We need to "hook" into existing actions to trigger logs.

| Action | File | Service/Function | Notes |
| :--- | :--- | :--- | :--- |
| **Login** | `src/lib/auth.ts` | Better-Auth Hooks | Use `onSession` or similar callbacks if available, otherwise log in server action. |
| **User Create** | `src/app/actions/user.ts` | `createUser` | Log after success. |
| **User Delete** | `src/app/actions/user.ts` | `deleteUser` | Log with ID. |
| **Adapter Create** | `src/app/actions/adapter.ts` | `createAdapter` | |
| **Job Update** | `src/app/actions/job.ts` | `updateJob` | Capture changed fields if possible. |

## 6. Frontend Implementation

### UI Components
1.  **`src/components/audit/audit-table.ts`**: A robust `DataTable` component.
    *   Columns: `Actor` (User Avatar/Name), `Action` (Badge), `Resource`, `Details` (JSON Viewer in Popover), `Date`.
2.  **`src/app/dashboard/users/page.tsx`**: Add a new Tab "Audit Logs".

### API / Server Actions
*   `src/app/actions/audit.ts`:
    *   `getAuditLogs({ page, limit, resourceFilter })`: Server action to fetch data securely.

## 7. Implementation Roadmap

### Phase 1: Foundation (Type Safety & Database)
- [ ] Modify `prisma/schema.prisma` to add `AuditLog`.
- [ ] Run `npx prisma migrate dev --name init_audit_log`.
- [ ] Create `src/lib/core/audit-types.ts`.
- [ ] Update `src/lib/permissions.ts` with `audit:read`.
- [ ] Update `scripts/update_perms.js` to assign `audit:read` to Admins.

### Phase 2: Service Layer
- [ ] Create `src/services/audit-service.ts` with `log` and `getLogs`.
- [ ] Create Server Action `src/app/actions/audit.ts` exposing `getLogs`.

### Phase 3: Integration (Logging Events)
- [ ] Instrument `src/app/actions/user.ts` (Create/Update/Delete).
- [ ] Instrument `src/app/actions/group.ts`.
- [ ] Instrument Adapter creation/deletion.
- [ ] (Optional) Instrument Login flow (requires checking Better-Auth capabilities or modifying login action).

### Phase 4: Frontend
- [ ] Create `AuditTable` component (`src/components/audit/...`).
- [ ] Add "Audit" Tab to `src/app/dashboard/users/page.tsx`.
- [ ] Implement filtering (by Action, by User).

### Phase 5: Cleanup & Testing
- [ ] Manual test: Create a user -> Check Audit Log.
- [ ] Manual test: Delete a job -> Check Audit Log.
- [ ] Verify `audit:read` permission works (Regular user cannot see tab).
