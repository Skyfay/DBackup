# Database Schema

DBackup uses Prisma ORM with SQLite for application data storage.

## Schema Location

```
prisma/schema.prisma
```

## Entity Relationship

```
┌─────────────────┐     ┌─────────────────┐
│      User       │────▶│      Group      │
│                 │     │  (permissions)  │
└────────┬────────┘     └─────────────────┘
         │
         │ has
         ▼
┌─────────────────┐     ┌─────────────────┐
│    Session      │     │    Account      │
│    Passkey      │     │   TwoFactor     │
└─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│      Job        │────▶│  Destination    │
│                 │────▶│    (Adapter)    │
│                 │────▶│    Source       │
│                 │────▶│   (Adapter)     │
└────────┬────────┘     └─────────────────┘
         │
         │ has many
         ▼
┌─────────────────┐
│   Execution     │
│  (logs, status) │
└─────────────────┘

┌─────────────────┐
│ EncryptionProfile│
└─────────────────┘
```

## Core Models

### AdapterConfig

Stores database sources, storage destinations, and notification configurations.

```prisma
model AdapterConfig {
  id        String   @id @default(uuid())
  name      String              // Display name
  type      String              // "database", "storage", "notification"
  adapterId String              // "mysql", "postgresql", "s3", "discord", etc.
  config    String              // JSON: encrypted configuration
  metadata  String?             // JSON: non-sensitive runtime data
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Health monitoring
  lastHealthCheck     DateTime?
  lastStatus          String    @default("ONLINE")
  consecutiveFailures Int       @default(0)

  // Relations
  jobsDestination  Job[]  @relation("Destination")
  jobsSource       Job[]  @relation("Source")
  jobsNotification Job[]  @relation("Notifications")
  healthLogs       HealthCheckLog[]
}
```

**Notes:**
- `config` contains encrypted JSON with adapter-specific settings
- `type` determines UI placement (Sources/Destinations/Notifications)
- Health status tracks connection reliability

### Job

Defines backup job configuration.

```prisma
model Job {
  id                  String   @id @default(uuid())
  name                String              // Job display name
  schedule            String              // Cron expression
  enabled             Boolean  @default(true)
  compression         String   @default("NONE")  // "NONE", "GZIP", "BROTLI"
  retention           String   @default("{}")    // JSON: RetentionConfiguration
  notificationEvents  String   @default("ALWAYS") // "ALWAYS", "FAILURE_ONLY", "SUCCESS_ONLY"
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // Relations
  sourceId            String
  destinationId       String
  encryptionProfileId String?

  source              AdapterConfig       @relation("Source", fields: [sourceId])
  destination         AdapterConfig       @relation("Destination", fields: [destinationId])
  encryptionProfile   EncryptionProfile?  @relation(fields: [encryptionProfileId])
  notifications       AdapterConfig[]     @relation("Notifications")
  executions          Execution[]
}
```

### Execution

Records each backup/restore operation.

```prisma
model Execution {
  id        String    @id @default(uuid())
  jobId     String?               // Nullable for manual restores
  type      String    @default("Backup")  // "Backup" or "Restore"
  status    String                // "Pending", "Running", "Success", "Failed"
  logs      String                // JSON array of log entries
  startedAt DateTime  @default(now())
  endedAt   DateTime?
  size      BigInt?               // Backup size in bytes
  path      String?               // Storage path of backup file
  metadata  String?               // JSON: additional execution metadata

  job       Job?      @relation(fields: [jobId])
}
```

### EncryptionProfile

Stores encryption keys for backup encryption.

```prisma
model EncryptionProfile {
  id          String   @id @default(cuid())
  name        String              // Profile display name
  description String?
  secretKey   String              // Encrypted master key
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  jobs        Job[]
}
```

**Note:** `secretKey` is encrypted with the system `ENCRYPTION_KEY` before storage.

## Authentication Models

### User

```prisma
model User {
  id               String     @id
  name             String
  email            String     @unique
  emailVerified    Boolean
  image            String?
  timezone         String     @default("UTC")
  dateFormat       String     @default("P")
  timeFormat       String     @default("p")
  twoFactorEnabled Boolean?
  passkeyTwoFactor Boolean?   @default(false)
  createdAt        DateTime
  updatedAt        DateTime

  // RBAC
  groupId          String?
  group            Group?     @relation(fields: [groupId])

  // Relations
  twoFactor        TwoFactor?
  accounts         Account[]
  passkeys         Passkey[]
  sessions         Session[]
  auditLogs        AuditLog[]
}
```

### Group (RBAC)

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

  user      User     @relation(fields: [userId], onDelete: Cascade)
}
```

### Passkey

```prisma
model Passkey {
  id           String    @id
  name         String?
  publicKey    String
  credentialID String    @unique
  counter      Int
  deviceType   String
  backedUp     Boolean
  transports   String?
  createdAt    DateTime?
  aaguid       String?
  userId       String

  user         User      @relation(fields: [userId], onDelete: Cascade)
}
```

### TwoFactor (TOTP)

```prisma
model TwoFactor {
  id          String @id
  secret      String          // Encrypted TOTP secret
  backupCodes String          // Encrypted backup codes
  userId      String @unique

  user        User   @relation(fields: [userId], onDelete: Cascade)
}
```

## SSO Integration

### SsoProvider

```prisma
model SsoProvider {
  id                String   @id @default(cuid())
  providerId        String   @unique   // e.g. "authentik-main"
  type              String   @default("oidc")
  domain            String?            // For email domain matching
  domainVerified    Boolean  @default(false)

  // OIDC endpoints
  issuer                String?
  authorizationEndpoint String?
  tokenEndpoint         String?
  userInfoEndpoint      String?
  jwksEndpoint          String?

  // Credentials (encrypted)
  clientId          String?
  clientSecret      String?

  // Adapter configuration
  adapterId         String             // e.g. "authentik", "pocket-id"
  adapterConfig     String?            // JSON: raw adapter inputs
  name              String             // Display name
  enabled           Boolean  @default(true)
  allowProvisioning Boolean  @default(true)

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

## System Models

### SystemSetting

Key-value store for application settings.

```prisma
model SystemSetting {
  key         String   @id
  value       String
  description String?
  updatedAt   DateTime @updatedAt
}
```

Common settings:
- `maxConcurrentJobs` - Queue concurrency limit
- `healthCheckInterval` - Adapter health check frequency

### AuditLog

Tracks user actions for compliance.

```prisma
model AuditLog {
  id         String   @id @default(uuid())
  userId     String?              // Nullable for system actions
  action     String               // "LOGIN", "CREATE", "UPDATE", "DELETE"
  resource   String               // "USER", "JOB", "SOURCE", etc.
  resourceId String?
  details    String?              // JSON: action details/diff
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())

  user       User?    @relation(fields: [userId], onDelete: SetNull)

  @@index([userId])
  @@index([resource])
  @@index([createdAt])
}
```

### HealthCheckLog

Records adapter health check results.

```prisma
model HealthCheckLog {
  id              String   @id @default(uuid())
  adapterConfigId String
  status          String              // "ONLINE", "DEGRADED", "OFFLINE"
  latencyMs       Int                 // Response time
  error           String?             // Error message if failed
  createdAt       DateTime @default(now())

  adapterConfig   AdapterConfig @relation(fields: [adapterConfigId], onDelete: Cascade)

  @@index([adapterConfigId, createdAt])
}
```

### NotificationLog

Records every notification sent (per-job and system-wide) for audit and debugging.

```prisma
model NotificationLog {
  id              String   @id @default(uuid())
  eventType       String              // e.g. "BACKUP_SUCCESS", "USER_LOGIN"
  channelId       String?             // AdapterConfig ID of the channel
  channelName     String?             // Display name snapshot
  adapterId       String              // "discord", "email", "slack", etc.
  status          String              // "success" or "error"
  title           String?             // Notification title
  message         String?             // Plain text message body
  fields          String?             // JSON: key-value fields array
  color           String?             // Hex color code
  renderedHtml    String?             // Pre-rendered HTML (email only)
  renderedPayload String?             // JSON: adapter-specific payload (embed, blocks, etc.)
  error           String?             // Error message if send failed
  executionId     String?             // Linked Execution ID (for per-job notifications)
  sentAt          DateTime @default(now())

  @@index([eventType])
  @@index([adapterId])
  @@index([sentAt])
  @@index([executionId])
}
```

**Notes:**
- `renderedPayload` stores the adapter-specific payload (Discord embed, Slack blocks, Teams card) for preview rendering
- `renderedHtml` stores the fully rendered email HTML for iframe preview
- Logging is fire-and-forget — failures are caught and never block notification delivery
- Records are cleaned up by the "Clean Old Data" system task based on `notification.logRetentionDays`

## Common Operations

### Prisma Commands

```bash
# Push schema to database
npx prisma db push

# Generate client
npx prisma generate

# Create migration
npx prisma migrate dev --name description

# Reset database
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio
```

### Example Queries

```typescript
// Get all jobs with relations
const jobs = await prisma.job.findMany({
  include: {
    source: true,
    destination: true,
    encryptionProfile: true,
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
```

## Related Documentation

- [Project Setup](/developer-guide/setup)
- [Service Layer](/developer-guide/core/services)
- [Permission System](/developer-guide/advanced/permissions)
