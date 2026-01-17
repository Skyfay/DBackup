# Permission System (RBAC) Documentation

This document outlines the implementation of the Role-Based Access Control (RBAC) system in the **Database Backup Manager**. The system allows administrators to control access to specific features by assigning users to groups with defined permissions.

## 1. Architecture Overview

 The permission system revolves around **Users** and **Groups**.
*   **Permissions** are granular strings (e.g., `users:read`, `backups:execute`).
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
  // ...
} as const;
```

### Access Control Logic (`src/lib/access-control.ts`)
This file contains the helper functions to verify permissions on both the server (Backend) and during page rendering.

*   `checkPermission(permission: Permission)`:
    *   Fetches the current session and user from the database (including the Group).
    *   Throws an error if the user is not authenticated.
    *   Throws an error if the user has no group.
    *   Throws an error if the group does not contain the required permission.
    *   **Usage**: Primarily in Server Actions.

*   `hasPermission(permission: Permission)`:
    *   Returns `boolean`.
    *   **Usage**: For internal logic where throwing is not desired.

*   `getUserPermissions()`:
    *   Returns `string[]` of all permissions the current user possesses.
    *   **Usage**: In Server Components (Pages) to pass down flags to Client Components.

## 4. Implementation Guide

### Backend: Protecting Server Actions
All Server Actions modifying data MUST utilize `checkPermission`.

**Example:**
```typescript
// src/app/actions/some-feature.ts
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export async function deleteSomething() {
    // 1. Guard
    await checkPermission(PERMISSIONS.SOME_FEATURE.WRITE);

    // 2. Logic
    // ...
}
```

### Frontend: Conditional Rendering
To hide UI elements (buttons, links) for unauthorized users, fetch permissions in the **Page (Server Component)** and pass boolean flags to **Client Components**.

**Example (Page):**
```typescript
// src/app/some-page/page.tsx
export default async function Page() {
    const permissions = await getUserPermissions();
    const canEdit = permissions.includes(PERMISSIONS.SOME_FEATURE.WRITE);

    return <SomeComponent canEdit={canEdit} />;
}
```

**Example (Component):**
```typescript
// src/components/some-component.tsx
export function SomeComponent({ canEdit }: { canEdit: boolean }) {
    return (
        <div>
            {canEdit && <button>Edit</button>}
        </div>
    );
}
```

## 5. Adding New Permissions

To introduce a new feature with access control:

1.  **Define Permission**: Add keys to `PERMISSIONS` object in `src/lib/permissions.ts`.
2.  **Add to UI List**: Add the permission to `AVAILABLE_PERMISSIONS` array in `src/lib/permissions.ts` (adds it to the Group creation form).
3.  **Protect Actions**: Add `checkPermission(...)` to your detailed Server Actions.
4.  **Update UI**: Implement conditional rendering in your React components.
