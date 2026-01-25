---
applyTo: "**/*"
---

# Database Backup Manager - AI Assistant Guidelines

## Project Overview
Self-hosted web app for automating database backups (MySQL, PostgreSQL, MongoDB) with encryption, compression, and retention policies. Built with **Next.js 16 (App Router)**, **TypeScript**, **Prisma** (SQLite), and **Shadcn UI**.

## Language & Commands
- **Response**: German (Deutsch) | **Code/Comments**: English
- **Package Manager**: Always use `pnpm` (e.g., `pnpm dev`, `pnpm add`, `pnpm test`)
- **Check**: [TODO.md](../docs/todo/features.md) for current project phase before starting

## Architecture (4 Layers)

### 1. App Router (`src/app`)
- **Route definitions ONLY** - no business logic
- `page.tsx`: Fetch via Services → pass to Client Components
- `actions/*.ts`: Server Actions - thin wrappers (Auth → Zod Validation → Service call → Revalidate)

### 2. Service Layer (`src/services`) ⭐ CORE
All business logic lives here. Server Actions must delegate to Services.
```
job-service.ts      → CRUD for backup jobs
backup-service.ts   → Triggers runJob()
retention-service.ts → GVS (Grandfather-Father-Son) algorithm
restore-service.ts  → Restore orchestration
```

### 3. Adapter System (`src/lib/adapters`)
Plugin architecture for databases, storage, and notifications:
```typescript
// src/lib/core/interfaces.ts - Adapter contracts
DatabaseAdapter  → dump(), restore(), test(), getDatabases()
StorageAdapter   → upload(), download(), list(), delete()
NotificationAdapter → send()

// src/lib/core/registry.ts - Central registration
registry.register(MySQLAdapter);
registry.get("mysql") // Retrieve by ID
```

**Adding a new adapter**: Create folder in `src/lib/adapters/{database|storage|notification}/`, implement interface, register in `src/lib/adapters/index.ts`.

### 4. Backup Pipeline (`src/lib/runner`)
Step-based execution (Queue Manager → Runner → Steps):
```
01-initialize.ts → Fetch Job, resolve adapters
02-dump.ts       → Execute database dump + compression/encryption
03-upload.ts     → Upload to storage destination
04-completion.ts → Cleanup temp files, finalize
05-retention.ts  → Apply retention policy (delete old backups)
```
Context flows through `RunnerContext` (see `src/lib/runner/types.ts`).

## Security (RBAC)

**Mandatory** permission check at top of every Server Action/API Route:
```typescript
// src/app/actions/user.ts
await checkPermission(PERMISSIONS.USERS.WRITE);
```
Permissions defined in [src/lib/permissions.ts](src/lib/permissions.ts). Access control via [src/lib/access-control.ts](src/lib/access-control.ts).

## Key Patterns

### Zod Validation
All adapter configs defined in [src/lib/adapters/definitions.ts](src/lib/adapters/definitions.ts):
```typescript
export const MySQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(3306),
  // ...
});
```

### API Response Format
```typescript
return { success: boolean, message?: string, data?: any, error?: string }
```

### Dates
- **Storage**: Always UTC (ISO 8601)
- **Library**: `date-fns` / `date-fns-tz`
- **Display**: Use `formatDate()` from [src/lib/utils.ts](src/lib/utils.ts)

## Developer Workflows

```bash
pnpm dev                  # Start dev server (http://localhost:3000)
pnpm test                 # Unit tests (vitest)
pnpm test:integration     # Integration tests against real DB containers
pnpm test:ui              # Spin up 16 test DBs + seed local DB for manual testing
pnpm run build            # Production build (validate before commit)
npx prisma migrate dev    # Create DB migration
```

**Test Infrastructure**: See [docker-compose.test.yml](docker-compose.test.yml) for MySQL/PG/Mongo containers.

## Queue System (`src/lib/queue-manager.ts`)

Backups run asynchronously via a **FIFO queue** with configurable concurrency:

```
runJob(jobId) → Creates Execution (status: "Pending") → processQueue()
                                                            ↓
                        Checks SystemSetting "maxConcurrentJobs" (default: 1)
                                                            ↓
                        Starts next pending job if slots available
```

**Key Points:**
- `processQueue()` is triggered after each job enqueue and after each completion
- Jobs execute via `performExecution()` in [src/lib/runner.ts](src/lib/runner.ts)
- Concurrency limit stored in `SystemSetting` table (key: `maxConcurrentJobs`)

## SSO/OIDC Integration

**Architecture:**
```
src/lib/adapters/oidc/     → Provider adapters (Authentik, PocketID, Generic)
src/services/oidc-provider-service.ts → CRUD for SSO providers
src/services/oidc-registry.ts → Runtime provider registration for better-auth
```

**Supported Providers** (`src/lib/adapters/oidc/`):
- `authentik.ts` – Pre-configured for Authentik
- `pocket-id.ts` – Pre-configured for PocketID
- `generic.ts` – Manual OIDC configuration (any provider)

**Adding a new OIDC Adapter:**
1. Create `src/lib/adapters/oidc/{provider}.ts` implementing `OIDCAdapter` interface
2. Define `inputs` (form fields), `inputSchema` (Zod), and `getEndpoints()` method
3. Register in the OIDC adapter index

**Database:** `SsoProvider` model stores encrypted `clientId`/`clientSecret`, endpoints, and domain for email-based matching.

## Encryption Pipeline

**Two-layer encryption architecture:**

### 1. System Encryption (`ENCRYPTION_KEY` env var)
Used to encrypt sensitive data at rest (DB connection passwords, SSO secrets):
```typescript
// src/lib/crypto.ts
encrypt(plaintext)  → AES-256-GCM encrypted (stored in DB)
decrypt(ciphertext) → Original value
decryptConfig(obj)  → Recursively decrypts all encrypted fields in config objects
```

### 2. Backup Encryption (Encryption Profiles)
User-managed keys for backup files:

```typescript
// src/services/encryption-service.ts
createEncryptionProfile(name) → Generates 32-byte key, encrypts with system key, stores in DB

// src/lib/crypto-stream.ts (Streaming for large files)
createEncryptionStream(key) → Returns { stream, iv, getAuthTag() }
createDecryptionStream(key, iv, authTag) → Returns decryption stream
```

**Backup Flow with Encryption:**
```
Database Dump → Compression Stream (optional) → Encryption Stream → Storage
                                                      ↓
                                    Metadata stored: { iv, authTag, profileId }
```

**Metadata File** (`.meta.json`): Stores `iv`, `authTag`, `compression`, and `profileId` for decryption. See `BackupMetadata` interface in [src/lib/core/interfaces.ts](src/lib/core/interfaces.ts).

## Restore Pipeline (`src/services/restore-service.ts`)

Restore runs as a background process with live progress tracking:

```
RestoreService.restore(input)
    ↓
1. Pre-flight checks:
   - prepareRestore() → Verify DB permissions (can create/overwrite?)
   - Version compatibility → Reject if backup version > target server
    ↓
2. Create Execution (type: "Restore", status: "Running")
    ↓
3. runRestoreProcess() (async background):
   - Download backup from storage → temp file
   - Detect encryption (read .meta.json) → Decrypt stream
   - Detect compression → Decompress stream
   - Call DatabaseAdapter.restore(config, tempFile)
   - Cleanup temp files
```

**Key Features:**
- **Database Mapping**: Restore to different DB names via `databaseMapping` parameter
- **Privileged Auth**: Optional elevated credentials for CREATE DATABASE permissions
- **Version Guard**: Prevents restoring newer dumps to older DB servers
- **Streaming Decryption**: Uses same `crypto-stream.ts` as backup (reverse direction)

**Input Interface:**
```typescript
interface RestoreInput {
  storageConfigId: string;       // Source storage adapter
  file: string;                  // Backup file path
  targetSourceId: string;        // Target database adapter
  targetDatabaseName?: string;   // Override single DB name
  databaseMapping?: Record<string, string>; // Multi-DB rename mapping
  privilegedAuth?: { user, password };      // Elevated credentials
}
```

## File Conventions
- **Naming**: `kebab-case` (e.g., `backup-service.ts`, `user-table.tsx`)
- **Exports**: Named exports preferred
- **Max file size**: ~300 lines, then split (e.g., Pipeline Pattern in `runner/steps/`)

## Quick Reference

| Concern | Location |
|---------|----------|
| DB Schema | [prisma/schema.prisma](prisma/schema.prisma) |
| Types/Interfaces | [src/lib/core/](src/lib/core/) |
| Permissions | [src/lib/permissions.ts](src/lib/permissions.ts) |
| Adapters | [src/lib/adapters/](src/lib/adapters/) |
| Services | [src/services/](src/services/) |
| Server Actions | [src/app/actions/](src/app/actions/) |
| Scheduler (Cron) | [src/lib/scheduler.ts](src/lib/scheduler.ts) |