# Database Schema

DBackup uses Prisma ORM with SQLite for application data storage.

## Schema Location

```
prisma/schema.prisma
```

## Entity Relationship Overview

```
┌───────────────────┐     ┌───────────────────┐
│       User        │────▶│       Group       │
│                   │     │   (permissions)   │
└────────┬──────────┘     └───────────────────┘
         │ has many
         ├──── Session, Account, Passkey, TwoFactor
         ├──── AuditLog
         └──── ApiKey

┌──────────────────────────────────────────────────┐
│                   AdapterConfig                  │
│  (database source / storage destination /        │
│   notification channel)                          │
│                                                  │
│  ──▶ CredentialProfile (primary, ssh)            │
│  ──▶ RetentionPolicy (default for destination)   │
│  ──▶ HealthCheckLog, DbVersionHistory            │
│  ──▶ StorageListCache                            │
└────────────┬─────────────────────────────────────┘
             │
┌────────────▼──────────────────────────────────────┐
│                        Job                        │
│  ──▶ AdapterConfig (source)                       │
│  ──▶ AdapterConfig[] (notifications, M:M)         │
│  ──▶ EncryptionProfile                            │
│  ──▶ NamingTemplate                               │
│  ──▶ SchedulePreset                               │
└────────────┬──────────────────────────────────────┘
             │ has many
             ├──── Execution
             └──── JobDestination ──▶ AdapterConfig
                                  ──▶ RetentionPolicy

┌───────────────────┐   ┌───────────────────┐
│  CredentialProfile│   │  EncryptionProfile│
└───────────────────┘   └───────────────────┘

┌───────────────────┐   ┌───────────────────┐
│  RetentionPolicy  │   │  NamingTemplate   │
└───────────────────┘   └───────────────────┘

┌───────────────────┐   ┌───────────────────┐
│  SchedulePreset   │   │   StorageSnapshot │
└───────────────────┘   └───────────────────┘
```

---

## Reusable Template Models

### CredentialProfile

Reusable named credential sets, encrypted with the system `ENCRYPTION_KEY`. Assignable to adapters as primary or SSH credentials.

```prisma
model CredentialProfile {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  type        String   // USERNAME_PASSWORD | SSH_KEY | ACCESS_KEY | TOKEN | SMTP
  data        String   // Encrypted JSON payload

  primaryAdapters AdapterConfig[] @relation("PrimaryCredential")
  sshAdapters     AdapterConfig[] @relation("SshCredential")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### EncryptionProfile

Stores per-backup encryption keys. The `secretKey` is encrypted with the system `ENCRYPTION_KEY` before storage.

```prisma
model EncryptionProfile {
  id          String   @id @default(cuid())
  name        String
  description String?
  secretKey   String   // Encrypted with system ENCRYPTION_KEY

  jobs        Job[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### RetentionPolicy

Reusable GFS (Grandfather-Father-Son) retention rule templates. Can be linked to `AdapterConfig` as a default (pre-fills the job form) or to individual `JobDestination` entries.

```prisma
model RetentionPolicy {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  config      String   // JSON RetentionConfiguration
  isDefault   Boolean  @default(false)
  isSystem    Boolean  @default(false) // System policies are read-only in the UI

  jobDestinations JobDestination[]
  adapterConfigs  AdapterConfig[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### NamingTemplate

Backup file naming patterns (e.g. `{name}_yyyy-MM-dd_HH-mm-ss`). At most one can be the default. System templates are read-only in the UI.

```prisma
model NamingTemplate {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  pattern     String   // e.g. "{name}_yyyy-MM-dd_HH-mm-ss"
  isDefault   Boolean  @default(false)
  isSystem    Boolean  @default(false)

  jobs        Job[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### SchedulePreset

Reusable cron schedule configurations. When a job is linked to a preset, the scheduler uses the preset's `schedule` value. The job's own `schedule` field is kept as a fallback.

```prisma
model SchedulePreset {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  schedule    String   // 5-part cron expression

  jobs        Job[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

---

## Backup Core Models

### AdapterConfig

Central table for all configurable adapters: database sources, storage destinations, and notification channels. The `type` field determines which section of the UI it appears in.

```prisma
model AdapterConfig {
  id        String   @id @default(uuid())
  name      String              // Display name
  type      String              // "database" | "storage" | "notification"
  adapterId String              // "mysql" | "s3" | "discord" | etc.
  config    String              // JSON encrypted adapter config
  metadata  String?             // JSON non-sensitive runtime data (e.g. version)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Credential profile references
  primaryCredentialId String?
  primaryCredential   CredentialProfile? @relation("PrimaryCredential", ...)
  sshCredentialId     String?
  sshCredential       CredentialProfile? @relation("SshCredential", ...)

  // Default retention for storage destinations
  defaultRetentionPolicyId String?
  defaultRetentionPolicy   RetentionPolicy? @relation(...)

  // Health monitoring cache (updated by HEALTH_CHECK system task)
  lastHealthCheck     DateTime?
  lastStatus          String    @default("ONLINE") // ONLINE | DEGRADED | OFFLINE
  lastError           String?   // Human-readable reason when not ONLINE
  consecutiveFailures Int       @default(0)

  // Relations
  jobsSource       Job[]            @relation("Source")
  jobsNotification Job[]            @relation("Notifications")
  jobDestinations  JobDestination[]
  healthLogs       HealthCheckLog[]
  versionHistory   DbVersionHistory[]
  storageListCache StorageListCache?
}
```

**Notes:**
- `config` stores encrypted JSON decoded by `decryptConfig()` before passing to adapters
- Health fields are cached for fast UI display without joins; populated by the `HEALTH_CHECK` system task

### Job

Defines a backup job: which database to back up, to which destinations, on what schedule.

```prisma
model Job {
  id                  String   @id @default(uuid())
  name                String
  schedule            String              // Cron expression (overridden by schedulePreset when set)
  enabled             Boolean  @default(true)
  databases           String   @default("[]") // JSON array of DB names to back up
  compression         String   @default("NONE") // "NONE" | "GZIP" | "BROTLI"
  pgCompression       String   @default("")     // PostgreSQL native compression option
  notificationEvents  String   @default("ALWAYS") // "ALWAYS" | "FAILURE_ONLY" | "SUCCESS_ONLY"
  skipVerification    Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // Foreign keys
  sourceId            String
  encryptionProfileId String?
  namingTemplateId    String?  // null = use system default at runtime
  schedulePresetId    String?  // When set, scheduler uses preset.schedule

  // Relations
  source              AdapterConfig       @relation("Source", ...)
  encryptionProfile   EncryptionProfile?  @relation(...)
  namingTemplate      NamingTemplate?     @relation(...)
  schedulePreset      SchedulePreset?     @relation(...)
  notifications       AdapterConfig[]     @relation("Notifications")
  destinations        JobDestination[]
  executions          Execution[]
}
```

**Note:** There is no direct `destinationId` on `Job`. Destinations are managed through the `JobDestination` join table, which supports multiple destinations per job with per-destination priority and retention settings.

### JobDestination

Join table linking a `Job` to its storage `AdapterConfig` destinations. Stores per-destination upload priority and retention policy.

```prisma
model JobDestination {
  id                String   @id @default(uuid())
  jobId             String
  configId          String
  priority          Int      @default(0) // Upload order (ascending)
  retention         String   @default("{}") // Legacy JSON (kept for backward compat)
  retentionPolicyId String?  // References RetentionPolicy; takes precedence over retention JSON
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  job               Job            @relation(...)
  config            AdapterConfig  @relation(...)
  retentionPolicy   RetentionPolicy? @relation(...)

  @@unique([jobId, configId])
}
```

### Execution

Records each backup or restore operation with its logs, status, and metadata.

```prisma
model Execution {
  id           String    @id @default(uuid())
  jobId        String?             // Nullable for manual restores
  type         String    @default("Backup") // "Backup" | "Restore"
  status       String              // "Pending" | "Running" | "Success" | "Partial" | "Failed" | "Cancelled"
  logs         String              // JSON array of log entries
  startedAt    DateTime  @default(now())
  endedAt      DateTime?
  size         BigInt?             // Backup file size in bytes
  path         String?             // Remote storage path of the backup file
  metadata     String?             // JSON: encryption metadata, checksums, etc.
  triggerType  String?             // "Manual" | "Scheduler" | "Api"
  triggerLabel String?             // e.g. user name, API key name, "Scheduler"
  logsPurgedAt DateTime?           // Set when data retention cleared `logs`

  job          Job?      @relation(...)

  @@index([startedAt])
  @@index([status, startedAt])
  @@index([jobId, startedAt])
  @@index([logsPurgedAt, startedAt])
}
```

---

## User & Auth Models

### User

```prisma
model User {
  id                     String     @id
  name                   String
  email                  String     @unique
  emailVerified          Boolean
  image                  String?
  timezone               String     @default("")  // IANA tz string; "" = server default
  dateFormat             String     @default("P")
  timeFormat             String     @default("p")
  autoRedirectOnJobStart Boolean    @default(true)
  twoFactorEnabled       Boolean?
  passkeyTwoFactor       Boolean?   @default(false)
  createdAt              DateTime
  updatedAt              DateTime

  groupId                String?
  group                  Group?     @relation(...)

  twoFactor              TwoFactor?
  accounts               Account[]
  passkeys               Passkey[]
  sessions               Session[]
  auditLogs              AuditLog[]
  apiKeys                ApiKey[]
}
```

### Group

RBAC group. `permissions` is a JSON array of permission strings (same format as `ApiKey.permissions`).

```prisma
model Group {
  id          String   @id @default(uuid())
  name        String   @unique
  permissions String              // JSON array of permission strings
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users       User[]
}
```

### ApiKey

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  name        String
  prefix      String              // First 16 chars of raw key for UI identification
  hashedKey   String    @unique   // scrypt hash of the full key
  permissions String              // JSON array of permission strings
  userId      String
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  enabled     Boolean   @default(true)
  createdAt   DateTime  @default(now())

  user        User      @relation(...)

  @@index([hashedKey])
  @@index([userId])
}
```

**Note:** `hashedKey` uses scrypt for new keys. Legacy SHA-256 hashes are automatically upgraded on next use.

### Session

```prisma
model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String

  user      User     @relation(...)
}
```

### Account

OAuth / SSO account links for `better-auth`.

```prisma
model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime

  user                  User      @relation(...)
}
```

### TwoFactor (TOTP)

```prisma
model TwoFactor {
  id          String @id
  secret      String          // Encrypted TOTP secret
  backupCodes String          // Encrypted backup codes
  verified    Boolean @default(false)
  userId      String @unique

  user        User   @relation(...)
}
```

### Passkey

WebAuthn passkey credential.

```prisma
model Passkey {
  id           String    @id
  name         String?
  publicKey    String
  userId       String
  credentialID String    @unique
  counter      Int
  deviceType   String
  backedUp     Boolean
  transports   String?
  createdAt    DateTime?
  aaguid       String?

  user         User      @relation(...)
}
```

### Verification

Email / magic-link verification tokens managed by `better-auth`.

```prisma
model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?
}
```

---

## SSO Integration

### SsoProvider

Stores OIDC / SAML provider configuration. `clientId` and `clientSecret` are encrypted before storage.

```prisma
model SsoProvider {
  id                    String   @id @default(cuid())
  providerId            String   @unique   // e.g. "authentik-main"
  type                  String   @default("oidc") // "oidc" | "saml"
  domain                String?            // Email domain for user matching
  domainVerified        Boolean  @default(false)

  // Managed by better-auth
  oidcConfig            String?            // JSON: issuer, clientId, clientSecret, etc.
  samlConfig            String?

  // Legacy UI-sync fields
  issuer                String?
  authorizationEndpoint String?
  tokenEndpoint         String?
  userInfoEndpoint      String?
  jwksEndpoint          String?

  // Credentials (encrypted)
  clientId              String?
  clientSecret          String?

  // DBackup-specific
  adapterId             String             // e.g. "authentik" | "pocket-id" | "keycloak" | "generic"
  adapterConfig         String?            // JSON: raw adapter inputs (e.g. { url, realm })
  name                  String             // Display name
  enabled               Boolean  @default(true)
  allowProvisioning     Boolean  @default(true) // Auto-create new users on first SSO login

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

---

## System & Monitoring Models

### SystemSetting

Key-value store for application configuration. All settings are persisted here at runtime.

```prisma
model SystemSetting {
  key         String   @id
  value       String
  description String?
  updatedAt   DateTime @updatedAt
}
```

Common keys:

| Key | Description |
| :-- | :---------- |
| `maxConcurrentJobs` | Queue concurrency limit (default: `1`) |
| `authPoints` / `authDuration` | Auth rate limit config |
| `apiPoints` / `apiDuration` | API rate limit config |
| `mutationPoints` / `mutationDuration` | Mutation rate limit config |
| `notification.logRetentionDays` | How long to keep notification logs |

### HealthCheckLog

One record per adapter per health check cycle. Cleaned up periodically by the `CLEAN_OLD_LOGS` task.

```prisma
model HealthCheckLog {
  id              String   @id @default(uuid())
  adapterConfigId String
  status          String              // "ONLINE" | "DEGRADED" | "OFFLINE"
  latencyMs       Int                 // Response time in ms
  error           String?             // Error message if check failed
  createdAt       DateTime @default(now())

  adapterConfig   AdapterConfig @relation(...)

  @@index([adapterConfigId, createdAt])
}
```

### DbVersionHistory

Records database engine version changes detected by the `UPDATE_DB_VERSIONS` system task. A new row is inserted only when the detected version differs from the latest entry for that adapter.

```prisma
model DbVersionHistory {
  id              String   @id @default(uuid())
  adapterConfigId String
  previousVersion String?  // null for the first recorded entry
  newVersion      String
  edition         String?  // Adapter-specific info (e.g. MSSQL edition)
  detectedAt      DateTime @default(now())

  adapterConfig   AdapterConfig @relation(...)

  @@index([adapterConfigId, detectedAt])
}
```

### AuditLog

Tracks user and system actions for compliance.

```prisma
model AuditLog {
  id         String   @id @default(uuid())
  userId     String?             // Nullable for system actions or deleted users
  action     String              // "LOGIN" | "CREATE" | "UPDATE" | "DELETE"
  resource   String              // "USER" | "JOB" | "SOURCE" | "DESTINATION" | "SETTINGS" | etc.
  resourceId String?
  details    String?             // JSON: action details / diff
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())

  user       User?    @relation(...)

  @@index([userId])
  @@index([resource])
  @@index([createdAt])
}
```

### StorageSnapshot

Point-in-time snapshot of storage usage per adapter. Created by the `REFRESH_STORAGE_STATS` system task. Used by the storage alert system to detect usage spikes.

```prisma
model StorageSnapshot {
  id              String   @id @default(uuid())
  adapterConfigId String
  adapterName     String
  adapterId       String              // e.g. "local" | "s3" | "dropbox"
  size            BigInt   @default(0) // Total bytes used
  count           Int      @default(0) // Number of files

  createdAt       DateTime @default(now())

  @@index([adapterConfigId])
  @@index([createdAt])
}
```

### StorageListCache

Caches the file listing of a storage destination for fast UI display. One row per adapter (keyed by `adapterConfigId`). Invalidated on upload, delete, or explicit refresh.

```prisma
model StorageListCache {
  adapterConfigId String        @id
  filesJson       String        // JSON: cached file listing
  cachedAt        DateTime      @default(now())

  adapterConfig   AdapterConfig @relation(...)
}
```

### NotificationLog

Records every notification sent through any adapter for audit and debugging. The rendered payloads allow preview rendering without re-generating them.

```prisma
model NotificationLog {
  id              String   @id @default(uuid())
  eventType       String              // e.g. "BACKUP_SUCCESS" | "USER_LOGIN"
  channelId       String?             // AdapterConfig.id (null if channel was deleted)
  channelName     String              // Display name snapshot at send time
  adapterId       String              // "discord" | "email" | "slack" | etc.
  status          String              // "Success" | "Failed"
  title           String              // Notification title / email subject
  message         String              // Plain text body
  fields          String?             // JSON array of { name, value, inline? }
  color           String?             // Hex color
  renderedHtml    String?             // Pre-rendered HTML (email only)
  renderedPayload String?             // JSON: adapter-specific payload (Discord embed, Slack blocks, etc.)
  error           String?             // Error message if send failed
  executionId     String?             // Linked Execution ID
  sentAt          DateTime @default(now())

  @@index([eventType])
  @@index([adapterId])
  @@index([sentAt])
  @@index([executionId])
}
```

**Notes:**
- Logging is fire-and-forget — failures are caught and never block notification delivery
- `channelName` is a snapshot so the log remains readable after a channel is renamed or deleted
- Records are cleaned up by the `CLEAN_OLD_LOGS` system task based on `notification.logRetentionDays`

---

## Common Operations

### Prisma Commands

```bash
# Start dev server — applies all pending migrations automatically
pnpm dev

# Create a new migration (stop pnpm dev first)
npx prisma migrate dev --name <description>

# Reset dev database from scratch
pnpm run database:reset

# Open Prisma Studio
npx prisma studio
```

::: danger Never use `prisma db push`
See [Project Setup](/developer-guide/setup#database-setup) for the full explanation.
:::

### Example Queries

```typescript
// Get all jobs with destinations and source
const jobs = await prisma.job.findMany({
  include: {
    source: true,
    destinations: { include: { config: true, retentionPolicy: true } },
    encryptionProfile: true,
    namingTemplate: true,
    schedulePreset: true,
    notifications: true,
  },
});

// Get user with permissions
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: { group: true },
});
const permissions = JSON.parse(user.group?.permissions || "[]");

// Get recent executions
const executions = await prisma.execution.findMany({
  where: { status: "Success" },
  orderBy: { startedAt: "desc" },
  take: 10,
  include: { job: true },
});

// Get health history for an adapter
const logs = await prisma.healthCheckLog.findMany({
  where: { adapterConfigId: id },
  orderBy: { createdAt: "desc" },
  take: 100,
});
```

## Related Documentation

- [Project Setup](/developer-guide/setup)
- [Service Layer](/developer-guide/core/services)
- [Permission System](/developer-guide/advanced/permissions)
- [Credential Profiles](/developer-guide/advanced/credential-profiles)
- [Health Check System](/developer-guide/advanced/healthcheck)
- [Storage Alerts](/developer-guide/core/storage-alerts)
