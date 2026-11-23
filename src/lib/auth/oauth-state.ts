/**
 * The `state` of an authorization of a cloud storage login (Dropbox, Google Drive, OneDrive).
 *
 * The provider sends `state` back to the callback as it got it, so it must not name the login
 * itself, or anyone signed in could hand a code of their own account to the login of another
 * tenant. It is a random nonce instead, kept here with the person, the tenant and the login it was
 * made for, which the callback takes once and only for the same person in the same tenant.
 */

import crypto from "crypto";

export type OAuthProvider = "dropbox" | "google-drive" | "onedrive";

export interface OAuthBinding {
    provider: OAuthProvider;
    userId: string;
    tenantId: string;
    /** The OAUTH credential profile that gets the refresh token. */
    credentialId: string;
}

interface StoredState extends OAuthBinding {
    expiresAt: number;
}

/** Long enough to sign in at the provider and give consent, short enough not to linger. */
const STATE_TTL_MS = 15 * 60 * 1000;

/** One store for the whole process, since Next.js builds several module graphs. */
const STORE_KEY = Symbol.for("dbackup.oauthStates");
type StateGlobal = typeof globalThis & { [STORE_KEY]?: Map<string, StoredState> };

function states(): Map<string, StoredState> {
    const holder = globalThis as StateGlobal;
    holder[STORE_KEY] ??= new Map();
    return holder[STORE_KEY];
}

function dropExpired(now: number): void {
    for (const [nonce, stored] of states()) {
        if (stored.expiresAt <= now) states().delete(nonce);
    }
}

/** A new `state` for the authorization URL, bound to who asked, where, and for which login. */
export function createOAuthState(binding: OAuthBinding): string {
    const now = Date.now();
    dropExpired(now);
    const nonce = crypto.randomBytes(32).toString("base64url");
    states().set(nonce, { ...binding, expiresAt: now + STATE_TTL_MS });
    return nonce;
}

/**
 * The login a `state` was made for, when the same person in the same tenant brings it back to the
 * callback of the same provider before it ran out. It is spent then, so a code is never tried
 * against it twice. Null for anything else, which leaves the state to the one it was made for.
 */
export function consumeOAuthState(nonce: string, caller: Omit<OAuthBinding, "credentialId">): { credentialId: string } | null {
    const now = Date.now();
    dropExpired(now);
    const stored = states().get(nonce);
    if (!stored) return null;
    if (stored.provider !== caller.provider || stored.userId !== caller.userId || stored.tenantId !== caller.tenantId) return null;
    states().delete(nonce);
    return { credentialId: stored.credentialId };
}
