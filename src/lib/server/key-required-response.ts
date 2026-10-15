/**
 * One HTTP shape for "this backup needs a key I do not have".
 *
 * Browsing, analysing, restoring and downloading can all run into it, and the browser
 * answers it the same way every time - by opening the recovery dialog - so they must all
 * report it identically. Before this, each route parsed a marker out of an error message
 * and built its own body, which is why the same situation surfaced as a prompt in one place
 * and as a bare 500 in another.
 *
 * 422 rather than 4xx-generic: the request itself was well formed and permitted, it just
 * cannot be completed without something only the user can supply.
 */

import { EncryptionKeyRequiredError } from "@/lib/logging/errors";

/**
 * Turns a caught error into the key-required response, or returns null when it is
 * something else and the caller's own error handling should take over.
 *
 * @example
 * ```typescript
 * } catch (e: unknown) {
 *     const keyRequired = keyRequiredResponse(e);
 *     if (keyRequired) return keyRequired;
 *     // ... the route's usual handling
 * }
 * ```
 */
export function keyRequiredResponse(error: unknown): Response | null {
    if (!(error instanceof EncryptionKeyRequiredError)) return null;

    return Response.json(
        {
            // Both shapes are present because the routes that can raise this predate a
            // single convention: some clients read `success`, others only `error`.
            success: false,
            error: error.message,
            code: "ENCRYPTION_KEY_REQUIRED",
            profileId: error.profileId,
        },
        { status: 422 }
    );
}
