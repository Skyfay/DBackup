# Permission System (RBAC) Documentation

This document outlines the implementation of the Role-Based Access Control (RBAC) system in the **Database Backup Manager**. The system allows administrators to control access to specific features by assigning users to groups with defined permissions.

## 1. Architecture Overview

The permission system revolves around **Users** and **Groups**.
*   **Permissions** are granular strings (e.g., `sources:read`, `jobs:execute`).
*   **Groups** contain a list of permissions (stored as a JSON array).
*   **Users** are assigned to exactly one **Group** (or no group).
*   If a user has no group, they have **no permissions** by default (restricted access).

## 2. Database Schema

The implementation builds upon the Prisma schema defined in `prisma/schema.prisma`.

### Models

*   **Group**:
    *   `id`: UUID
    *   `name`: Unique name (e.g., "Admin", "Viewer")
    *   `permissions`: String (JSON Array of permission IDs)
*   **User**:
    *   `groupId`: Foreign key to `Group` (Nullable).

```prisma
model User {
  // ...
  groupId String?
  group   Group?  @relation(fields: [groupId], references: [id])
}

model Group {
  id          String   @id @default(uuid())
  name        String   @unique
  permissions String // Stored as JSON e.g. ["users:read", "jobs:write"]
  // ...
}
```

## 3. Core Logic & Files

### Definitions (`src/lib/permissions.ts`)
All available permissions are strictly typed and defined here. This is the source of truth.

```typescript
export const PERMISSIONS = {
  USERS: { READ: "users:read", WRITE: "users:write" },
  GROUPS: { READ: "groups:read", WRITE: "groups:write" },
  SOURCES: { READ: "sources:read", WRITE: "sources:write" },
  DESTINATIONS: { READ: "destinations:read", WRITE: "destinations:write" },
  JOBS: { READ: "jobs:read", WRITE: "jobs:write", EXECUTE: "jobs:execute" },
  STORAGE: {
    READ: "storage:read",
    DOWNLOAD: "storage:download",
    RESTORE: "storage:restore",
    DELETE: "storage:delete"
  },
  HISTORY: { READ: "history:read" },
  NOTIFICATIONS: { READ: "notifications:read", WRITE: "notifications:write" },
} as const;
```

### Access Control Logic (`src/lib/access-control.ts`)
This file contains the helper functions to verify permissions on both the server (Backend) and during page rendering.

*   `checkPermission(permission: Permission)`:
    *   Fetches the current session and user from the database.
    *   Throws an error if the user is not authenticated or lacks the permission.
    *   **Usage**: Primarily in Server Actions.

*   `hasPermission(permission: Permission)`:
    *   Returns `boolean`.
    *   **Usage**: For internal logic where throwing is not desired.

*   `getUserPermissions()`:
    *   Returns `string[]` of all permissions the current user possesses.
    *   **Usage**: In Server Components (Pages) to pass down flags to Client Components.

## 4. Permission Reference

### Users & Groups
*   `users:read`: View user list and details.
*   `users:write`: Create, invite, delete users.
*   `groups:read`: View groups and their assigned permissions.
*   `groups:write`: Create, edit, delete groups.

### Resources (Sources / Destinations)
*   `sources:read`: View configured database sources.
*   `sources:write`: Add, edit, remove database sources.
*   `destinations:read`: View configured backup destinations.
*   `destinations:write`: Add, edit, remove backup destinations.

### Jobs
*   `jobs:read`: View scheduled jobs.
*   `jobs:write`: Create, edit, delete backup jobs.
*   `jobs:execute`: Manually trigger a job run immediately.

### Storage & History
*   `storage:read`: Access the Storage Explorer file browser.
*   `storage:download`: Download backup files to local machine.
*   `storage:restore`: Trigger a database restore from a backup file.
*   `storage:delete`: Delete backup files from storage.
*   `history:read`: View the execution log/history of jobs.

### Notifications
*   `notifications:read`: Access the notifications center.
*   `notifications:write`: Manage notification settings or mark as read (if applicable).

## 5. Implementation Guide

### Backend: Protecting Server Actions
All Server Actions modifying data MUST utilize `checkPermission`.

**Example:**
```typescript
// src/app/actions/source.ts
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export async function deleteSource() {
    // 1. Guard
    await checkPermission(PERMISSIONS.SOURCES.WRITE);

    // 2. Logic
    // ...
}
```

### Frontend: Conditional Rendering
To hide UI elements (buttons, links) for unauthorized users, fetch permissions in the **Page (Server Component)** and pass boolean flags to **Client Components**.

**Example (Page):**
```typescript
// src/app/dashboard/sources/page.tsx
import { AdapterManager } from "@/components/adapter-manager";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export default async function Page() {
    const permissions = await getUserPermissions();
    const canManage = permissions.includes(PERMISSIONS.SOURCES.WRITE);

    return (
        <AdapterManager
            type="database"
            title="Sources"
            canManage={canManage}
        />
    );
}
```

### Complex Pages (Server/Client Split)
For complex pages like **Jobs** or **Storage**, we split the logic into a Server Page (fetching permissions) and a Client Component (UI logic).

**Example pattern:**
1. `src/app/dashboard/jobs/page.tsx` (Server): Fetches `canManage`, `canExecute`.
2. `src/app/dashboard/jobs/jobs-client.tsx` (Client): Receives props and handles UI state.

### Auto-Promotion (First User)
The first user registered in the system is automatically assigned to a "SuperAdmin" group containing ALL permissions.

### SuperAdmin Safeguards
1.  **Group Deletion**: The `"SuperAdmin"` group cannot be deleted.
2.  **User Deletion**: You cannot delete the last user in the SuperAdmin group.
