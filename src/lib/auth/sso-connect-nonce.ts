import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * What binds the connect of another sign-in provider to the browser that asked for it. The token
 * in the address of the callback names an account, and anyone can pass that address on. So the
 * action that starts a connect sets a random nonce as a cookie of its browser, the token carries
 * only the hash of it, and the callback (src/app/api/auth/sso-link-callback/route.ts) signs a
 * session out only in the browser that holds the matching cookie.
 */

/** How long a connect token and the cookie of its browser count. */
export const CONNECT_TOKEN_TTL_MS = 5 * 60 * 1000;

/** The cookie that marks the browser a connect started in. Its value is in no address. */
export const CONNECT_NONCE_COOKIE = "dbackup.sso-connect";

/** The path of the callback, the only one the cookie is sent to. */
export const CONNECT_CALLBACK_PATH = "/api/auth/sso-link-callback";

const hashOf = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/** A new nonce for the cookie, with the hash the token names. */
export function newConnectNonce(): { nonce: string; nonceHash: string } {
    const nonce = randomBytes(32).toString("hex");
    return { nonce, nonceHash: hashOf(nonce) };
}

/**
 * Whether the browser that sent `nonce` in its cookie is the one the token was minted for. A
 * token someone else passed on arrives without that cookie, and one minted before the cookie
 * existed names no hash, so neither counts.
 */
export function connectStartedHere(nonceHash: unknown, nonce: string | undefined): boolean {
    if (typeof nonceHash !== "string" || !nonce) return false;
    const expected = Buffer.from(nonceHash);
    const given = Buffer.from(hashOf(nonce));
    return expected.length === given.length && timingSafeEqual(expected, given);
}
