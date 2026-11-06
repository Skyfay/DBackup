/**
 * The token the middleware sends with its request for the rate limits, so `/api/internal/rate-limit-config`
 * answers only the server itself. The middleware runs in a sandbox of its own that shares no memory
 * with the routes, so the token is derived from `BETTER_AUTH_SECRET`, which both read from the
 * environment, with an HMAC that never reveals the secret. Web Crypto only, the middleware runs on the
 * Edge runtime.
 */

/** The header the middleware sends the token in. */
export const INTERNAL_TOKEN_HEADER = "x-dbackup-internal-token";

const PURPOSE = "dbackup:internal:rate-limit-config";

let cached: { secret: string; token: Promise<string> } | null = null;

function hex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derive(secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(PURPOSE)));
}

/** The token of this instance, null without `BETTER_AUTH_SECRET`, when nobody reads the rate limits. */
export function internalToken(): Promise<string | null> {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) return Promise.resolve(null);
    if (cached?.secret !== secret) cached = { secret, token: derive(secret) };
    return cached.token;
}

/** Whether a request carries the token of this instance, compared in constant time. */
export async function hasInternalToken(headersObj: Headers): Promise<boolean> {
    const expected = await internalToken();
    const sent = headersObj.get(INTERNAL_TOKEN_HEADER);
    if (!expected || !sent || sent.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ sent.charCodeAt(index);
    return difference === 0;
}
