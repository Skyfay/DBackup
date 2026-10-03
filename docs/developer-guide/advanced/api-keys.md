# API Keys & Webhook Triggers

This document covers the API key authentication system and the webhook trigger mechanism for programmatic backup execution.

## Architecture Overview

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  External Client │     │   Middleware      │     │   API Route      │
│  (cURL, CI/CD)   │────▶│   (Rate Limiter)  │────▶│   Handler        │
│                  │     │                  │     │                  │
│  Authorization:  │     │  Passes Bearer   │     │  getAuthContext() │
│  Bearer dbackup_ │     │  token through   │     │  ↓ Session?       │
└──────────────────┘     └──────────────────┘     │  ↓ API Key?       │
                                                  │  → AuthContext     │
                                                  └──────────────────┘
```

**Key Principles:**
- API keys provide stateless, token-based authentication for programmatic access
- API keys **never** inherit SuperAdmin privileges - only explicitly assigned permissions apply
- A key never gets more than the group of its owner may do. `validate()` cuts its permissions to that group at every request (`capToOwner` in `src/lib/auth/owner-permissions.ts`)
- The raw key is shown exactly once at creation; only a scrypt hash is stored (SHA-256 is kept as a legacy fallback and is automatically upgraded on next use)
- All API routes support both session (cookie) and API key (Bearer token) authentication via the unified `getAuthContext()` function

## Database Schema

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  name        String
  prefix      String    // First 16 chars (e.g., "dbackup_a3f2b1c8")
  hashedKey   String    @unique   // scrypt hash of full key (legacy: SHA-256, auto-upgraded on next use)
  permissions String    // JSON array: ["jobs:read", "jobs:execute"]
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  enabled     Boolean   @default(true)
  createdAt   DateTime  @default(now())

  @@index([hashedKey])
  @@index([userId])
}
```

**Design Decisions:**
- `hashedKey` index enables O(1) lookup during validation
- `prefix` stores only the first 16 characters for display in the UI (e.g., `dbackup_a3f2b1c8`)
- `permissions` is a JSON string array, matching the `Group.permissions` pattern
- `onDelete: Cascade` ensures keys are deleted when the owning user is removed

## Key Generation

```
dbackup_ + randomBytes(30).toString("hex")
         ↓
dbackup_ + 40 hex characters = 48 characters total
```

```typescript
// src/services/api-key-service.ts
const API_KEY_PREFIX = "dbackup_";
const KEY_BYTE_LENGTH = 30;   // 30 bytes → 40 hex chars

function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(KEY_BYTE_LENGTH).toString("hex");
}

async function hashKey(rawKey: string): Promise<string> {
  // scrypt is used for new keys; SHA-256 kept for legacy migration
  const salt = randomBytes(16);
  const hash = await scrypt(rawKey, salt, 64);
  return `${salt.toString("hex")}:${(hash as Buffer).toString("hex")}`;
}
```

**Storage strategy:**
| What | Stored | Purpose |
|------|--------|---------|
| Full raw key | ❌ Never | Only returned once at creation |
| scrypt hash | ✅ `hashedKey` column | Used for validation lookups |
| Prefix (16 chars) | ✅ `prefix` column | UI display only |

::: info Legacy SHA-256 migration
Keys created before the scrypt upgrade have SHA-256 hashes stored in `hashedKey`. On successful validation, these are automatically re-hashed with scrypt and the DB record is updated. No user action is needed.
:::

## API Key Service

Location: `src/services/auth/api-key-service.ts`

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `(input: CreateApiKeyInput) → { apiKey, rawKey }` | Generate key, store hash. Raw key returned **once**. |
| `validate` | `(rawKey: string) → ValidatedApiKey \| null` | Validate a key against the database (see flow below) |
| `list` | `(userId?: string) → ApiKeyListItem[]` | List all keys, optionally filtered by user |
| `getById` | `(id: string) → ApiKeyListItem` | Get a single key by ID |
| `toggle` | `(id: string, enabled: boolean) → ApiKeyListItem` | Enable or disable a key |
| `rotate` | `(id: string) → { apiKey, rawKey }` | Generate a new key, replace the old hash |
| `update` | `(id, { name, permissions, expiresAt }) → { before, after }` | Change a key and say what it was before. The secret stays |
| `ownerOf` | `(id: string) → { ownerId, name, permissions, group }` | The owner with their group, which caps what the key may get |
| `nameTaken` | `(name: string, exceptId?: string) → boolean` | Whether another key has the name in any case. Runs name the key that started them |
| `delete` | `(id: string) → void` | Delete a key |

### Validation Flow

```
Request with "Authorization: Bearer dbackup_abc123..."
                    │
                    ▼
          ┌─────────────────┐
          │ 1. Prefix Check │  Does it start with "dbackup_"?
          │                 │  No → return null
          └────────┬────────┘
                   │ Yes
                   ▼
          ┌─────────────────┐
          │ 2. Hash Key     │  scrypt(rawKey) → hash (or SHA-256 for legacy upgrade path)
          └────────┬────────┘
                   │
                   ▼
          ┌─────────────────┐
          │ 3. DB Lookup    │  SELECT * FROM ApiKey WHERE hashedKey = hash
          │                 │  Not found → return null
          └────────┬────────┘
                   │ Found
                   ▼
          ┌─────────────────┐
          │ 4. Enabled?     │  No → throw ApiKeyError("disabled")
          └────────┬────────┘
                   │ Yes
                   ▼
          ┌─────────────────┐
          │ 5. Expired?     │  expiresAt < now → throw ApiKeyError("expired")
          └────────┬────────┘
                   │ Valid
                   ▼
          ┌─────────────────┐
          │ 6. Update Usage │  Fire-and-forget: lastUsedAt = now()
          └────────┬────────┘
                   │
                   ▼
          ┌─────────────────┐
          │ 7. Owner Cap    │  permissions ∩ group of the owner
          │                 │  SuperAdmin group → all it holds, no group → none
          └────────┬────────┘
                   │
                   ▼
          Return { id, userId, permissions }
```

## Unified Authentication (`getAuthContext`)

Location: `src/lib/auth/access-control.ts`

The `getAuthContext()` function provides a single entry point for authenticating requests from both browser sessions and API keys.

### AuthContext Type

```typescript
export interface AuthContext {
  userId: string;
  permissions: string[];
  isSuperAdmin: boolean;
  authMethod: "session" | "apikey";
  apiKeyId?: string;   // Only set for API key auth
}
```

### Authentication Flow

```typescript
export async function getAuthContext(
  headersObj: Headers
): Promise<AuthContext | null> {
  // 1. Try session authentication first (browser cookies)
  const session = await auth.api.getSession({ headers: headersObj });
  if (session) {
    const user = await getUserWithGroup(session.user.id);
    return {
      userId: user.id,
      permissions: user.isSuperAdmin
        ? AVAILABLE_PERMISSIONS
        : JSON.parse(user.group?.permissions || "[]"),
      isSuperAdmin: user.isSuperAdmin,
      authMethod: "session",
    };
  }

  // 2. Fall back to API key (Bearer token)
  const token = extractBearerToken(headersObj);
  if (token) {
    const validated = await apiKeyService.validate(token);
    if (validated) {
      return {
        userId: validated.userId,
        permissions: validated.permissions,
        isSuperAdmin: false,  // API keys NEVER get SuperAdmin
        authMethod: "apikey",
        apiKeyId: validated.id,
      };
    }
  }

  return null;
}
```

### Permission Check

```typescript
export function checkPermissionWithContext(
  ctx: AuthContext,
  permission: Permission
): void {
  // SuperAdmin bypass (session-only - API keys never have this)
  if (ctx.isSuperAdmin) return;

  if (!ctx.permissions.includes(permission)) {
    throw new PermissionError(permission);
  }
}
```

### Usage in API Routes

```typescript
// src/app/api/jobs/[id]/run/route.ts
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext(req.headers);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  checkPermissionWithContext(ctx, PERMISSIONS.JOBS.EXECUTE);

  const result = await backupService.executeJob(params.id);

  // Audit log with trigger source
  await auditService.log({
    action: AUDIT_ACTIONS.EXECUTE,
    resource: AUDIT_RESOURCES.JOB,
    userId: ctx.userId,
    details: {
      trigger: ctx.authMethod === "apikey" ? "api" : "manual",
      apiKeyId: ctx.apiKeyId,
    },
  });

  return NextResponse.json(result);
}
```

## Webhook Trigger System

### Trigger Flow

```
External Client                      DBackup Server
─────────────────                    ──────────────────

POST /api/jobs/:id/run ──────────▶  Auth (getAuthContext)
Authorization: Bearer dbackup_xxx       │
                                        ▼
                                    Permission Check (jobs:execute)
                                        │
                                        ▼
                                    backupService.executeJob(id)
                                        │
                                        ▼
                                    Queue Manager (FIFO)
                                        │
                                        ▼
                                    Runner Pipeline
                                    01-initialize → 02-dump → 03-upload
                                    → 04-completion → 05-retention

◀──────────────────────────────────  { success, executionId }

GET /api/executions/:id ─────────▶  Returns status, progress, stage
Authorization: Bearer dbackup_xxx

◀──────────────────────────────────  { data: { status, progress, ... } }
```

### Required Permissions

| Action | Permission |
|--------|------------|
| Trigger a backup job | `jobs:execute` |
| Poll execution status | `history:read` |
| Full trigger + poll | `jobs:execute` + `history:read` |

### Job Trigger Endpoint

```
POST /api/jobs/:id/run
```

**Response** (`200 OK`):
```json
{
  "success": true,
  "executionId": "clx1abc...",
  "message": "Job queued successfully"
}
```

The job enters the queue and respects the `maxConcurrentJobs` setting. If the queue is full, the job remains in `Pending` status until a slot opens.

### Execution Polling Endpoint

```
GET /api/executions/:id?includeLogs=true
```

**Response** (`200 OK`):
```json
{
  "success": true,
  "data": {
    "id": "clx1abc...",
    "jobId": "clx0xyz...",
    "jobName": "Daily MySQL Backup",
    "type": "Backup",
    "status": "Running",
    "progress": 45,
    "stage": "Uploading",
    "startedAt": "2025-01-15T10:30:00.000Z",
    "endedAt": null,
    "duration": 15234,
    "size": null,
    "path": null,
    "error": null,
    "logs": [...]
  }
}
```

**Status Values:**

| Status | Description |
|--------|-------------|
| `Pending` | Queued, waiting for execution slot |
| `Running` | Currently executing |
| `Success` | Completed successfully |
| `Failed` | Failed (see `error` field) |

**Implementation Details:**
- `progress` and `stage` are parsed from `execution.metadata` (JSON field)
- `duration` is calculated live when `endedAt` is still `null`
- On `Failed` status, `error` contains the last error-level log entry
- Logs are only included when `?includeLogs=true` to reduce payload size

## Audit Events

API key operations generate audit log entries:

| Action | Resource | When | Details |
|--------|----------|------|---------|
| `CREATE` | `API_KEY` | Key created | `name`, `permissions`, `expiresAt`, `template` of the task |
| `UPDATE` | `API_KEY` | Key edited | `name`, `renamedFrom`, `added`, `removed`, `areas`, `expiresAt` |
| `UPDATE` | `API_KEY` | Key rotated (new hash) | `name`, `action: "rotate"` |
| `UPDATE` | `API_KEY` | Key enabled/disabled | `name`, `enabled` |
| `DELETE` | `API_KEY` | Key deleted | `name`, `prefix` |
| `EXECUTE` | `JOB` | Job triggered via API | `trigger: "api"`, `apiKeyId` |

The panel of a key finds its runs by `triggerLabel`, which holds the name the key had at run time. A rename is read back from `renamedFrom`, so the runs of earlier names still show.

## Error Handling

API key-specific errors use the `ApiKeyError` class:

```typescript
// src/lib/logging/errors.ts
export class ApiKeyError extends DBackupError {
  constructor(reason: "disabled" | "expired" | string) {
    super(`API key error: ${reason}`);
  }
}
```

**HTTP Status Codes:**

| Scenario | Status | Response |
|----------|--------|----------|
| No auth header | `401` | `{ error: "Unauthorized" }` |
| Invalid/expired/disabled key | `401` | `{ error: "Unauthorized" }` |
| Valid key, missing permission | `403` | `{ error: "Forbidden" }` |
| Job not found | `404` | `{ error: "Job not found" }` |

## Security Considerations

1. **No SuperAdmin for API Keys**: Even if the key owner is a SuperAdmin, the API key only has its explicitly assigned permissions
2. **Hash-Only Storage**: Raw keys are never persisted - only scrypt hashes
3. **Owner Cap**: A key never exceeds the group of its owner, at every request. Creating a key or adding a permission also needs the caller's group to allow it, and only the owner or a user whose group covers the key may rotate it
4. **One-Time Reveal**: The full key is displayed exactly once, after creation or rotation
5. **Expiration**: New keys run out after 90 days by default
6. **Rate Limiting**: API key requests go through the same IP-based rate limiter as browser requests
7. **Cascade Deletion**: When a user is deleted, all their API keys are automatically removed

## UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ApiKeysTab` | `src/components/dashboard/api-keys/api-keys-tab.tsx` | The API keys tab: strip, table or cards, bulk actions, loaded from `GET /api/api-keys` |
| `ApiKeyDetails` | `src/components/dashboard/api-keys/api-key-details.tsx` | The panel of a key, with its runs from `GET /api/api-keys/[id]` |
| `ApiKeyFormDialog` | `src/components/dashboard/api-keys/api-key-form-dialog.tsx` | New API key (task, copy or Custom, then the editor) and Edit |
| `ApiKeyCreatedDialog` | `src/components/dashboard/api-keys/api-key-created-dialog.tsx` | One-time key display with a first request |
| `PermissionEditor` | `src/components/permissions/permission-editor.tsx` | The editor of permissions by area, shared with the groups |
| `ApiTriggerDialog` | `src/components/dashboard/jobs/api-trigger-dialog.tsx` | Code examples (cURL, Bash, Ansible), makes a key with the CI/CD task |

The tasks of New API key are plain data in `src/lib/auth/api-key-templates.ts`.

## Adding New API Routes

When creating a new API route that should support API key authentication:

```typescript
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function GET(req: Request) {
  // 1. Get auth context (session or API key)
  const ctx = await getAuthContext(req.headers);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Check permission
  checkPermissionWithContext(ctx, PERMISSIONS.YOUR_RESOURCE.READ);

  // 3. Business logic
  const data = await yourService.getData();

  return NextResponse.json(data);
}
```

::: tip
Use `getAuthContext()` + `checkPermissionWithContext()` for all new routes. The legacy `checkPermission()` function only supports session authentication.
:::

## Related Documentation

- [Authentication System](./auth.md) - Session-based auth, 2FA, Passkeys
- [Permission System (RBAC)](./permissions.md) - Group permissions, available permissions list
- [Audit Logging](./audit.md) - Audit event tracking
- [API Reference](/user-guide/features/api-reference) - Full endpoint documentation (user-facing)
