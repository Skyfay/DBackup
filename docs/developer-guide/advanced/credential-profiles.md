# Credential Profiles

Credential profiles are reusable named sets of secrets (username/password pairs, SSH keys, API tokens, etc.) that can be assigned to multiple adapter configurations. Secrets are encrypted at rest using the system `ENCRYPTION_KEY` (AES-256-GCM).

**Location**: `src/services/auth/credential-service.ts`  
**Types**: `src/lib/core/credentials.ts`

## Why Use Credential Profiles

Without credential profiles, each adapter configuration stores its own copy of credentials directly. Profiles allow:

- **Reuse**: one profile referenced by many adapters
- **Rotation**: update credentials in one place, all adapters pick up the change
- **Separation of concerns**: admins who manage secrets do not need access to adapter configuration

## Credential Types

| Type | Payload fields | Typical use |
|------|---------------|-------------|
| `USERNAME_PASSWORD` | `username`, `password` | MySQL, PostgreSQL, MSSQL, WebDAV, FTP |
| `SSH_KEY` | `username`, `authType` (`password`/`privateKey`/`agent`), `password?`, `privateKey?`, `passphrase?` | SFTP SSH tunneling |
| `ACCESS_KEY` | `accessKeyId`, `secretAccessKey` | S3-compatible storage |
| `TOKEN` | `token` | API tokens, bearer auth |
| `SMTP` | `user`, `password` | Email notification adapter |
| `WEBHOOK` | `url`, `authHeader?` | Webhook notification endpoints |
| `OAUTH` | `clientId`, `clientSecret`, `refreshToken?` | Google Drive, OneDrive OAuth flows |

Each type is validated against its Zod schema (`CREDENTIAL_SCHEMAS` in `src/lib/core/credentials.ts`) before the payload is encrypted and stored.

## Prisma Model

```prisma
model CredentialProfile {
  id          String   @id @default(cuid())
  name        String   @unique
  type        String   // CredentialType value
  description String?
  data        String   // AES-256-GCM encrypted JSON payload
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  primaryAdapters AdapterConfig[] @relation("PrimaryCredential")
  sshAdapters     AdapterConfig[] @relation("SshCredential")
}
```

The `data` field is **never** returned to API callers in plaintext. List and get responses return a sanitized `CredentialProfileShape` (no `data`). The only way to read plaintext secrets is through the explicit reveal endpoint, gated behind `CREDENTIALS.REVEAL`.

## Service API

All functions are named exports from `src/services/auth/credential-service.ts`.

### `createCredentialProfile(name, type, data, description?)`

Creates a new profile. Validates the payload against the type schema, enforces name uniqueness, encrypts the payload, and persists.

```typescript
const profile = await createCredentialProfile(
  "My SFTP credentials",
  "SSH_KEY",
  { username: "backup", authType: "privateKey", privateKey: "-----BEGIN..." },
  "Used for SFTP destination on backup-server"
);
// Returns CredentialProfileShape (no plaintext data)
```

Throws `ValidationError` on invalid payload, `ConflictError` on duplicate name.

### `listCredentialProfiles(type?)`

Returns all profiles, optionally filtered by type. Includes a `secretStatus` map indicating which payload fields are non-empty — without exposing their values.

```typescript
const profiles = await listCredentialProfiles("OAUTH");
// profiles[0].secretStatus => { clientId: true, clientSecret: true, refreshToken: false }
```

### `listCredentialProfilesWithCounts(type?)`

Same as `listCredentialProfiles`, plus `usageCount`, the number of `AdapterConfig` rows referencing this profile across both primary and SSH slots, and `usedBy`, the adapter IDs of those rows, each listed once. The login picker in the connection form uses `usedBy` to suggest the profiles that connections of the same adapter already use. Served by `GET /api/credentials?includeCounts=true`.

### `getCredentialProfile(id)`

Returns a single sanitized profile or throws `NotFoundError`.

### `getDecryptedCredentialData(id, expectedType?)`

Returns the decrypted and parsed payload. Pass `expectedType` to guard against type mismatches.

::: danger Security
Only call this from the backup/restore pipeline (`resolveAdapterConfig`) or the reveal API endpoint. Never expose the return value to API responses.
:::

### `updateCredentialProfile(id, updates)`

Updates `name`, `data`, and/or `description`. The credential type cannot be changed (doing so would silently invalidate adapters that reference it). Re-validates and re-encrypts the payload if `data` is updated.

### `deleteCredentialProfile(id)`

Deletes the profile. Throws `ConflictError` if any adapter still references it in either the primary or SSH slot. Detach adapters first.

### `getCredentialUsage(id)`

Returns which adapters reference this profile and in which slot:

```typescript
const usage = await getCredentialUsage(profileId);
// [{ adapterId, name, type, slot: "primary" | "ssh" }]
```

### `getReferenceCount(id)`

Returns the total number of adapters referencing this profile (primary + SSH slots combined).

## Adapter Integration

Adapters declare which credential types they accept via `AdapterCredentialRequirements` on `BaseAdapter.credentials`:

```typescript
// src/lib/adapters/storage/sftp/index.ts
export const SFTPAdapter: StorageAdapter & BaseAdapter = {
  credentials: {
    primary: "SSH_KEY",       // primary slot accepts SSH_KEY profiles
    primaryOptional: true,    // can operate without a profile (falls back to config values)
    ssh: "SSH_KEY",           // optional SSH tunnel slot
  },
  // ...
};
```

At runtime, `resolveAdapterConfig()` reads the assigned credential profile ID(s) from `AdapterConfig.primaryCredentialId` / `AdapterConfig.sshCredentialId`, decrypts the payload, and merges it into the resolved config before passing it to the adapter.

## Permissions

Access to credential profiles is controlled by the `CREDENTIALS` permission category:

| Permission | Action |
|------------|--------|
| `credentials:read` | List profiles and view metadata (no secret values) |
| `credentials:write` | Create and update profiles |
| `credentials:delete` | Delete profiles |
| `credentials:reveal` | Reveal plaintext payload via the reveal endpoint |

```typescript
// Server Action guard example
await checkPermission(PERMISSIONS.CREDENTIALS.READ);
```

## `secretStatus` Map

Rather than exposing secret field values, the service computes a `Record<string, boolean>` that indicates which fields hold a non-empty value. This lets the UI communicate state (e.g., whether an OAuth profile has been authorized and has a `refreshToken`) without transmitting secrets:

```typescript
// OAUTH profile that has been through the consent flow:
{ clientId: true, clientSecret: true, refreshToken: true }

// OAUTH profile freshly created, not yet authorized:
{ clientId: true, clientSecret: true, refreshToken: false }
```

## Related

- [Encryption](/developer-guide/advanced/encryption) - system-level `ENCRYPTION_KEY` used to encrypt credential payloads
- [Permissions](/developer-guide/advanced/permissions) - `CREDENTIALS.*` permission constants
- [Database Adapters](/developer-guide/adapters/database) - how adapters declare credential requirements
- [Storage Adapters](/developer-guide/adapters/storage) - SSH tunnel credential slots
