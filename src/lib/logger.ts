/**
 * Structured Logger for DBackup
 *
 * Provides level-based logging with:
 * - JSON output in production (for log aggregation)
 * - Human-readable output in development
 * - Context support for debugging
 * - Child loggers for service-specific logging
 *
 * @example
 * ```typescript
 * import { logger } from "@/lib/logger";
 *
 * // Basic usage
 * logger.info("User logged in", { userId: "123" });
 * logger.error("Backup failed", { jobId: "456" }, error);
 *
 * // Child logger for services
 * const log = logger.child({ service: "BackupService" });
 * log.info("Starting backup"); // Includes service in context
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
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

interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext, error?: Error) => void;
  error: (message: string, context?: LogContext, error?: Error) => void;
  child: (defaultContext: LogContext) => Logger;
}

// ============================================================================
// Configuration
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Gets the configured log level from environment.
 * Defaults to "info" in production, "debug" in development.
 */
function getConfiguredLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * Determines if a message at the given level should be logged.
 */
function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Formats a log entry for output.
 * - Production: JSON (for log aggregation tools)
 * - Development: Human-readable with colors
 */
function formatLog(entry: LogEntry): string {
  if (process.env.NODE_ENV === "production") {
    return JSON.stringify(entry);
  }

  // Development: Human-readable format
  const levelColors: Record<LogLevel, string> = {
    debug: "\x1b[36m", // Cyan
    info: "\x1b[32m", // Green
    warn: "\x1b[33m", // Yellow
    error: "\x1b[31m", // Red
  };
  const reset = "\x1b[0m";
  const dim = "\x1b[2m";

  const color = levelColors[entry.level];
  const levelStr = entry.level.toUpperCase().padEnd(5);
  const timeStr = entry.timestamp.split("T")[1].replace("Z", "");

  let output = `${dim}${timeStr}${reset} ${color}${levelStr}${reset} ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    output += ` ${dim}${JSON.stringify(entry.context)}${reset}`;
  }

  if (entry.error) {
    output += `\n  ${color}→ ${entry.error.name}: ${entry.error.message}${reset}`;
    if (entry.error.code) {
      output += ` ${dim}[${entry.error.code}]${reset}`;
    }
    if (entry.error.stack && entry.level === "error") {
      // Only show stack for error level
      const stackLines = entry.error.stack.split("\n").slice(1, 4);
      output += `\n${dim}${stackLines.join("\n")}${reset}`;
    }
  }

  return output;
}

// ============================================================================
// Core Logging
// ============================================================================

/**
 * Creates a log entry with all metadata.
 */
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
    // Include code if it's a DBackupError
    if ("code" in error && typeof error.code === "string") {
      entry.error.code = error.code;
    }
  }

  return entry;
}

/**
 * Core log function - writes to appropriate console method.
 */
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

// ============================================================================
// Logger Factory
// ============================================================================

/**
 * Creates a logger instance with optional default context.
 */
function createLogger(defaultContext?: LogContext): Logger {
  const mergeContext = (context?: LogContext): LogContext | undefined => {
    if (!defaultContext && !context) return undefined;
    return { ...defaultContext, ...context };
  };

  return {
    /**
     * Debug level - verbose information for development.
     * Not logged in production unless LOG_LEVEL=debug.
     */
    debug: (message: string, context?: LogContext) => {
      log("debug", message, mergeContext(context));
    },

    /**
     * Info level - general operational information.
     * Default level in production.
     */
    info: (message: string, context?: LogContext) => {
      log("info", message, mergeContext(context));
    },

    /**
     * Warn level - potential issues that don't prevent operation.
     */
    warn: (message: string, context?: LogContext, error?: Error) => {
      log("warn", message, mergeContext(context), error);
    },

    /**
     * Error level - failures that need attention.
     * Always includes stack trace in development.
     */
    error: (message: string, context?: LogContext, error?: Error) => {
      log("error", message, mergeContext(context), error);
    },

    /**
     * Creates a child logger with preset context.
     * Useful for service-specific logging.
     *
     * @example
     * ```typescript
     * const log = logger.child({ service: "BackupService" });
     * log.info("Job started", { jobId: "123" });
     * // Output includes: { service: "BackupService", jobId: "123" }
     * ```
     */
    child: (childContext: LogContext): Logger => {
      return createLogger({ ...defaultContext, ...childContext });
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Default logger instance.
 * Use directly for simple logging or create a child for service-specific logging.
 */
export const logger = createLogger();

/**
 * Creates a new logger with default context.
 * Alias for logger.child() for explicit factory usage.
 */
export function createChildLogger(context: LogContext): Logger {
  return createLogger(context);
}
