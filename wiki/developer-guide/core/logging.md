# Logging System

DBackup uses two distinct logging systems:

1. **System Logger** - For application-wide logging (errors, debug info, operations)
2. **Execution Logs** - Structured logs for backup/restore job tracking (UI display)

## System Logger

::: info Added in v0.9.4-beta
The centralized logging system was introduced to replace scattered `console.log` calls throughout the codebase.
:::

### Overview

The system logger provides consistent, level-based logging across the entire application.

**Location**: `src/lib/logger.ts`

### Basic Usage

```typescript
import { logger } from "@/lib/logger";

// Simple logging
logger.info("Backup started");
logger.debug("Processing file", { filename: "backup.sql" });
logger.warn("Connection slow", { latency: 500 });
logger.error("Operation failed", { operation: "upload" }, error);
```

### Child Loggers

For component-specific logging, create a child logger with context:

```typescript
import { logger } from "@/lib/logger";

const log = logger.child({ service: "BackupService" });

// All logs will include { service: "BackupService" }
log.info("Starting backup job", { jobId: "abc123" });
// Output: { level: "info", service: "BackupService", jobId: "abc123", message: "Starting backup job" }
```

### Log Levels

| Level | Usage | When to Use |
|-------|-------|-------------|
| `debug` | Detailed debugging info | Development, troubleshooting |
| `info` | Normal operations | Important state changes |
| `warn` | Non-critical issues | Degraded functionality |
| `error` | Failures | Exceptions, failed operations |

### Environment Configuration

Control log output via the `LOG_LEVEL` environment variable:

```bash
# .env
LOG_LEVEL=debug   # Show all logs (development)
LOG_LEVEL=info    # Default (production)
LOG_LEVEL=warn    # Only warnings and errors
LOG_LEVEL=error   # Only errors
```

### Output Formats

**Development** (colored, human-readable):
```
[2026-02-05T10:30:00.000Z] INFO  [BackupService] Starting backup job { jobId: "abc123" }
```

**Production** (JSON, machine-parseable):
```json
{"timestamp":"2026-02-05T10:30:00.000Z","level":"info","service":"BackupService","message":"Starting backup job","jobId":"abc123"}
```

### Error Handling Integration

The logger integrates with the custom error system:

```typescript
import { logger } from "@/lib/logger";
import { wrapError, AdapterError } from "@/lib/errors";

const log = logger.child({ adapter: "mysql" });

try {
  await connectToDatabase();
} catch (error) {
  // wrapError() converts unknown errors to DBackupError
  log.error("Connection failed", { host: config.host }, wrapError(error));
  throw new AdapterError("mysql", "Failed to connect to database");
}
```

### Best Practices

::: tip Do
- Use child loggers with context (service, adapter, step)
- Include relevant metadata as the second parameter
- Use appropriate log levels
- Use `wrapError()` for error logging
:::

::: warning Don't
- Don't use `console.log`, `console.error`, etc. directly
- Don't log sensitive data (passwords, keys, tokens)
- Don't log inside hot loops (performance impact)
:::

---

## Custom Error Classes

**Location**: `src/lib/errors.ts`

DBackup provides a hierarchy of custom error classes for consistent error handling:

### Error Hierarchy

```
DBackupError (base)
├── AdapterError       - Database/storage adapter failures
├── ConnectionError    - Network/connectivity issues
├── ConfigurationError - Invalid config or settings
├── ServiceError       - Business logic failures
├── NotFoundError      - Resource not found
├── ValidationError    - Input validation failures
├── PermissionError    - RBAC authorization failures
├── AuthenticationError - Login/session failures
├── BackupError        - Backup operation failures
├── RestoreError       - Restore operation failures
├── EncryptionError    - Encryption/decryption failures
└── QueueError         - Job queue failures
```

### Creating Custom Errors

```typescript
import { AdapterError, BackupError, wrapError } from "@/lib/errors";

// Adapter-specific error
throw new AdapterError("mysql", "Connection timeout after 30s");

// Backup operation error
throw new BackupError("Dump failed: insufficient permissions");

// Wrapping unknown errors
try {
  await riskyOperation();
} catch (e) {
  throw wrapError(e); // Converts to DBackupError
}
```

### Utility Functions

```typescript
import {
  isDBackupError,
  getErrorMessage,
  getErrorCode,
  withContext
} from "@/lib/errors";

// Type guard
if (isDBackupError(error)) {
  console.log(error.code); // e.g., "ADAPTER_ERROR"
}

// Safe message extraction
const message = getErrorMessage(unknownError);

// Add context to errors
throw withContext(error, { jobId: "123", attempt: 2 });
```

---

## Execution Logs (Job Tracking)

For backup and restore operations, DBackup uses structured execution logs that are displayed in the UI.

### The LogEntry Structure

**Location**: `src/lib/core/logs.ts`

```typescript
export interface LogEntry {
  timestamp: string;      // ISO 8601 format
  level: LogLevel;        // 'info' | 'success' | 'warning' | 'error'
  type: LogType;          // 'general' | 'command'
  message: string;        // Short, human-readable message
  stage?: string;         // Current execution stage
  details?: string;       // Long output (stdout, stack traces)
  context?: Record<string, any>; // Additional metadata
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error';
export type LogType = 'general' | 'command';
```

### Log Levels

| Level | Usage | UI Color |
|-------|-------|----------|
| `info` | Normal progress messages | Blue |
| `success` | Completed steps | Green |
| `warning` | Non-fatal issues | Orange |
| `error` | Failures | Red |

### Log Types

| Type | Usage | UI Display |
|------|-------|------------|
| `general` | Status messages | Normal text |
| `command` | Shell commands, SQL | Monospace, collapsible |

## Usage in Services

The runner pipeline uses execution logs for job tracking:

### Log Buffer Pattern

```typescript
class BackupRunner {
  private logs: LogEntry[] = [];
  private currentStage: string = 'Initialization';

  private log(
    message: string,
    level: LogLevel = 'info',
    type: LogType = 'general',
    details?: string
  ) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      message,
      level,
      type,
      stage: this.currentStage,
      details,
    };
    this.logs.push(entry);
    this.flushLogs(); // Periodic DB update
  }

  private setStage(stage: string) {
    this.currentStage = stage;
    this.log(`Starting ${stage}`, 'info');
  }
}
```

### Example Usage

```typescript
// Simple info message
this.log('Download started');

// Success with stage
this.setStage('Upload');
this.log('File uploaded successfully', 'success');

// Command with output
this.log(
  'Executing mysqldump',
  'info',
  'command',
  `mysqldump --host=db.example.com --user=backup mydb`
);

// Error with details
this.log(
  'Connection failed',
  'error',
  'general',
  error.stack
);

// Warning
this.log(
  'Slow connection detected',
  'warning',
  'general',
  `Latency: ${latencyMs}ms`
);
```

## Execution Stages

Standard stages used throughout the pipeline:

| Stage | Description |
|-------|-------------|
| `Initialization` | Loading configuration, resolving adapters |
| `Dump` | Creating database dump |
| `Compression` | Applying GZIP/Brotli |
| `Encryption` | Encrypting with vault key |
| `Upload` | Transferring to storage |
| `Retention` | Cleaning up old backups |
| `Completion` | Final cleanup, notifications |

For restore operations:

| Stage | Description |
|-------|-------------|
| `Initialization` | Loading configuration |
| `Download` | Fetching backup file |
| `Decryption` | Decrypting if encrypted |
| `Decompression` | Extracting if compressed |
| `Restore` | Applying to database |
| `Verification` | Optional integrity check |
| `Completion` | Cleanup |

## Log Persistence

### Flushing Strategy

Logs are buffered in memory and flushed to the database periodically:

```typescript
private async flushLogs() {
  // Debounced flush every 500ms
  await db.execution.update({
    where: { id: this.executionId },
    data: { logs: JSON.stringify(this.logs) },
  });
}
```

### Database Storage

```prisma
model Execution {
  id        String   @id
  logs      String   // JSON string of LogEntry[]
  // ...
}
```

### Retrieving Logs

```typescript
const execution = await db.execution.findUnique({
  where: { id: executionId },
});

const logs: LogEntry[] = JSON.parse(execution.logs || '[]');
```

## Frontend Rendering

### Stage Grouping

The UI groups logs by stage for better readability:

```tsx
function ExecutionLogs({ logs }: { logs: LogEntry[] }) {
  const grouped = groupBy(logs, 'stage');

  return (
    <div>
      {Object.entries(grouped).map(([stage, entries]) => (
        <StageSection key={stage} name={stage}>
          {entries.map((log) => (
            <LogLine key={log.timestamp} entry={log} />
          ))}
        </StageSection>
      ))}
    </div>
  );
}
```

### Command Collapsing

Command-type logs show the command itself, with expandable details:

```tsx
function LogLine({ entry }: { entry: LogEntry }) {
  if (entry.type === 'command') {
    return (
      <Collapsible>
        <CollapsibleTrigger>
          <code>{entry.message}</code>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre>{entry.details}</pre>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return <p className={levelStyles[entry.level]}>{entry.message}</p>;
}
```

## Live Progress

For real-time updates during execution:

```typescript
// Server: Update execution with progress
await db.execution.update({
  where: { id },
  data: {
    logs: JSON.stringify(logs),
    progress: {
      stage: currentStage,
      percent: calculatePercent(),
      message: lastLog.message,
    },
  },
});

// Client: Poll for updates
const { data } = useSWR(
  `/api/executions/${id}`,
  fetcher,
  { refreshInterval: 1000 }
);
```
