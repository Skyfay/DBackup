import { keyRefusalOf } from "@/lib/auth/api-key-refusal";
import { requestHeaders } from "@/lib/server/request-headers";

/** What a request without a login, or with one that is not valid, is answered. */
export const UNAUTHORIZED = "Unauthorized";

/**
 * The 401 answer of a route that found no context for its request. A request whose API key was
 * turned away, because it is disabled, has expired or its tenant switched API keys off, reads the
 * sentence of the key, any other "Unauthorized".
 *
 * @example
 * ```typescript
 * const ctx = await getAuthContext(await headers());
 * if (!ctx) return unauthorized();
 * ```
 */
export async function unauthorized(): Promise<Response> {
    let reason: string | null = null;
    try {
        reason = keyRefusalOf(await requestHeaders());
    } catch {
        // Outside a request there is no key to name.
    }
    const error = reason ?? UNAUTHORIZED;
    return Response.json({ success: false, error }, { status: 401 });
}
