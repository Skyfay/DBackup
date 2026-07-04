# Healthcheck & Connectivity Monitoring

The Healthcheck system continuously monitors the availability and status of all configured database sources and storage destinations. It ensures that connection issues are detected early and can be tracked historically.

## Architecture

### Data Model

The system extends the Prisma schema with a dedicated log table for health checks and adds caching fields to the `AdapterConfig` model.

```prisma
// Status states for adapters
enum HealthStatus {
  ONLINE    // Connection successful
  DEGRADED  // Transient failures (first/second attempt failed)
  OFFLINE   // Persistent failure (>= 3 consecutive failures)
}

// Log entry for each check cycle
model HealthCheckLog {
  id              String        @id
  adapterConfigId String
  status          HealthStatus
  latencyMs       Int           // Measured latency in milliseconds
  error           String?       // Error message if failed
  createdAt       DateTime

  adapterConfig   AdapterConfig @relation(...)
}

model AdapterConfig {
  // ...existing fields
  lastHealthCheck      DateTime?     // Timestamp of last check
  lastStatus           String        // Cached status: "ONLINE" | "DEGRADED" | "OFFLINE"
  lastError            String?       // Human-readable reason when lastStatus != ONLINE
  consecutiveFailures  Int           // Counter for failure state machine
}
```

### Components Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────────┐
│  System Task    │────▶│ Healthcheck      │────▶│ Adapter.ping()              │
│  (Scheduler)    │     │ Service          │     │ (falls back to .test()      │
└─────────────────┘     └──────────────────┘     │  if ping() not implemented) │
                               │                 └─────────────────────────────┘
                               ▼
                        ┌──────────────────┐
                        │ HealthCheckLog   │
                        │ (Database)       │
                        └──────────────────┘
```

## Backend Service

**Location**: `src/services/system/healthcheck-service.ts`

The core service that performs the actual health checks.

### Constants

```typescript
const ADAPTER_CHECK_TIMEOUT_MS = 15_000; // 15 second timeout per individual adapter check
const MAX_CONCURRENT_CHECKS = 5;         // Max parallel checks to avoid overloading
const DEFAULT_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 h: re-notify interval for persistent offline
```

### Process Flow

1. Loads all configured adapters (database sources and storage destinations)
2. Runs checks concurrently — at most `MAX_CONCURRENT_CHECKS` at once
3. For each adapter: calls `ping()` first; falls back to `test()` if `ping()` is not implemented
4. Each check is wrapped with a `ADAPTER_CHECK_TIMEOUT_MS` timeout to prevent hangs
5. Evaluates status based on result and consecutive failure count
6. Writes a `HealthCheckLog` record and updates the cached fields on `AdapterConfig`
7. Sends an offline notification if the adapter just went `OFFLINE` (with 24 h cooldown for persistent failures)

### `ping()` vs `test()`

`ping()` is a lightweight connectivity check that must not write any files to storage. `test()` is the full write/delete verification. The health check system always prefers `ping()` to avoid polluting storage with test files every minute.

### State Machine

The service implements a failure state machine to avoid flapping between states:

| Condition | Result |
|-----------|--------|
| Success | Status = `ONLINE`, Failures = 0 |
| Failure | Failures + 1 |
| Failures < 3 | Status = `DEGRADED` |
| Failures >= 3 | Status = `OFFLINE` |

```typescript
// Simplified state logic
if (success) {
  status = HealthStatus.ONLINE;
  consecutiveFailures = 0;
} else {
  consecutiveFailures++;
  status = consecutiveFailures >= 3
    ? HealthStatus.OFFLINE
    : HealthStatus.DEGRADED;
}
```

### Retention

Logs are automatically deleted once a day by the `CLEAN_OLD_LOGS` system task, not on every health check run. Default retention is 2 days, configurable via the `healthcheck.logRetentionDays` system setting.

## System Task Integration

**Location**: `src/services/system-task-service.ts`

The healthcheck is integrated as a system task (`system.health_check`).

- **Default Interval**: Every minute (`*/1 * * * *`)
- **Configuration**: Settings → System Tasks
- **Manual Trigger**: Can be run on-demand via UI

## Adapter Integration

Each adapter implements the `test(config)` method from the adapter interface:

```typescript
interface DatabaseAdapter {
  test(config: DatabaseConfig): Promise<TestResult>;
  // ...
}

interface StorageAdapter {
  test(config: StorageConfig): Promise<TestResult>;
  // ...
}
```

### What Gets Tested

The `test()` method performs more than just TCP connectivity:

| Adapter Type | Test Operation |
|--------------|----------------|
| MySQL/MariaDB | `SELECT VERSION()` |
| PostgreSQL | `SELECT version()` |
| MongoDB | `db.admin().ping()` |
| SQLite | File existence + read |
| MSSQL | `SELECT @@VERSION` |
| S3 | `HeadBucket` operation |
| SFTP | Directory listing |
| Local | Directory access check |

## Frontend Components

### Status Badge

Visual indicator displayed in list views:

| Status | Color | Icon |
|--------|-------|------|
| ONLINE | Green | ✓ |
| DEGRADED | Orange | ⚠ |
| OFFLINE | Red | ✗ |
| UNKNOWN | Grey | ? |

### Statistics Display

Shows aggregated metrics:
- **Uptime**: Percentage of successful checks (last 60 entries)
- **Average Latency**: Mean response time in milliseconds
- **Total Checks**: Number of checks in history

### History Grid

Interactive popover grid visualizing the last hour of health checks with color-coded cells.

## API Reference

### Get Health History

```http
GET /api/adapters/[id]/health-history
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Number of entries to return |

**Response:**

```json
{
  "history": [
    {
      "id": "clx123...",
      "status": "ONLINE",
      "latencyMs": 23,
      "createdAt": "2026-01-31T10:00:00Z",
      "error": null
    }
  ],
  "stats": {
    "uptime": 98.5,
    "avgLatency": 45,
    "totalChecks": 60
  }
}
```

## Testing

### Unit Tests

The state transition logic (Online → Degraded → Offline) is verified in:

```
tests/unit/services/healthcheck-service.test.ts
```

### Manual Testing

1. Go to **Settings** → **System Tasks**
2. Find "Health Check & Connectivity"
3. Click **Run Now**
4. Check the terminal logs for output
5. Navigate to **Sources** or **Destinations** - status badges should be updated

## Configuration

The healthcheck interval can be configured per-installation:

```typescript
// Default cron expression (every minute)
const HEALTHCHECK_CRON = '*/1 * * * *';
```

For high-availability setups, consider:
- Reducing interval to 30 seconds
- Increasing `healthcheck.logRetentionDays` beyond the default 2 days
- Adding external monitoring integration
