/**
 * One answer for a request a permission check refused.
 *
 * `checkPermissionWithContext` throws a `PermissionError`. Thrown outside the try of a route, or
 * caught by a catch that only knows other errors, it answered 500, as if DBackup broke, where the
 * caller was only not allowed.
 */

import { ConflictError, NotFoundError, PermissionError, ValidationError } from "@/lib/logging/errors";

/**
 * Turns a caught error into the 403 answer, or returns null when it is something else and the
 * caller's own error handling should take over.
 */
export function permissionRefusal(error: unknown): Response | null {
    if (!(error instanceof PermissionError)) return null;
    // Both shapes, since the clients of these routes read `error` or `message`.
    return Response.json({ success: false, error: error.message, message: error.message }, { status: 403 });
}

/**
 * Like `permissionRefusal`, and a `ValidationError` answers 400 with its sentence, for a route that
 * tries a connection, where a refused host, like one in the local network of a tenant that may not
 * reach it, is the caller's to fix and no failure of DBackup.
 */
export function requestRefusal(error: unknown): Response | null {
    const refusal = permissionRefusal(error);
    if (refusal) return refusal;
    if (!(error instanceof ValidationError)) return null;
    return Response.json({ success: false, error: error.message, message: error.message }, { status: 400 });
}

/**
 * Runs the permission checks of a route and answers 403 when one refuses, null when all pass.
 *
 * @example
 * ```typescript
 * const refused = refusedUnless(() => checkPermissionWithContext(ctx, PERMISSIONS.JOBS.WRITE));
 * if (refused) return refused;
 * ```
 */
export function refusedUnless(check: () => void): Response | null {
    try {
        check();
        return null;
    } catch (error: unknown) {
        const refusal = permissionRefusal(error);
        if (refusal) return refusal;
        throw error;
    }
}

/**
 * Like `requestRefusal`, and a record that is gone answers 404, a conflict like a run that still
 * waits 409, each with the sentence of the service. For the routes over the rules of the platform,
 * like `/api/tenants`, whose services refuse with these errors.
 */
export function serviceRefusal(error: unknown): Response | null {
    const status = refusalStatus(error);
    if (!status) return null;
    const message = (error as Error).message;
    return Response.json({ success: false, error: message, message }, { status });
}

/** The status `serviceRefusal` answers an error with, null for an error that is no refusal. */
export function refusalStatus(error: unknown): 400 | 403 | 404 | 409 | null {
    if (error instanceof PermissionError) return 403;
    if (error instanceof ValidationError) return 400;
    if (error instanceof NotFoundError) return 404;
    if (error instanceof ConflictError) return 409;
    return null;
}
