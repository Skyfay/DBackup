import { ConflictError, NotFoundError, PermissionError, ServiceError, ValidationError, wrapError } from "./errors";
import type { LogContext } from "./logger";

/** The part of a logger this needs, like a `logger.child`. */
type ErrorLog = { error: (message: string, context?: LogContext, error?: Error) => void };

/**
 * Whether DBackup wrote the message of an error for the person who acts: a refusal, a conflict, a
 * record that is gone or a check of a service. The words of anything else, like a driver, the file
 * system or the database, may name hosts, paths or secrets, so they stay in the log.
 */
export function isUserMessage(error: unknown): error is Error {
    return error instanceof ValidationError
        || error instanceof ConflictError
        || error instanceof NotFoundError
        || error instanceof PermissionError
        || error instanceof ServiceError;
}

/**
 * What an action answers for an error: its message when it was written for the user, else the
 * fixed sentence, and that error goes to the log with `wrapError`.
 */
export function userMessage(error: unknown, fallback: string, log: ErrorLog, what: string, context: LogContext = {}): string {
    if (isUserMessage(error)) return error.message;
    log.error(what, context, wrapError(error));
    return fallback;
}
