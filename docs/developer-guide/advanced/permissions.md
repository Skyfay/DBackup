# Permission System (RBAC)

DBackup implements Role-Based Access Control (RBAC) to control feature access through user groups with defined permissions.

## Architecture

```
                     ┌──────────────────────┐      ┌─────────────────┐
┌──────────────┐ ┌──▶│ TenantMembership     │─────▶│      Group      │
│     User     │ │   │ tenantId: "default"  │      │  permissions[]  │
│              │─┤   └──────────────────────┘      │  fullAccess     │
│ platformRole │ │   ┌──────────────────────┐      └─────────────────┘
└──────────────┘ └──▶│ TenantMembership     │─────▶ another group
                     │ tenantId: "acme"     │
                     └──────────────────────┘
```

**Key Concepts:**

- **Permissions**: Granular strings (e.g., `sources:read`, `jobs:execute`)
- **Groups**: Contain a list of permissions and are the same in every tenant
- **Memberships**: A user holds one group per [tenant](./tenants.md) they work in, or none
- **No Group = No Access**: Users without a group in a tenant have no permissions there
- **Full access**: A group with `fullAccess` holds every permission, also the ones a new version adds. It cannot be edited or deleted, and nothing checks a group by its name
- **Platform admin**: `User.platformRole = "ADMIN"` passes every check in every tenant, never through an API key

## Database Schema

```prisma
model User {
  id           String   @id  // Set by auth system
  name         String
  email        String   @unique
  // ...
  platformRole String?            // "ADMIN" for a platform admin
  memberships  TenantMembership[]
}

model TenantMembership {
  userId    String
  tenantId  String
  groupId   String
  createdAt DateTime @default(now())

  @@id([userId, tenantId])
}

model Group {
  id          String   @id @default(uuid())
  name        String   @unique
  permissions String   // JSON array: ["users:read", "jobs:write"]
  fullAccess  Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Effective Permissions

`permissionsIn(memberships, tenantId)` in `src/lib/auth/owner-permissions.ts` decides what someone may do while working in a tenant:

| Permissions | Count from |
| :--- | :--- |
| `settings:*` (`PLATFORM_PERMISSIONS`) | The group in the home tenant only, since they act on the whole instance |
| `profile:*` (`PROFILE_PERMISSIONS`) | Any group the user holds, since the account belongs to no tenant |
| Everything else | The group in the tenant the user works in |

With one tenant this is exactly what the group gives. `getAuthContext` puts the result into `AuthContext.permissions`, every permission for a platform admin. API keys are capped by `ownerPermissionsIn(owner, key.tenantId)`. See [Tenants](./tenants.md#permissions) for the guards on accounts and groups.

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

It is also what the group with every permission and a platform admin get: code that grants all permissions maps over `AVAILABLE_PERMISSIONS` rather than hard-coding permission strings, like `groupPermissions()` for a `fullAccess` group.

## Access Control Functions

Located in `src/lib/auth/access-control.ts`:

### checkPermission()

Throws if the signed-in user lacks the permission in the tenant they work in, and returns the viewer otherwise:

```typescript
export async function checkPermission(permission: Permission): Promise<Viewer> {
  const viewer = await getViewer();   // the user with isPlatformAdmin, tenantId, permissions and role

  if (!viewer) {
    throw new AuthenticationError();
  }

  if (!viewer.isPlatformAdmin && !viewer.permissions.includes(permission)) {
    throw new PermissionError(permission);
  }

  return viewer;
}
```

`checkPlatformAdmin()` refuses anyone but a signed-in platform admin, for the tenants and what decides over all of them.

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
  const viewer = await getViewer();
  return viewer?.permissions ?? [];
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
| `storage:read` | Browse Backups page |
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

Recommended group templates. The group with every permission, named **Admin**, exists in every installation and needs no list. The first one is the admin of a tenant, whose `settings:*` only count when it is held in the home tenant:

### Tenant Admin

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

The rules are plain functions, so they are tested without a session:

```typescript
import { permissionsIn } from "@/lib/auth/owner-permissions";

const operators = { permissions: '["jobs:read","jobs:execute","settings:read"]', fullAccess: false };

it("leaves the settings out of a group in a customer's tenant", () => {
  expect(permissionsIn([{ tenantId: "acme", group: operators }], "acme")).not.toContain("settings:read");
});

it("gives the settings from the group in the home tenant", () => {
  const memberships = [{ tenantId: "default", group: operators }, { tenantId: "acme", group: operators }];
  expect(permissionsIn(memberships, "acme")).toContain("settings:read");
});
```

A guard of a Server Action or route is tested against mocked `getViewer` or `getAuthContext` results, like the tests under `tests/unit/lib/*-guards.test.ts`.

## Related Documentation

- [User Management](/user-guide/admin/users)
- [Groups & Permissions](/user-guide/admin/permissions)
- [Service Layer](/developer-guide/core/services)
- [Tenants](/developer-guide/advanced/tenants)
