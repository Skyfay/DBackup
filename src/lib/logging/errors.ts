/**
 * Custom Error Classes for DBackup
 *
 * Provides a consistent error hierarchy for the entire application.
 * All errors extend from DBackupError which provides:
 * - Error codes for programmatic handling
 * - Contextual metadata for debugging
 * - JSON serialization for logging
 * - Cause chaining for error wrapping
 */

// ============================================================================
// Base Error
// ============================================================================

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

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serializes the error for logging/API responses
   */
  toJSON(): Record<string, unknown> {
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
    (this as { code: string }).code = "CONNECTION_ERROR";
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
    (this as { code: string }).code = "CONFIGURATION_ERROR";
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
    options?: {
      cause?: Error;
      code?: string;
      context?: Record<string, unknown>;
    }
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
  public readonly resource: string;
  public readonly identifier: string;

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
    this.resource = resource;
    this.identifier = identifier;
  }
}

/**
 * Error thrown when an operation conflicts with current state.
 * Maps to HTTP 409 Conflict (e.g. trying to delete a resource that is still referenced).
 */
export class ConflictError extends DBackupError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, "CONFLICT", options);
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
    /** `message` says why in words of its own, like that All tenants only reads, in place of the permission. */
    options?: { cause?: Error; context?: Record<string, unknown>; message?: string }
  ) {
    const { message, ...rest } = options ?? {};
    super(
      message ?? `Permission denied: ${requiredPermission} required`,
      "PERMISSION_DENIED",
      { ...rest, context: { ...rest.context, requiredPermission } }
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

/**
 * Thrown when a backup cannot be opened because no available key fits it.
 *
 * Deliberately distinct from EncryptionError: this is not a malfunction but a question for
 * the user, who may hold a key the vault does not. Every entry point turns it into the same
 * 422 with the profile id the backup names, so one recovery dialog can answer it no matter
 * which flow ran into it.
 */
export class EncryptionKeyRequiredError extends DBackupError {
  /** The profile the backup's metadata names, so the dialog can show what was looked for. */
  public readonly profileId?: string;

  constructor(
    message: string,
    profileId?: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, "ENCRYPTION_KEY_REQUIRED", {
      ...options,
      context: { ...options?.context, profileId },
    });
    this.profileId = profileId;
  }
}

// ============================================================================
// Queue Errors
// ============================================================================

/**
 * Error thrown during queue operations
 */
export class QueueError extends DBackupError {
  public readonly queueOperation: string;

  constructor(
    queueOperation: string,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, "QUEUE_ERROR", {
      ...options,
      context: { ...options?.context, queueOperation },
    });
    this.queueOperation = queueOperation;
  }
}

// ============================================================================
// API Key Errors
// ============================================================================

/**
 * Error thrown during API key authentication or management
 */
export class ApiKeyError extends DBackupError {
  public readonly reason: string;

  constructor(
    reason: string,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, "API_KEY_ERROR", {
      ...options,
      context: { ...options?.context, reason },
    });
    this.reason = reason;
  }
}

// ============================================================================
// Tenant Errors
// ============================================================================

/**
 * Thrown when tenant data is read or written without a tenant, or across one. It stands for a
 * bug, never for something the user did, since handing out every row instead would be a leak.
 */
export class TenantScopeError extends DBackupError {
  public readonly model: string;

  constructor(model: string, message = `${model} was queried outside a tenant`) {
    super(message, "TENANT_SCOPE_ERROR", { isOperational: false, context: { model } });
    this.model = model;
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
 * Wraps an unknown error into a DBackupError.
 * Use this in catch blocks to ensure consistent error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   const wrapped = wrapError(error);
 *   logger.error("Operation failed", { code: wrapped.code }, wrapped);
 *   return failureFromError(wrapped);
 * }
 * ```
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
 * Extracts error message from any error type.
 * Safe to use with unknown error types.
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

/**
 * Extracts error code from any error type.
 * Returns "UNKNOWN_ERROR" for non-DBackupError types.
 */
export function getErrorCode(error: unknown): string {
  if (isDBackupError(error)) {
    return error.code;
  }
  return "UNKNOWN_ERROR";
}

/**
 * Creates an error with context from an existing error.
 * Useful for adding context when re-throwing errors.
 *
 * @example
 * ```typescript
 * try {
 *   await adapter.connect();
 * } catch (error) {
 *   throw withContext(error, { adapterId: "mysql", host: config.host });
 * }
 * ```
 */
export function withContext(
  error: unknown,
  context: Record<string, unknown>
): DBackupError {
  const wrapped = wrapError(error);

  return new DBackupError(wrapped.message, wrapped.code, {
    cause: wrapped.cause instanceof Error ? wrapped.cause : undefined,
    isOperational: wrapped.isOperational,
    context: { ...wrapped.context, ...context },
  });
}
