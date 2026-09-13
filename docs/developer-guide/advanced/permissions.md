# Permission System (RBAC)

DBackup implements Role-Based Access Control (RBAC) to control feature access through user groups with defined permissions.

## Architecture

```
┌─────────────┐
│    User     │
│             │
│  groupId ───┼──────────────┐
└─────────────┘              │
                             ▼
                    ┌─────────────────┐
                    │      Group      │
                    │                 │
                    │  permissions[]  │
                    │  - users:read   │
                    │  - jobs:write   │
                    │  - ...          │
                    └─────────────────┘
```

**Key Concepts:**

- **Permissions**: Granular strings (e.g., `sources:read`, `jobs:execute`)
- **Groups**: Contain a list of permissions
- **Users**: Assigned to exactly one group (or none)
- **No Group = No Access**: Users without a group have no permissions

## Database Schema

```prisma
model User {
  id        String   @id  // Set by auth system
  name      String
  email     String   @unique
  // ...
  groupId   String?
  group     Group?   @relation(fields: [groupId], references: [id])
}

model Group {
  id          String   @id @default(uuid())
  name        String   @unique
  permissions String   // JSON array: ["users:read", "jobs:write"]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  users       User[]
}
```

## Permission Definitions

All permissions are defined in `src/lib/auth/permissions.ts`:

```typescript
export const PERMISSIONS = {
  USERS:        { READ: "users:read", WRITE: "users:write" },
  GROUPS:       { READ: "groups:read", WRITE: "groups:write" },
  SOURCES:      { VIEW: "sources:view", READ: "sources:read", WRITE: "sources:write" },
  DESTINATIONS: { READ: "destinations:read", WRITE: "destinations:write" },
  JOBS:         { READ: "jobs:read", WRITE: "jobs:write", EXECUTE: "jobs:execute" },
  STORAGE:      { READ: "storage:read", DOWNLOAD: "storage:download", RESTORE: "storage:restore", DELETE: "storage:delete" },
  HISTORY:      { READ: "history:read" },
  DASHBOARD:    { READ: "dashboard:read" },
  AUDIT:        { READ: "audit:read" },
  NOTIFICATIONS:{ READ: "notifications:read", WRITE: "notifications:write" },
  VAULT:        { READ: "vault:read", WRITE: "vault:write" },
  CREDENTIALS:  { READ: "credentials:read", WRITE: "credentials:write", DELETE: "credentials:delete", REVEAL: "credentials:reveal" },
  PROFILE:      { UPDATE_NAME: "profile:update_name", UPDATE_EMAIL: "profile:update_email", UPDATE_PASSWORD: "profile:update_password", MANAGE_2FA: "profile:manage_2fa", MANAGE_PASSKEYS: "profile:manage_passkeys" },
  SETTINGS:     { READ: "settings:read", WRITE: "settings:write" },
  API_KEYS:     { READ: "api-keys:read", WRITE: "api-keys:write" },
  TEMPLATES:    { READ: "templates:read", WRITE: "templates:write" },
} as const;

export type Permission = /* union of all leaf string values */;
```

### AVAILABLE_PERMISSIONS

`AVAILABLE_PERMISSIONS` is a flat array exported from `src/lib/auth/permissions.ts`. It is the canonical list used to populate the group editor UI. Each entry has `{ id, label, category }`.

This array is also used for SuperAdmin expansion — if code needs to grant all permissions, it maps over `AVAILABLE_PERMISSIONS` rather than hard-coding permission strings.

## Access Control Functions

Located in `src/lib/auth/access-control.ts`:

### checkPermission()

Throws an error if the user lacks permission:

```typescript
export async function checkPermission(permission: Permission): Promise<void> {
  const session = await auth.getSession();

  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { group: true },
  });

  if (!user?.group) {
    throw new Error("No group assigned");
  }

  const permissions = JSON.parse(user.group.permissions) as string[];

  if (!permissions.includes(permission)) {
    throw new Error(`Missing permission: ${permission}`);
  }
}
```

### hasPermission()

Returns boolean (non-throwing):

```typescript
export async function hasPermission(permission: Permission): Promise<boolean> {
  try {
    await checkPermission(permission);
    return true;
  } catch {
    return false;
  }
}
```

### getUserPermissions()

Returns all user permissions:

```typescript
export async function getUserPermissions(): Promise<string[]> {
  const session = await auth.getSession();

  if (!session?.user) return [];

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { group: true },
  });

  if (!user?.group) return [];

  return JSON.parse(user.group.permissions);
}
```

## Implementation Guide

### Protecting Server Actions

**Every data-modifying Server Action MUST check permissions:**

```typescript
// src/app/actions/source.ts
"use server";

import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function createSource(data: SourceInput) {
  // 1. Permission check (throws if denied)
  await checkPermission(PERMISSIONS.SOURCES.WRITE);

  // 2. Validation
  const validated = SourceSchema.parse(data);

  // 3. Business logic
  return SourceService.create(validated);
}

export async function deleteSource(id: string) {
  await checkPermission(PERMISSIONS.SOURCES.WRITE);
  return SourceService.delete(id);
}

export async function getSources() {
  await checkPermission(PERMISSIONS.SOURCES.READ);
  return SourceService.getAll();
}
```

### Protecting Page Access

```typescript
// src/app/dashboard/sources/page.tsx
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export default async function SourcesPage() {
  // Redirect if no access
  if (!await hasPermission(PERMISSIONS.SOURCES.READ)) {
    redirect("/dashboard/unauthorized");
  }

  // Fetch data and render
  const sources = await getSources();
  return <SourceList sources={sources} />;
}
```

### Conditional UI Rendering

Pass permission flags from Server Components to Client Components:

```typescript
// Server Component (Page)
// src/app/dashboard/sources/page.tsx
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SourceManager } from "@/components/source-manager";

export default async function SourcesPage() {
  const permissions = await getUserPermissions();

  return (
    <SourceManager
      canCreate={permissions.includes(PERMISSIONS.SOURCES.WRITE)}
      canDelete={permissions.includes(PERMISSIONS.SOURCES.WRITE)}
    />
  );
}
```

```typescript
// Client Component
// src/components/source-manager.tsx
"use client";

interface Props {
  canCreate: boolean;
  canDelete: boolean;
}

export function SourceManager({ canCreate, canDelete }: Props) {
  return (
    <div>
      {canCreate && (
        <Button onClick={() => setShowCreateDialog(true)}>
          Add Source
        </Button>
      )}

      <SourceList
        onDelete={canDelete ? handleDelete : undefined}
      />
    </div>
  );
}
```

## Permission Categories

### Resource Management

| Permission | Description |
| :--- | :--- |
| `sources:view` | View database sources in the sidebar |
| `sources:read` | Browse the Database Explorer (tables and data) |
| `sources:write` | Create, edit, delete sources |
| `destinations:read` | View storage destinations |
| `destinations:write` | Create, edit, delete destinations |
| `notifications:read` | View notification configs |
| `notifications:write` | Create, edit, delete notifications |

### Backup Operations

| Permission | Description |
| :--- | :--- |
| `jobs:read` | View backup jobs |
| `jobs:write` | Create, edit, delete jobs |
| `jobs:execute` | Manually trigger backups |
| `history:read` | View execution history |
| `dashboard:read` | Read overview statistics through `GET /api/dashboard/stats` |

### Storage & Recovery

| Permission | Description |
| :--- | :--- |
| `storage:read` | Browse Storage Explorer |
| `storage:download` | Download backup files |
| `storage:restore` | Trigger database restores |
| `storage:delete` | Delete backup files |

### Administration

| Permission | Description |
| :--- | :--- |
| `users:read` | View user list |
| `users:write` | Create, edit, delete users |
| `groups:read` | View groups |
| `groups:write` | Create, edit, delete groups |
| `settings:read` | View system settings |
| `settings:write` | Modify system settings |
| `vault:read` | View encryption profiles |
| `vault:write` | Create, delete encryption profiles |
| `audit:read` | View audit logs |
| `api-keys:read` | View own API keys |
| `api-keys:write` | Create, delete, rotate API keys |

### Credential Profiles

| Permission | Description |
| :--- | :--- |
| `credentials:read` | View credential profiles |
| `credentials:write` | Create and edit credential profiles |
| `credentials:delete` | Delete credential profiles |
| `credentials:reveal` | Reveal stored secrets (SSH keys, passwords) |

### Templates

| Permission | Description |
| :--- | :--- |
| `templates:read` | View naming templates, schedule presets, and retention policies |
| `templates:write` | Create, edit, delete templates |

### Profile (Self-Service)

| Permission | Description |
| :--- | :--- |
| `profile:update_name` | Change own display name |
| `profile:update_email` | Change own email |
| `profile:update_password` | Change own password |
| `profile:manage_2fa` | Enable/disable 2FA |
| `profile:manage_passkeys` | Manage passkeys |

## Default Groups

Recommended group templates:

### Admin

```json
["users:read", "users:write", "groups:read", "groups:write",
 "sources:view", "sources:read", "sources:write",
 "destinations:read", "destinations:write",
 "jobs:read", "jobs:write", "jobs:execute", "history:read", "dashboard:read",
 "storage:read", "storage:download", "storage:restore", "storage:delete",
 "notifications:read", "notifications:write",
 "vault:read", "vault:write",
 "credentials:read", "credentials:write", "credentials:delete", "credentials:reveal",
 "templates:read", "templates:write",
 "settings:read", "settings:write", "audit:read",
 "api-keys:read", "api-keys:write"]
```

### Operator

```json
["sources:view", "destinations:read", "jobs:read", "jobs:execute",
 "history:read", "storage:read", "storage:download", "storage:restore"]
```

### Viewer

```json
["sources:view", "destinations:read", "jobs:read", "history:read",
 "storage:read"]
```

## Audit Trail

Permission changes are logged:

```typescript
// Log group permission changes
await prisma.auditLog.create({
  data: {
    userId: currentUser.id,
    action: "GROUP_UPDATE",
    targetType: "Group",
    targetId: group.id,
    details: JSON.stringify({
      oldPermissions,
      newPermissions,
    }),
  },
});
```

## Testing

```typescript
// tests/unit/access-control.test.ts
describe("Access Control", () => {
  it("denies access without group", async () => {
    mockSession({ user: { groupId: null } });

    await expect(
      checkPermission(PERMISSIONS.SOURCES.READ)
    ).rejects.toThrow("No group assigned");
  });

  it("denies missing permission", async () => {
    mockSession({
      user: {
        group: { permissions: '["users:read"]' },
      },
    });

    await expect(
      checkPermission(PERMISSIONS.SOURCES.WRITE)
    ).rejects.toThrow("Missing permission");
  });

  it("allows valid permission", async () => {
    mockSession({
      user: {
        group: { permissions: '["sources:read"]' },
      },
    });

    await expect(
      checkPermission(PERMISSIONS.SOURCES.READ)
    ).resolves.not.toThrow();
  });
});
```

## Related Documentation

- [User Management](/user-guide/admin/users)
- [Groups & Permissions](/user-guide/admin/permissions)
- [Service Layer](/developer-guide/core/services)
