# Database Schema

DBackup uses Prisma ORM with SQLite for application data storage.

## Schema Location

```
prisma/schema.prisma
```

## Entity Relationship Overview

```
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│       User        │────▶│ TenantMembership  │────▶│       Group       │
│  (platformRole)   │     │  (one per tenant) │     │   (permissions)   │
└────────┬──────────┘     └─────────┬─────────┘     └───────────────────┘
         │ has many                 ▼
         ├──── Session, Account,  ┌───────────────────┐
         │     Passkey, TwoFactor │      Tenant       │──▶ TenantInvitation
         ├──── AuditLog           └───────────────────┘
         └──── ApiKey

Every model below that holds data of a customer carries tenantId, see Tenant Models.

┌──────────────────────────────────────────────────┐
│                   AdapterConfig                  │
│  (database source / storage destination /        │
│   notification channel)                          │
│                                                  │
│  ──▶ CredentialProfile (primary, ssh)            │
│  ──▶ RetentionPolicy (default for destination)   │
│  ──▶ HealthCheckLog, DbVersionHistory            │
│  ──▶ StorageListCache (per tenant)               │
│  ──▶ ConnectionShare ──▶ ConnectionShareTenant   │
│  ──▶ ChannelRecipients                           │
│  ──▶ DatabaseListCache                           │
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
  databaseListCache DatabaseListCache?
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

  platformRole           String?    // "ADMIN" for a platform admin, null for everyone else
  memberships            TenantMembership[]  // The group of the user in each tenant

  twoFactor              TwoFactor?
  accounts               Account[]
  passkeys               Passkey[]
  sessions               Session[]
  auditLogs              AuditLog[]
  apiKeys                ApiKey[]
}
```

### Group

RBAC group of one tenant, whose admins make and change it. `permissions` is a JSON array of permission strings (same format as `ApiKey.permissions`). Who holds it in its tenant is a `TenantMembership`.

```prisma
model Group {
  id          String   @id @default(uuid())
  name        String              // Unique within its tenant
  permissions String              // JSON array of permission strings
  fullAccess  Boolean  @default(false)  // Every permission of a tenant, cannot be edited or deleted
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenantId    String   @default("default")  // The tenant it belongs to
  templateId  String?             // The group for tenants it is in its tenant, changed by the platform alone

  memberships TenantMembership[]
  invitations TenantInvitation[]

  @@unique([tenantId, name])
  @@unique([tenantId, templateId])
}
```

### TenantGroupTemplate

A group the platform makes once for tenants. Each tenant it reaches has a `Group` linked to it, see [Tenants](/developer-guide/advanced/tenants#groups-for-tenants).

```prisma
model TenantGroupTemplate {
  id          String   @id @default(uuid())
  name        String   @unique
  permissions String   @default("[]")    // JSON array, the permissions of a group of a tenant
  allTenants  Boolean  @default(false)   // Every tenant, the ones made later too
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenants     TenantGroupTemplateTenant[] // The tenants it reaches while not every tenant
  groups      Group[]
}
```

### PlatformGroup

A group of the platform for the people of the MSP: rights on the instance and rights in the tenants of its scope, on top of the group someone holds in a tenant. A user holds at most one through `User.platformGroupId`. A platform admin is no row, it is `User.platformRole`. See [Tenants](/developer-guide/advanced/tenants#platform-groups).

```prisma
model PlatformGroup {
  id                  String   @id @default(uuid())
  name                String   @unique
  platformPermissions String   @default("[]")  // JSON array, the rights on the platform
  tenantPermissions   String   @default("[]")  // JSON array, the rights in every tenant of its scope
  allTenants          Boolean  @default(true)  // Every tenant, the ones made later too. Else PlatformGroupTenant
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  members             User[]
  tenants             PlatformGroupTenant[]    // The tenants of its scope while not every tenant
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
  tenantId    String    @default("default")  // The tenant it was made in and acts in
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
  activeTenantId String?  // The tenant this session picked, checked against the memberships

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

## Tenant Models

Every connection, job, run, key, saved login, template, API key and log belongs to one tenant. The models in `TENANT_MODELS` of `src/lib/tenant/prisma-scope.ts` carry a column for it, which the Prisma client fills and filters by itself, see [Tenants](/developer-guide/advanced/tenants):

```prisma
  tenantId  String  @default("default")  // Only fills the rows of the migration
```

`CredentialProfile`, `RetentionPolicy`, `NamingTemplate`, `SchedulePreset`, `ExcludePatternPreset` and `NotificationTemplate` keep their names unique per tenant with `@@unique([tenantId, name])`.

### Tenant

```prisma
model Tenant {
  id                   String   @id @default(cuid())  // "default" for the home tenant
  name                 String   @unique
  sharesWithCustomers  Boolean  @default(false)       // Shares databases, destinations and channels with other tenants, true for the home tenant
  addsDatabases        Boolean  @default(true)        // What it adds itself, set by the platform. Off stops new ones
  addsDirectorySources Boolean  @default(true)
  addsDestinations     Boolean  @default(true)
  addsChannels         Boolean  @default(true)
  addsApiKeys          Boolean  @default(true)
  onDemandPerDay       Int?                           // Backups on demand a day of each database given to it, null for none
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  memberships          TenantMembership[]
  invitations          TenantInvitation[]
  logo                 TenantLogo?
  platformGroups       PlatformGroupTenant[]
}
```

### TenantMembership

```prisma
model TenantMembership {
  userId    String
  tenantId  String
  groupId   String
  createdAt DateTime @default(now())

  @@id([userId, tenantId])
}
```

### TenantInvitation

```prisma
model TenantInvitation {
  id            String    @id @default(cuid())
  tenantId      String
  groupId       String
  tokenHash     String    @unique  // SHA-256 of the token, which is shown once
  note          String?            // Who it is for, only shown
  createdById   String?
  createdByName String?
  createdAt     DateTime  @default(now())
  expiresAt     DateTime
  acceptedAt    DateTime?
  acceptedById  String?
}
```

### DatabaseAssignment

One database of a shared server given to a customer. `tenantId` names the customer without a relation, so the id of a deleted tenant stays, and the row belongs to the tenant of the server through its `SharedServer`.

```prisma
model DatabaseAssignment {
  id              String    @id @default(cuid())
  sourceId        String              // The SharedServer, which outlives the connection of the server
  databaseName    String
  tenantId        String?             // The customer, null when the server's tenant took the database back
  validFrom       DateTime
  validUntil      DateTime?           // Null while it holds, an assignment ends rather than being deleted
  movedToSourceId String?             // Where a move took the database, on the assignment it ended
  movedToDatabase String?
  onDemandPerDay  Int?                // Backups on demand a day: null as Tenant.onDemandPerDay, 0 none, else its own
  createdAt       DateTime  @default(now())  // When it was given, which decides whether a start in the past reaches over another holder
  createdById     String?
}
```

### DatabaseAssignmentRule

```prisma
model DatabaseAssignmentRule {
  id             String    @id @default(cuid())
  sourceId       String
  pattern        String              // A glob like "shop_*"
  tenantId       String              // The customer, without a relation like DatabaseAssignment.tenantId
  priority       Int       @default(0)
  validFrom      DateTime
  validUntil     DateTime?           // When it was removed or its tenant deleted, it still decides the backups of its time
  onDemandPerDay Int?                 // Like DatabaseAssignment.onDemandPerDay, for each database it gives
  createdAt      DateTime  @default(now())
}
```

### SharedBackupRequest

A backup a customer started of a database given to it. It counts towards the backups a day its assignment allows and lets the customer follow the run, which belongs to the tenant of the server and which the customer never opens itself.

```prisma
model SharedBackupRequest {
  id            String   @id @default(cuid())
  sourceId      String              // The SharedServer of the database
  databaseName  String
  executionId   String              // The run of the server's tenant that makes the backup
  requestedById String?
  createdAt     DateTime @default(now())
  tenantId      String              // The customer that asked, in TENANT_MODELS

  @@index([tenantId, sourceId, databaseName, createdAt])
}
```

### ConnectionShare

A destination or a notification channel its tenant shares with other tenants, see [Tenants](/developer-guide/advanced/tenants#shared-destinations-and-channels). Its `id` is the id of the connection, and it goes with the connection.

```prisma
model ConnectionShare {
  id            String                  @id     // The AdapterConfig it shares
  allTenants    Boolean                 @default(false) // Every other tenant, a new one too. Else only ConnectionShareTenant
  encryptedOnly Boolean                 @default(false) // A destination: a customer's job writes to it only with a key
  ownRecipients Boolean                 @default(true)  // An email channel: each customer names its own recipients
  createdAt     DateTime                @default(now())
  updatedAt     DateTime                @updatedAt
  tenantId      String                  // The tenant that shares it

  config        AdapterConfig           @relation(fields: [id], references: [id], onDelete: Cascade)
  tenants       ConnectionShareTenant[]

  @@index([tenantId])
}
```

### ConnectionShareTenant

A tenant a connection is shared with while it is not shared with every tenant. `tenantId` names the customer without a relation, and the row belongs to the tenant that shares through `share`.

```prisma
model ConnectionShareTenant {
  shareId   String
  tenantId  String          // The customer
  createdAt DateTime        @default(now())

  share     ConnectionShare @relation(fields: [shareId], references: [id], onDelete: Cascade)

  @@id([shareId, tenantId])
  @@index([tenantId])
}
```

### ChannelRecipients

The recipients a customer names for an email channel another tenant shares with it. The server, the login and the sender stay with the tenant that shares it.

```prisma
model ChannelRecipients {
  id         String        @id @default(cuid())
  configId   String
  recipients String        // JSON array of email addresses, at most 20
  updatedAt  DateTime      @updatedAt
  tenantId   String        // The customer that names them, not the tenant of the channel

  config     AdapterConfig @relation(fields: [configId], references: [id], onDelete: Cascade)

  @@unique([tenantId, configId])
}
```

---

## SSO Integration

### SsoProvider

Stores OIDC / SAML provider configuration. `clientId` and `clientSecret` are encrypted before storage, and the Prisma client decrypts them on every read, so a read that leaves the server selects its fields. See [SSO / OIDC](/developer-guide/advanced/sso).

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
  defaultGroupId        String?            // The group they start in, null for none

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

Tracks user and system actions for compliance. See [Audit Log System](/developer-guide/advanced/audit).

```prisma
model AuditLog {
  id         String   @id @default(uuid())
  userId     String?             // Null for a failed sign-in or a user deleted before names were kept
  actorName  String?             // The name of the user when the entry was written
  apiKeyId   String?             // The API key the request came with
  apiKeyName String?             // Its name at the time
  action     String              // "LOGIN" | "LOGIN_FAILED" | "CREATE" | "UPDATE" | "RESTORE" | etc.
  resource   String              // "USER" | "JOB" | "BACKUP" | "SYSTEM" | etc.
  resourceId String?
  details    String?             // JSON: name, changes before and after, variant
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())

  user       User?    @relation(...)

  @@index([userId])
  @@index([resource])
  @@index([action])
  @@index([createdAt])
}
```

### StorageSnapshot

Point-in-time snapshot of storage usage per adapter and tenant. Created by the `REFRESH_STORAGE_STATS` system task. Used by the storage alert system to detect usage spikes. A destination shared with customers gets a snapshot for its own tenant and one for each customer, whose backups sit under `tenants/<id>/`.

```prisma
model StorageSnapshot {
  id              String   @id @default(uuid())
  adapterConfigId String
  adapterName     String
  adapterId       String              // e.g. "local" | "s3" | "dropbox"
  size            BigInt   @default(0) // Total bytes used
  count           Int      @default(0) // Number of files
  tenantId        String   @default("default") // The tenant whose backups it counts

  createdAt       DateTime @default(now())

  @@index([adapterConfigId, createdAt])
  @@index([createdAt])
  @@index([tenantId])
}
```

### StorageListCache

Caches the file listing of a storage destination for fast UI display. One row per destination and tenant (keyed by `adapterConfigId` and `tenantId`): a destination shared with customers keeps a listing for its own tenant and one for each customer, each with the backups that tenant sees. Invalidated on upload, delete, or explicit refresh.

```prisma
model StorageListCache {
  adapterConfigId String
  tenantId        String        // The tenant whose backups the listing holds
  filesJson       String        // JSON: cached file listing
  cachedAt        DateTime      @default(now())

  adapterConfig   AdapterConfig @relation(...)

  @@id([adapterConfigId, tenantId])
  @@index([tenantId])
}
```

### DatabaseListCache

Keeps the databases of a database connection for the Database Explorer, so the page opens without asking a server. One row per connection (keyed by `adapterConfigId`). The `UPDATE_DB_VERSIONS` system task refreshes it every hour and `POST /api/databases/read` on demand. A failed read keeps the list and only sets `error`.

```prisma
model DatabaseListCache {
  adapterConfigId String        @id
  databasesJson   String        @default("[]") // JSON: [{ name, sizeInBytes?, tableCount? }]
  readAt          DateTime?     // Last read in full
  error           String?       // Why the latest read failed, null after a good one
  attemptedAt     DateTime      @default(now())

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

// Get what a user may do in a tenant
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: { memberships: { select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } } } },
});
const permissions = permissionsIn(user.memberships, tenantId);

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
