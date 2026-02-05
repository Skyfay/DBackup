# Error Handling & Logging Rework

**Version:** 1.0
**Datum:** 5. Februar 2026
**Status:** Geplant
**Ziel:** Konsistentes Error Handling und strukturiertes Logging für das gesamte Projekt

---

## Übersicht

### Aktuelle Probleme

| Problem | Auswirkung |
|---------|------------|
| **Inkonsistentes Error Handling** | Catch-Blöcke behandeln Fehler unterschiedlich (re-throw, log+return, silent fail) |
| **80+ `console.log/error` Aufrufe** | Keine strukturierten Logs, kein Log-Level-Management |
| **`any`-Typen in Catch-Blöcken** | Keine Type-Safety bei Fehlerbehandlung |
| **Keine Fehler-Klassifizierung** | Keine Unterscheidung zwischen User-Fehlern und System-Fehlern |

### Lösung

1. **Custom Error Classes** - Hierarchische Fehlerklassen für alle Bereiche
2. **Logger Utility** - Level-basiertes Logging mit strukturierter Ausgabe
3. **ServiceResult Type** - Einheitlicher Return-Type für alle Service-Operationen
4. **Schrittweise Migration** - Bestehenden Code iterativ umstellen
5. **Lint-Guard Unit Tests** - Automatische Erkennung von `console.log` Verwendung

---

## Phase 1: Custom Error Classes

**Aufwand:** 1-2 Stunden
**Datei:** `src/lib/errors.ts`

### Hierarchie

```
DBackupError (Base)
├── AdapterError
│   ├── ConnectionError
│   └── ConfigurationError
├── ServiceError
│   └── NotFoundError
├── ValidationError
├── PermissionError
├── AuthenticationError
├── BackupError
├── RestoreError
└── EncryptionError
```

### Implementation

```typescript
// src/lib/errors.ts

/**
 * Base error class for all DBackup errors.
 * Provides consistent error structure across the application.
 */
export class DBackupError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    options?: {
      cause?: Error;
      isOperational?: boolean;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    this.timestamp = new Date();
    this.context = options?.context;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }
}

// ============================================================================
// Adapter Errors
// ============================================================================

/**
 * Error thrown by database/storage/notification adapters
 */
export class AdapterError extends DBackupError {
  public readonly adapterId: string;
  public readonly operation: string;

  constructor(
    adapterId: string,
    operation: string,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(`[${adapterId}] ${operation}: ${message}`, "ADAPTER_ERROR", {
      ...options,
      context: { ...options?.context, adapterId, operation },
    });
    this.adapterId = adapterId;
    this.operation = operation;
  }
}

/**
 * Error thrown when adapter connection fails
 */
export class ConnectionError extends AdapterError {
  constructor(
    adapterId: string,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(adapterId, "connect", message, options);
    this.code = "CONNECTION_ERROR";
  }
}

/**
 * Error thrown when adapter configuration is invalid
 */
export class ConfigurationError extends AdapterError {
  constructor(
    adapterId: string,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(adapterId, "configure", message, options);
    this.code = "CONFIGURATION_ERROR";
  }
}

// ============================================================================
// Service Errors
// ============================================================================

/**
 * Error thrown by service layer operations
 */
export class ServiceError extends DBackupError {
  public readonly service: string;
  public readonly operation: string;

  constructor(
    service: string,
    operation: string,
    message: string,
    options?: { cause?: Error; code?: string; context?: Record<string, unknown> }
  ) {
    super(message, options?.code ?? "SERVICE_ERROR", {
      ...options,
      context: { ...options?.context, service, operation },
    });
    this.service = service;
    this.operation = operation;
  }
}

/**
 * Error thrown when a resource is not found
 */
export class NotFoundError extends ServiceError {
  constructor(
    resource: string,
    identifier: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super("resource", "find", `${resource} not found: ${identifier}`, {
      ...options,
      code: "NOT_FOUND",
      context: { ...options?.context, resource, identifier },
    });
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends DBackupError {
  public readonly field?: string;
  public readonly details?: Record<string, string[]>;

  constructor(
    message: string,
    options?: {
      field?: string;
      details?: Record<string, string[]>;
      cause?: Error;
    }
  ) {
    super(message, "VALIDATION_ERROR", {
      cause: options?.cause,
      context: { field: options?.field, details: options?.details },
    });
    this.field = options?.field;
    this.details = options?.details;
  }
}

// ============================================================================
// Authorization Errors
// ============================================================================

/**
 * Error thrown when user lacks required permission
 */
export class PermissionError extends DBackupError {
  public readonly requiredPermission: string;

  constructor(
    requiredPermission: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(
      `Permission denied: ${requiredPermission} required`,
      "PERMISSION_DENIED",
      { ...options, context: { ...options?.context, requiredPermission } }
    );
    this.requiredPermission = requiredPermission;
  }
}

/**
 * Error thrown when user is not authenticated
 */
export class AuthenticationError extends DBackupError {
  constructor(message = "Authentication required") {
    super(message, "AUTHENTICATION_REQUIRED", { isOperational: true });
  }
}

// ============================================================================
// Backup/Restore Errors
// ============================================================================

/**
 * Error thrown during backup operations
 */
export class BackupError extends DBackupError {
  public readonly jobId?: string;
  public readonly executionId?: string;
  public readonly step?: string;

  constructor(
    message: string,
    options?: {
      jobId?: string;
      executionId?: string;
      step?: string;
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, "BACKUP_ERROR", {
      cause: options?.cause,
      context: {
        ...options?.context,
        jobId: options?.jobId,
        executionId: options?.executionId,
        step: options?.step,
      },
    });
    this.jobId = options?.jobId;
    this.executionId = options?.executionId;
    this.step = options?.step;
  }
}

/**
 * Error thrown during restore operations
 */
export class RestoreError extends DBackupError {
  public readonly executionId?: string;
  public readonly sourcePath?: string;

  constructor(
    message: string,
    options?: {
      executionId?: string;
      sourcePath?: string;
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, "RESTORE_ERROR", {
      cause: options?.cause,
      context: {
        ...options?.context,
        executionId: options?.executionId,
        sourcePath: options?.sourcePath,
      },
    });
    this.executionId = options?.executionId;
    this.sourcePath = options?.sourcePath;
  }
}

// ============================================================================
// Encryption Errors
// ============================================================================

/**
 * Error thrown during encryption/decryption operations
 */
export class EncryptionError extends DBackupError {
  public readonly operation: "encrypt" | "decrypt";

  constructor(
    operation: "encrypt" | "decrypt",
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, "ENCRYPTION_ERROR", {
      ...options,
      context: { ...options?.context, operation },
    });
    this.operation = operation;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Type guard to check if an error is a DBackupError
 */
export function isDBackupError(error: unknown): error is DBackupError {
  return error instanceof DBackupError;
}

/**
 * Wraps an unknown error into a DBackupError
 */
export function wrapError(
  error: unknown,
  fallbackMessage = "An unexpected error occurred"
): DBackupError {
  if (isDBackupError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new DBackupError(error.message, "UNKNOWN_ERROR", {
      cause: error,
      isOperational: false,
    });
  }

  return new DBackupError(
    typeof error === "string" ? error : fallbackMessage,
    "UNKNOWN_ERROR",
    { isOperational: false }
  );
}

/**
 * Extracts error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (isDBackupError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred";
}
```

---

## Phase 2: Logger Utility

**Aufwand:** 1-2 Stunden
**Datei:** `src/lib/logger.ts`

### Features

- Level-basiertes Logging (`debug`, `info`, `warn`, `error`)
- Strukturierte JSON-Ausgabe in Production
- Human-readable Format in Development
- Child-Logger mit vordefiniertem Kontext
- Umgebungsvariable `LOG_LEVEL` für Konfiguration

### Implementation

```typescript
// src/lib/logger.ts

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatLog(entry: LogEntry): string {
  // In production, use JSON for machine parsing
  if (process.env.NODE_ENV === "production") {
    return JSON.stringify(entry);
  }

  // In development, use human-readable format
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
  let output = `${prefix} ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    output += ` ${JSON.stringify(entry.context)}`;
  }

  if (entry.error) {
    output += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
    if (entry.error.stack) {
      output += `\n${entry.error.stack}`;
    }
  }

  return output;
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if ("code" in error && typeof error.code === "string") {
      entry.error.code = error.code;
    }
  }

  return entry;
}

function log(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): void {
  if (!shouldLog(level)) return;

  const entry = createLogEntry(level, message, context, error);
  const formatted = formatLog(entry);

  switch (level) {
    case "debug":
    case "info":
      console.log(formatted);
      break;
    case "warn":
      console.warn(formatted);
      break;
    case "error":
      console.error(formatted);
      break;
  }
}

/**
 * Application logger with level-based filtering and structured output.
 *
 * @example
 * ```typescript
 * logger.info("User logged in", { userId: "123" });
 * logger.error("Backup failed", { jobId: "456" }, error);
 * ```
 */
export const logger = {
  debug: (message: string, context?: LogContext) => {
    log("debug", message, context);
  },

  info: (message: string, context?: LogContext) => {
    log("info", message, context);
  },

  warn: (message: string, context?: LogContext, error?: Error) => {
    log("warn", message, context, error);
  },

  error: (message: string, context?: LogContext, error?: Error) => {
    log("error", message, context, error);
  },

  /**
   * Creates a child logger with preset context
   */
  child: (defaultContext: LogContext) => ({
    debug: (message: string, context?: LogContext) => {
      log("debug", message, { ...defaultContext, ...context });
    },
    info: (message: string, context?: LogContext) => {
      log("info", message, { ...defaultContext, ...context });
    },
    warn: (message: string, context?: LogContext, error?: Error) => {
      log("warn", message, { ...defaultContext, ...context }, error);
    },
    error: (message: string, context?: LogContext, error?: Error) => {
      log("error", message, { ...defaultContext, ...context }, error);
    },
  }),
};

export type { LogLevel, LogContext, LogEntry };
```

### Umgebungsvariablen

```bash
# .env
LOG_LEVEL=debug  # debug | info | warn | error
```

---

## Phase 3: ServiceResult Type

**Aufwand:** 1 Stunde
**Datei:** `src/lib/types/service-result.ts`

### Konzept

Einheitlicher Return-Type für alle Service-Operationen, der explizites Handling von Success/Failure erzwingt.

### Implementation

```typescript
// src/lib/types/service-result.ts

import { DBackupError } from "@/lib/errors";

/**
 * Standardized result type for all service operations.
 * Forces explicit handling of success and failure cases.
 */
export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; details?: unknown };

/**
 * Creates a successful service result
 */
export function success<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

/**
 * Creates a failed service result from a string message
 */
export function failure(
  error: string,
  code?: string,
  details?: unknown
): ServiceResult<never> {
  return { success: false, error, code, details };
}

/**
 * Creates a failed service result from an Error
 */
export function failureFromError(error: unknown): ServiceResult<never> {
  if (error instanceof DBackupError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      details: error.context,
    };
  }

  if (error instanceof Error) {
    return { success: false, error: error.message };
  }

  return { success: false, error: "An unexpected error occurred" };
}

/**
 * Type guard to check if result is successful
 */
export function isSuccess<T>(
  result: ServiceResult<T>
): result is { success: true; data: T } {
  return result.success === true;
}

/**
 * Type guard to check if result is a failure
 */
export function isFailure<T>(
  result: ServiceResult<T>
): result is { success: false; error: string; code?: string } {
  return result.success === false;
}
```

---

## Phase 4: Migration bestehender Code

**Aufwand:** 4-8 Stunden (iterativ)

### Priorität 1: Critical Services

| Service | Datei | Priorität |
|---------|-------|-----------|
| BackupService | `src/services/backup-service.ts` | Hoch |
| RestoreService | `src/services/restore-service.ts` | Hoch |
| JobService | `src/services/job-service.ts` | Hoch |
| StorageService | `src/services/storage-service.ts` | Mittel |

### Priorität 2: Adapters

| Adapter | Datei |
|---------|-------|
| MySQL | `src/lib/adapters/database/mysql/` |
| PostgreSQL | `src/lib/adapters/database/postgresql/` |
| MongoDB | `src/lib/adapters/database/mongodb/` |

### Priorität 3: Runner Pipeline

| Step | Datei |
|------|-------|
| All Steps | `src/lib/runner/steps/*.ts` |

### Beispiel-Migration

**Vorher:**
```typescript
async runJob(jobId: string) {
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      console.error("Job not found:", jobId);
      return { success: false, error: "Job not found" };
    }
    // ...
  } catch (e: any) {
    console.error("Error running job:", e);
    return { success: false, error: e.message };
  }
}
```

**Nachher:**
```typescript
import { logger } from "@/lib/logger";
import { NotFoundError, wrapError } from "@/lib/errors";
import { ServiceResult, success, failureFromError } from "@/lib/types/service-result";

const log = logger.child({ service: "BackupService" });

async runJob(jobId: string): Promise<ServiceResult<{ executionId: string }>> {
  log.info("Starting backup job", { jobId });

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const execution = await prisma.execution.create({
      data: { jobId, status: "Pending" },
    });

    log.info("Execution created", { jobId, executionId: execution.id });
    return success({ executionId: execution.id });
  } catch (error) {
    const wrapped = wrapError(error);
    log.error("Failed to run backup job", { jobId }, wrapped);
    return failureFromError(wrapped);
  }
}
```

---

## Phase 5: Lint-Guard Unit Tests

**Aufwand:** 2-3 Stunden
**Datei:** `tests/unit/lint-guards/no-console.test.ts`

### Konzept

Unit Tests, die automatisch erkennen, wenn `console.log/error/warn` direkt im Code verwendet wird, anstatt den offiziellen Logger. Dies verhindert, dass neue Code-Änderungen die Logging-Standards umgehen.

### Implementation

```typescript
// tests/unit/lint-guards/no-console.test.ts

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const SRC_DIR = path.resolve(__dirname, "../../../src");

// Files/patterns that are allowed to use console directly
const ALLOWED_FILES = [
  "src/lib/logger.ts", // Logger itself uses console
  "src/instrumentation.ts", // Next.js instrumentation
];

// Patterns to detect console usage
const CONSOLE_PATTERNS = [
  /console\.log\s*\(/g,
  /console\.error\s*\(/g,
  /console\.warn\s*\(/g,
  /console\.info\s*\(/g,
  /console\.debug\s*\(/g,
];

interface Violation {
  file: string;
  line: number;
  content: string;
  pattern: string;
}

function findConsoleUsage(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: Violation[] = [];

  const relativePath = path.relative(process.cwd(), filePath);

  // Skip allowed files
  if (ALLOWED_FILES.some((allowed) => relativePath.includes(allowed))) {
    return [];
  }

  lines.forEach((line, index) => {
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      return;
    }

    CONSOLE_PATTERNS.forEach((pattern) => {
      if (pattern.test(line)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          content: trimmed,
          pattern: pattern.source,
        });
      }
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
    });
  });

  return violations;
}

describe("Logging Standards", () => {
  it("should not use console.log/error/warn directly in source files", async () => {
    const files = await glob("**/*.{ts,tsx}", {
      cwd: SRC_DIR,
      absolute: true,
      ignore: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"],
    });

    const allViolations: Violation[] = [];

    for (const file of files) {
      const violations = findConsoleUsage(file);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  ${v.file}:${v.line} - ${v.content}`)
        .join("\n");

      expect.fail(
        `Found ${allViolations.length} direct console usage(s). ` +
          `Use 'logger' from '@/lib/logger' instead:\n${report}`
      );
    }

    expect(allViolations).toHaveLength(0);
  });

  it("should use logger.child() for service-specific logging", async () => {
    const serviceFiles = await glob("**/services/*.ts", {
      cwd: SRC_DIR,
      absolute: true,
      ignore: ["**/*.test.ts"],
    });

    const servicesWithoutChildLogger: string[] = [];

    for (const file of serviceFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(process.cwd(), file);

      // Check if file uses logger
      const usesLogger = content.includes("from \"@/lib/logger\"") ||
                         content.includes("from '@/lib/logger'");

      // Check if it creates a child logger (recommended for services)
      const usesChildLogger = content.includes("logger.child(");

      if (usesLogger && !usesChildLogger) {
        servicesWithoutChildLogger.push(relativePath);
      }
    }

    // This is a warning, not a failure (for gradual migration)
    if (servicesWithoutChildLogger.length > 0) {
      console.warn(
        `[INFO] Services using logger without child context:\n` +
          servicesWithoutChildLogger.map((f) => `  - ${f}`).join("\n")
      );
    }
  });
});

describe("Error Handling Standards", () => {
  it("should not use catch (e: any) pattern", async () => {
    const files = await glob("**/*.{ts,tsx}", {
      cwd: SRC_DIR,
      absolute: true,
      ignore: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"],
    });

    const violations: { file: string; line: number; content: string }[] = [];

    // Pattern to detect: catch (e: any) or catch (error: any)
    const catchAnyPattern = /catch\s*\(\s*\w+\s*:\s*any\s*\)/g;

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relativePath = path.relative(process.cwd(), file);

      lines.forEach((line, index) => {
        if (catchAnyPattern.test(line)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            content: line.trim(),
          });
        }
        catchAnyPattern.lastIndex = 0;
      });
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} - ${v.content}`)
        .join("\n");

      // For gradual migration: warn instead of fail
      console.warn(
        `[WARN] Found ${violations.length} 'catch (e: any)' pattern(s). ` +
          `Use 'catch (error)' with wrapError() instead:\n${report}`
      );
    }

    // Uncomment to enforce strictly after migration:
    // expect(violations).toHaveLength(0);
  });

  it("should import error utilities from @/lib/errors when using try-catch", async () => {
    const files = await glob("**/services/*.ts", {
      cwd: SRC_DIR,
      absolute: true,
      ignore: ["**/*.test.ts"],
    });

    const servicesWithTryCatchButNoErrorImport: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(process.cwd(), file);

      const hasTryCatch = /try\s*{/.test(content);
      const hasErrorImport =
        content.includes("from \"@/lib/errors\"") ||
        content.includes("from '@/lib/errors'");

      if (hasTryCatch && !hasErrorImport) {
        servicesWithTryCatchButNoErrorImport.push(relativePath);
      }
    }

    if (servicesWithTryCatchButNoErrorImport.length > 0) {
      console.warn(
        `[INFO] Services with try-catch but no error utilities:\n` +
          servicesWithTryCatchButNoErrorImport.map((f) => `  - ${f}`).join("\n")
      );
    }
  });
});
```

### Test ausführen

```bash
pnpm test tests/unit/lint-guards/no-console.test.ts
```

### CI Integration

Die Tests werden automatisch in der CI-Pipeline ausgeführt und schlagen fehl, wenn:

1. **`console.log/error/warn`** direkt verwendet wird (außer in erlaubten Dateien)
2. **`catch (e: any)`** Pattern verwendet wird (nach vollständiger Migration)

### Schrittweise Einführung

| Schritt | Aktion |
|---------|--------|
| 1 | Tests als `console.warn` (Soft Fail) |
| 2 | Migration abschließen |
| 3 | Tests auf `expect.fail` umstellen (Hard Fail) |

---

## Zusammenfassung

| Phase | Aufwand | Ergebnis |
|-------|---------|----------|
| **Phase 1** | 1-2h | Custom Error Classes in `src/lib/errors.ts` |
| **Phase 2** | 1-2h | Logger Utility in `src/lib/logger.ts` |
| **Phase 3** | 1h | ServiceResult Type in `src/lib/types/service-result.ts` |
| **Phase 4** | 4-8h | Migration bestehender Services (iterativ) |
| **Phase 5** | 2-3h | Lint-Guard Tests zur Durchsetzung der Standards |

### Vorteile

1. ✅ **Konsistenz** - Alle Fehler folgen demselben Pattern
2. ✅ **Type-Safety** - TypeScript erkennt fehlerhafte Fehlerbehandlung
3. ✅ **Debugging** - Strukturierte Logs mit Kontext
4. ✅ **Zukunftssicher** - Einfach erweiterbar (z.B. Pino/Winston später)
5. ✅ **Production-Ready** - JSON-Logs für Log-Aggregation
6. ✅ **Automatische Durchsetzung** - Unit Tests verhindern Rückfall

---

## Nächste Schritte

1. [x] **Phase 1 umsetzen** - Error Classes erstellen ✅ (5. Feb 2026)
2. [x] **Phase 2 umsetzen** - Logger implementieren ✅ (5. Feb 2026)
3. [x] **Phase 3 umsetzen** - ServiceResult Type erstellen ✅ (5. Feb 2026)
4. [ ] **Phase 5 vorbereiten** - Lint-Guard Tests (Soft Fail Mode)
5. [ ] **Phase 4 starten** - Schrittweise Migration
6. [ ] **Phase 5 aktivieren** - Tests auf Hard Fail umstellen
